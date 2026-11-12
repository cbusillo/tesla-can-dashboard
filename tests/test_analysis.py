from pathlib import Path

import pytest

from tesla_can_dashboard.analysis import analyze_recording
from tesla_can_dashboard.decoder import Decoder
from tesla_can_dashboard.recording import Frame


def drive(time: float, speed: float, gear: int = 4, wall: float = 0) -> Frame:
    payload = round(speed * 100).to_bytes(2, "little") + bytes([gear]) + bytes(5)
    return Frame(100, payload, wall, round(time * 1e9))


def analyze(tmp_path: Path, telemetry_dbc: Path, frames: list[Frame]) -> dict:
    path = tmp_path / "completed.jsonl"
    path.write_bytes(b"".join(item.encode() for item in frames))
    return analyze_recording(path, Decoder(telemetry_dbc))


def measurement(result: dict, key: str) -> dict:
    return next(item for group in result["performance"]["groups"] for item in group["measurements"] if item["id"] == key)


def test_acquisition_timing_interpolates_standing_and_rolling_despite_wall_clock_jumps(tmp_path: Path, telemetry_dbc: Path) -> None:
    frames = [drive(i / 10, max(0, i - 10), wall=9000 - i * 50) for i in range(151)]
    result = analyze(tmp_path, telemetry_dbc, frames)
    standing = measurement(result, "0-100-kmh")["runs"]
    rolling = measurement(result, "80-120-kmh")["runs"]
    assert len(standing) == len(rolling) == 1
    assert standing[0]["durationSeconds"] == pytest.approx(10)
    assert standing[0]["startSeconds"] == pytest.approx(1)
    assert rolling[0]["durationSeconds"] == pytest.approx(4)
    assert measurement(result, "0-60-mph")["runs"][0]["durationSeconds"] == pytest.approx(9.656064)


def test_quarter_mile_uses_integrated_distance_with_no_rollout(tmp_path: Path, telemetry_dbc: Path) -> None:
    frames = [drive(i / 10, i, wall=100 + i) for i in range(200)]
    result = analyze(tmp_path, telemetry_dbc, frames)
    run = measurement(result, "quarter-mile")["runs"][0]
    assert run["durationSeconds"] == pytest.approx((2 * 402.336 / (10 / 3.6)) ** 0.5)
    assert run["endSpeedKmh"] == pytest.approx(run["durationSeconds"] * 10)


@pytest.mark.parametrize("fault", ["gap", "reverse", "unknown", "invalid", "decode"])
def test_bad_speed_or_direction_cannot_bridge_a_run(tmp_path: Path, telemetry_dbc: Path, fault: str) -> None:
    frames = [drive(i / 10, max(0, i - 10)) for i in range(120)]
    if fault == "gap":
        del frames[50:60]
    elif fault == "reverse":
        frames[50] = drive(5, 40, gear=2)
    elif fault == "unknown":
        frames[50] = drive(5, 40, gear=7)
    elif fault == "invalid":
        frames[50] = drive(5, 655.35)
    else:
        frames[50] = Frame(100, b"bad", 0, 5_000_000_000)
    result = analyze(tmp_path, telemetry_dbc, frames)
    assert measurement(result, "0-100-kmh")["runs"] == []
    expected_reason = {
        "gap": "speed_gap",
        "reverse": "reverse_direction",
        "unknown": "unknown_direction",
        "invalid": "invalid_speed",
        "decode": "decode_errors",
    }[fault]
    assert expected_reason in result["reasons"]


def test_non_monotonic_recording_cannot_keep_an_earlier_plausible_result(tmp_path: Path, telemetry_dbc: Path) -> None:
    frames = [drive(i / 10, max(0, i - 10)) for i in range(120)] + [drive(1, 0)]
    result = analyze(tmp_path, telemetry_dbc, frames)
    assert result["quality"] == "invalid"
    assert measurement(result, "0-100-kmh")["runs"] == []


def test_missing_speed_and_moving_start_do_not_invent_standing_times(tmp_path: Path, telemetry_dbc: Path) -> None:
    result = analyze(tmp_path, telemetry_dbc, [])
    assert measurement(result, "0-100-kmh")["quality"] == "unavailable"
    result = analyze(tmp_path, telemetry_dbc, [drive(i / 10, 20 + i) for i in range(120)])
    assert measurement(result, "0-100-kmh")["runs"] == []
    assert measurement(result, "80-120-kmh")["runs"]


def test_interrupted_tail_preserves_completed_runs_with_partial_quality(tmp_path: Path, telemetry_dbc: Path) -> None:
    path = tmp_path / "completed.jsonl"
    path.write_bytes(b"".join(drive(i / 10, max(0, i - 10)).encode() for i in range(120)) + b'{"id":')
    result = analyze_recording(path, Decoder(telemetry_dbc))
    assert result["quality"] == "partial"
    assert "interrupted_tail" in result["reasons"]
    assert measurement(result, "0-100-kmh")["runs"][0]["durationSeconds"] == pytest.approx(10)


def test_charging_energy_soc_and_temperature_are_observations_with_gap_coverage(tmp_path: Path, telemetry_dbc: Path) -> None:
    decoder = Decoder(telemetry_dbc)
    frames = []
    for seconds, soc, energy, temperature in [(0, 20, 15, 10), (1, 21, 15.5, 12), (2, 22, 16, 14), (20, 23, 17, 16)]:
        battery = decoder.messages[101].encode(
            {
                "BMS_socUI": soc,
                "BMS_nominalEnergyRemaining": energy,
                "BMS_minPackTemperature": temperature,
                "BMS_maxPackTemperature": temperature + 4,
            }
        )
        power = decoder.messages[102].encode({"PCS_chgInputPower": 11_000, "UI_chargeTerminationPct": 80})
        frames.extend(
            [Frame(101, battery, seconds, seconds * 1_000_000_000), Frame(102, power, seconds, seconds * 1_000_000_000 + 1)]
        )
    result = analyze(tmp_path, telemetry_dbc, frames)
    signals = result["battery"]["signals"]
    assert signals["displayedChargePercent"]["observedDelta"] == 3
    assert signals["remainingEnergyKwh"]["observedDelta"] == 2
    assert signals["minimumTemperatureC"]["minimum"] == 10
    charging = result["battery"]["charging"]
    assert charging["quality"] == "partial"
    assert charging["coveredSeconds"] == pytest.approx(2)
    assert charging["observedEnergyKwh"] == pytest.approx(11 * 2 / 3600)


def test_curves_runs_and_input_frames_are_bounded(tmp_path: Path, telemetry_dbc: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from tesla_can_dashboard import analysis

    decoder = Decoder(telemetry_dbc)
    data = decoder.messages[102].encode({"PCS_chgInputPower": 0, "UI_chargeTerminationPct": 80})
    frames = [Frame(102, data, i, i * 100_000_000) for i in range(1500)]
    result = analyze(tmp_path, telemetry_dbc, frames)
    curve = result["battery"]["signals"]["chargingPowerKw"]
    assert len(curve["curve"]) <= analysis.MAX_CURVE_POINTS
    assert curve["curveSampled"]
    assert curve["samples"] == len(frames)
    assert result["battery"]["charging"]["observedEnergyKwh"] == 0
    monkeypatch.setattr(analysis, "MAX_RUNS", 2)
    frames = [drive((run * 120 + i) / 10, max(0, i - 10)) for run in range(4) for i in range(120)]
    result = analyze(tmp_path, telemetry_dbc, frames)
    assert len(measurement(result, "0-100-kmh")["runs"]) == 2
    assert result["performance"]["omittedRuns"] > 0
    monkeypatch.setattr(analysis, "MAX_ANALYSIS_FRAMES", 5)
    with pytest.raises(analysis.AnalysisLimitError):
        analyze(tmp_path, telemetry_dbc, frames)


def test_repeated_timestamps_and_stale_separate_gear_do_not_create_runs(tmp_path: Path, telemetry_dbc: Path) -> None:
    frames = [drive(i / 10, max(0, i - 10), gear=7) for i in range(120)]
    result = analyze(tmp_path, telemetry_dbc, frames)
    assert measurement(result, "0-100-kmh")["runs"] == []
    assert "unknown_direction" in measurement(result, "0-100-kmh")["reasons"]
    frames = [drive(i / 10, max(0, i - 10)) for i in range(120)]
    frames.insert(60, frames[59])
    result = analyze(tmp_path, telemetry_dbc, frames)
    assert measurement(result, "0-100-kmh")["runs"] == []


def test_slowing_before_the_quarter_mile_uses_the_positive_quadratic_root(tmp_path: Path, telemetry_dbc: Path) -> None:
    speeds = [min(i, 100) if i < 150 else max(10, 100 - (i - 150)) for i in range(250)]
    frames = [drive(i / 10, speed) for i, speed in enumerate(speeds)]
    result = analyze(tmp_path, telemetry_dbc, frames)
    run = measurement(result, "quarter-mile")["runs"][0]
    time_seconds = run["endSeconds"]
    acceleration_distance = 0.5 * (100 / 3.6) * 10
    cruise_distance = 5 * 100 / 3.6
    deceleration_seconds = time_seconds - 15
    distance = acceleration_distance + cruise_distance + 100 / 3.6 * deceleration_seconds - 0.5 * 10 / 3.6 * deceleration_seconds**2
    assert distance == pytest.approx(402.336)


def test_parked_time_does_not_warn_about_a_valid_forward_run(tmp_path: Path, telemetry_dbc: Path) -> None:
    frames = [drive(0, 0, gear=1), drive(1, 0, gear=1)]
    frames.extend(drive(2 + i / 10, max(0, i - 10)) for i in range(120))
    frames.append(drive(14, 0, gear=1))
    result = analyze(tmp_path, telemetry_dbc, frames)
    assert result["quality"] == "observed"
    assert result["reasons"] == []
    assert measurement(result, "0-100-kmh")["runs"]


def test_corrupt_recording_cannot_expose_valid_looking_battery_prefix(tmp_path: Path, telemetry_dbc: Path) -> None:
    decoder = Decoder(telemetry_dbc)
    payload = decoder.messages[102].encode({"PCS_chgInputPower": 10000, "UI_chargeTerminationPct": 80})
    path = tmp_path / "corrupt.jsonl"
    path.write_bytes(Frame(102, payload, 0, 0).encode() + Frame(102, payload, 0, 1_000_000_000).encode() + b"broken\n")
    result = analyze_recording(path, decoder)
    signal = result["battery"]["signals"]["chargingPowerKw"]
    assert signal["quality"] == "invalid"
    assert signal["first"] is None and not signal["curve"]
    assert result["battery"]["charging"]["observedEnergyKwh"] is None

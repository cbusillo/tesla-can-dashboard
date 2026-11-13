import struct
import time

import pytest

from tesla_can_dashboard.analysis import analyze_recording
from tesla_can_dashboard.decoder import Decoder
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Frame, Recorder


@pytest.fixture
def power_dbc(telemetry_dbc):
    with telemetry_dbc.open("a") as target:
        target.write("""BO_ 306 Pack: 8 TEST
 SG_ BMS_dcLinkVoltage : 0|16@1+ (0.01,0) [0|1000] "V" TEST
 SG_ BMS_packCurrent : 16|16@1- (0.1,0) [-3000|3000] "A" TEST
""")
    return telemetry_dbc


def gear_frame(seconds: float, gear: int = 4) -> Frame:
    return Frame(100, (3600).to_bytes(2, "little") + bytes([gear]) + bytes(5), 1000, round(seconds * 1e9))


def pack(seconds: float, current: float, voltage: float = 400) -> Frame:
    payload = struct.pack("<Hh", round(voltage * 100), round(current * 10)) + bytes(4)
    return Frame(0x132, payload, 1000 - seconds, round(seconds * 1e9))


@pytest.mark.parametrize("direction,current", [("negative", -100), ("positive", 100)])
def test_power_requires_operator_polarity_and_keeps_raw_current(direction: str, current: float) -> None:
    frame = pack(0, current)
    values, _ = Decoder(discharge_current=direction).decode(frame.identifier, frame.data)
    assert values["currentA"] == current
    assert values["batteryPowerKw"] == pytest.approx(40)
    unqualified, _ = Decoder().decode(frame.identifier, frame.data)
    assert "batteryPowerKw" not in unqualified


def test_energy_separates_draw_and_regeneration_at_zero_crossings_and_excludes_gaps(tmp_path, power_dbc) -> None:
    frames = [pack(0, -100), pack(2, 100), pack(10, -200), pack(12, -200)]
    frames = sorted([gear_frame(index / 2) for index in range(25)] + frames, key=lambda frame: frame.monotonic_ns)
    path = tmp_path / "session.jsonl"
    path.write_bytes(b"".join(frame.encode() for frame in frames))
    result = analyze_recording(path, Decoder(power_dbc, discharge_current="negative"))
    energy = result["battery"]["energy"]
    assert energy["drawnKwh"] == pytest.approx((20 + 160) / 3600)
    assert energy["regeneratedKwh"] == pytest.approx(20 / 3600)
    assert energy["coveredSeconds"] == 4
    assert energy["peakDrawKw"] == 80
    assert energy["peakRegenKw"] == 40
    assert energy["quality"] == "partial"
    assert analyze_recording(path, Decoder())["battery"]["energy"]["drawnKwh"] is None


def test_invalid_recording_cannot_keep_plausible_energy_totals(tmp_path, power_dbc) -> None:
    path = tmp_path / "session.jsonl"
    path.write_bytes(
        gear_frame(0).encode() + pack(0, -100).encode() + gear_frame(1).encode() + pack(1, -100).encode() + b'{"broken": true}\n'
    )
    energy = analyze_recording(path, Decoder(power_dbc, discharge_current="negative"))["battery"]["energy"]
    assert energy["quality"] == "invalid"
    assert energy["drawnKwh"] is None
    assert energy["peakDrawKw"] is None


def test_parked_charging_cannot_be_reported_as_regeneration(tmp_path, power_dbc) -> None:
    frames = [gear_frame(0, 1), pack(0, 100), gear_frame(1, 1), pack(1, 100)]
    path = tmp_path / "charging.jsonl"
    path.write_bytes(b"".join(frame.encode() for frame in frames))
    energy = analyze_recording(path, Decoder(power_dbc, discharge_current="negative"))["battery"]["energy"]
    assert energy["regeneratedKwh"] is None
    assert energy["peakRegenKw"] is None


def test_live_power_is_invalidated_when_its_source_frame_is_bad(tmp_path) -> None:
    engine = Engine("can0", Recorder(tmp_path / "raw", reserve_bytes=0), discharge_current="negative")
    frame = pack(time.monotonic(), -100)
    engine.ingest(frame)
    snapshot = engine.snapshot()
    assert snapshot["signals"]["batteryPowerKw"]["value"] == pytest.approx(40)
    assert snapshot["currentDirection"] == "negative-discharge"
    engine.ingest(Frame(frame.identifier, b"bad", frame.timestamp, frame.monotonic_ns + 1))
    assert engine.snapshot()["signals"]["batteryPowerKw"]["quality"] == "invalid"


def test_unsupported_current_units_cannot_supply_derived_power(power_dbc) -> None:
    power_dbc.write_text(power_dbc.read_text().replace('"A"', '"unknown"'))
    frame = pack(0, -100)
    values, _ = Decoder(power_dbc, discharge_current="negative").decode(frame.identifier, frame.data)
    assert "batteryPowerKw" not in values

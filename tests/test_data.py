import json
import time
from pathlib import Path

import pytest

from tesla_can_dashboard.decoder import Decoder
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Frame, Recorder, read_frames
from tesla_can_dashboard.signals import SignalStore


def frame(identifier: int = 0x132, payload: bytes | None = None) -> Frame:
    return Frame(identifier, payload or bytes.fromhex("8393faff00000000"), time.time(), time.monotonic_ns())


def test_zero_missing_invalid_and_stale_are_distinct() -> None:
    store = SignalStore(2)
    store.update({"currentA": 0, "voltageV": 377, "displayedChargePercent": 102.3}, {1: 3.93, 2: None}, 100, now=0)
    current = store.snapshot(now=1)
    assert current["signals"]["currentA"]["value"] == 0
    assert current["signals"]["currentA"]["quality"] == "fresh"
    assert current["signals"]["fullPackEnergyKwh"]["quality"] == "unavailable"
    assert current["signals"]["displayedChargePercent"]["quality"] == "invalid"
    assert current["signals"]["displayedChargePercent"]["value"] is None
    assert current["cellGroups"][1]["value"] is None
    assert store.snapshot(now=5)["signals"]["currentA"]["quality"] == "stale"
    assert store.snapshot(now=5)["signals"]["currentA"]["value"] == 0


def test_basic_decoder_reads_qualified_raw_frames_and_rejects_bad_lengths() -> None:
    decoder = Decoder()
    values, _ = decoder.decode(0x132, bytes.fromhex("8393faff00000000"))
    assert values["voltageV"] == pytest.approx(377.63)
    assert values["currentA"] == pytest.approx(-0.6)
    values, _ = decoder.decode(0x292, bytes.fromhex("00800a0000000000"))
    assert values["displayedChargePercent"] == pytest.approx(67.2)
    with pytest.raises(ValueError):
        decoder.decode(0x132, b"\0")


def test_dbc_mux_requires_nominal_cell_status(tmp_path) -> None:
    dbc = tmp_path / "cells.dbc"
    dbc.write_text("""VERSION "test"
NS_ :
BS_:
BU_: BMS
BO_ 1025 BMS_brickMeasurements: 8 BMS
 SG_ BMS_brickVoltageMultiplexer M : 0|4@1+ (1,0) [0|1] "" BMS
 SG_ BMS_brickVoltageStatus1 m0 : 4|2@1+ (1,0) [0|3] "" BMS
 SG_ BMS_brickVoltage1 m0 : 8|16@1+ (0.0001,0) [0|6] "V" BMS
 SG_ BMS_brickVoltageStatus2 m1 : 4|2@1+ (1,0) [0|3] "" BMS
 SG_ BMS_brickVoltage2 m1 : 8|16@1+ (0.0001,0) [0|6] "V" BMS
""")
    decoder = Decoder(dbc)
    _, cells = decoder.decode(0x401, bytes.fromhex("2084990000000000"))
    assert cells == {1: pytest.approx(3.93)}
    _, cells = decoder.decode(0x401, bytes.fromhex("11409c0000000000"))
    assert cells == {2: None}


def test_recording_stops_at_budget_without_deleting_saved_frames(tmp_path) -> None:
    sample = frame()
    recorder = Recorder(tmp_path, maximum_bytes=len(sample.encode()) * 2, reserve_bytes=0)
    session = recorder.start()
    recorder.append(sample)
    recorder.append(sample)
    recorder.append(sample)
    assert recorder.active_id is None
    assert recorder.last_error
    assert recorder.path(session).stat().st_size <= recorder.maximum_bytes
    assert len(list(read_frames(recorder.path(session)))) == 2


def test_interrupted_tail_is_recoverable_but_middle_corruption_is_not(tmp_path) -> None:
    sample = frame()
    path = tmp_path / "capture.jsonl"
    path.write_bytes(sample.encode() + b'{"id":')
    assert list(read_frames(path)) == [sample]
    path.write_bytes(sample.encode() + b"{broken}\n" + sample.encode())
    with pytest.raises(ValueError):
        list(read_frames(path))
    path.write_text(json.dumps({"id": 1, "data": "00", "time": float("nan"), "monotonicNs": 1}) + "\n")
    with pytest.raises(ValueError):
        list(read_frames(path))


def test_recording_paths_cannot_follow_symlinks_or_escape_directory(tmp_path) -> None:
    recorder = Recorder(tmp_path / "sessions", reserve_bytes=0)
    recorder.directory.mkdir()
    outside = tmp_path / "private.txt"
    outside.write_text("private")
    identifier = "a" * 32
    (recorder.directory / f"{identifier}.jsonl").symlink_to(outside)
    with pytest.raises(FileNotFoundError):
        recorder.path(identifier)
    with pytest.raises(ValueError):
        recorder.path("../private")


def test_recording_is_independent_of_replay_and_ignores_unselected_identifiers(tmp_path) -> None:
    recorder = Recorder(tmp_path, reserve_bytes=0)
    engine = Engine("can0", recorder)
    first = recorder.start()
    engine.ingest(frame())
    recorder.stop()
    second = recorder.start()
    engine.start_replay(first)
    engine.ingest(frame(0x508, b"identity"))
    engine.ingest(frame())
    recorder.stop()
    assert [value.identifier for value in read_frames(recorder.path(second))] == [0x132]
    engine.close()


def test_replay_gap_ages_signals_and_reports_disconnection(tmp_path) -> None:
    recorder = Recorder(tmp_path, reserve_bytes=0)
    session = recorder.start()
    first = frame()
    recorder.append(first)
    recorder.append(Frame(first.identifier, first.data, first.timestamp + 20, first.monotonic_ns + 20_000_000_000))
    recorder.stop()
    engine = Engine("can0", recorder)
    try:
        engine.start_replay(session)
        store = engine.replay_store
        assert store is not None
        deadline = time.monotonic() + 1
        while store.frames == 0 and time.monotonic() < deadline:
            time.sleep(0.001)
        assert store.frames == 1
        engine.replay_clock -= 10
        data = engine.snapshot()
        assert data["signals"]["voltageV"]["quality"] == "stale"
        assert data["connection"]["state"] == "disconnected"
    finally:
        engine.close()


def test_bad_selected_frames_are_recorded_and_replay_continues(tmp_path) -> None:
    recorder = Recorder(tmp_path, reserve_bytes=0)
    session = recorder.start()
    engine = Engine("can0", recorder)
    good = frame()
    engine.ingest(Frame(good.identifier, b"bad", good.timestamp, good.monotonic_ns))
    engine.ingest(good)
    recorder.stop()
    assert len(list(read_frames(recorder.path(session)))) == 2
    assert engine.store.decode_errors == 1
    engine.start_replay(session)
    thread = engine.replay_thread
    store = engine.replay_store
    assert thread is not None and store is not None
    thread.join(timeout=1)
    assert engine.replay_state == "finished"
    assert store.frames == 1
    assert store.decode_errors == 1
    engine.close()


def test_dbc_native_units_reserved_values_and_selection_reach_live_recording(tmp_path: Path, telemetry_dbc: Path) -> None:
    recorder = Recorder(tmp_path / "sessions", reserve_bytes=0)
    engine = Engine("can0", recorder, telemetry_dbc)
    session = recorder.start()
    acquired = time.monotonic_ns()
    engine.ingest(Frame(100, bytes.fromhex("1027040000000000"), 0, acquired))
    engine.ingest(Frame(102, bytes.fromhex("f82a401f00000000"), 0, acquired + 1))
    snapshot = engine.snapshot()["signals"]
    assert snapshot["speedKmh"]["value"] == pytest.approx(100)
    assert snapshot["driveGear"]["value"] == 4
    assert snapshot["chargingPowerKw"]["value"] == pytest.approx(11)
    assert snapshot["chargeLimitPercent"]["value"] == pytest.approx(80)
    engine.ingest(Frame(100, bytes.fromhex("ffff040000000000"), 0, acquired + 2))
    assert engine.snapshot()["signals"]["speedKmh"]["quality"] == "invalid"
    engine.ingest(Frame(100, b"bad", 0, acquired + 3))
    assert engine.snapshot()["signals"]["driveGear"]["quality"] == "invalid"
    recorder.stop()
    assert [item.identifier for item in read_frames(recorder.path(session))] == [100, 102, 100, 100]
    engine.close()


def test_dbc_mph_normalizes_and_unknown_units_and_gear_codes_stay_unavailable(telemetry_dbc: Path) -> None:
    source = telemetry_dbc.read_text().replace('"kph"', '"MPH"')
    telemetry_dbc.write_text(source)
    values, _ = Decoder(telemetry_dbc).decode(100, bytes.fromhex("7017040000000000"))
    assert values["speedKmh"] == pytest.approx(60 * 1.609344)
    telemetry_dbc.write_text(source.replace('"MPH"', '"speed"').replace('4 "DI_GEAR_D"', '4 "unqualified"'))
    decoder = Decoder(telemetry_dbc)
    values, _ = decoder.decode(100, bytes.fromhex("7017040000000000"))
    store = SignalStore()
    store.update(values, {}, 0, now=0)
    assert store.snapshot(now=0)["signals"]["speedKmh"]["quality"] == "unavailable"
    assert store.snapshot(now=0)["signals"]["driveGear"]["value"] is None


def test_opted_in_startup_capture_is_live_only_and_failure_does_not_stop_receiver(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    recorder = Recorder(tmp_path / "sessions", reserve_bytes=0)
    saved = recorder.start()
    sample = frame()
    recorder.append(sample)
    recorder.stop()
    default = Engine("can0", recorder)
    monkeypatch.setattr(default, "_receive", lambda: None)
    default.start()
    assert recorder.active_id is None
    default.close()
    engine = Engine("can0", recorder, auto_record=True)
    monkeypatch.setattr(engine, "_receive", lambda: None)
    engine.start()
    assert recorder.active_id is not None and recorder.active_id != saved
    engine.ingest(sample)
    engine.close()
    assert list(read_frames(recorder.path(saved))) == [sample]
    assert len(recorder.status()["sessions"]) == 2
    demo = Engine(None, recorder, auto_record=True)
    demo.start()
    assert recorder.active_id is None
    assert len(recorder.status()["sessions"]) == 2
    demo.close()
    limited = Recorder(tmp_path / "full", maximum_bytes=1, reserve_bytes=0)
    engine = Engine("can0", limited, auto_record=True)
    monkeypatch.setattr(engine, "_receive", lambda: None)

    def full_storage() -> str:
        raise ValueError("Recording storage is full")

    monkeypatch.setattr(limited, "start", full_storage)
    engine.start()
    assert engine.thread is not None
    assert limited.active_id is None
    assert limited.last_error
    engine.ingest(sample)
    assert engine.store.frames == 1
    engine.close()


@pytest.mark.parametrize("key,value", [("id", True), ("time", 10**400), ("monotonicNs", 10**400), ("monotonicNs", True)])
def test_malformed_numeric_fields_fail_as_recording_errors(tmp_path: Path, key: str, value: int) -> None:
    record = {"id": 0x132, "data": "0000000000000000", "time": 0, "monotonicNs": 0, key: value}
    path = tmp_path / "bad.jsonl"
    path.write_text(json.dumps(record) + "\n")
    with pytest.raises(ValueError):
        list(read_frames(path))


@pytest.mark.parametrize("limit_kind", ["bytes", "frames"])
def test_recording_rolls_into_analyzable_chunks_without_losing_boundary_frames(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, limit_kind: str
) -> None:
    from tesla_can_dashboard import recording
    from tesla_can_dashboard.analysis import analyze_recording

    sample = frame()
    if limit_kind == "bytes":
        monkeypatch.setattr(recording, "MAX_ANALYSIS_BYTES", len(sample.encode()) * 2)
    else:
        monkeypatch.setattr(recording, "MAX_CHUNK_FRAMES", 2)
    recorder = Recorder(tmp_path, maximum_bytes=len(sample.encode()) * 7, reserve_bytes=0)
    recorder.start()
    for _ in range(7):
        recorder.append(sample)
    recorder.stop()
    sessions = recorder.status()["sessions"]
    assert len(sessions) == 4
    lengths = []
    for session in sessions:
        path = recorder.path(session["id"])
        lengths.append(len(list(read_frames(path))))
        assert path.stat().st_size <= recording.MAX_ANALYSIS_BYTES
        assert lengths[-1] <= recording.MAX_ANALYSIS_FRAMES
        assert analyze_recording(path, Decoder())["quality"] != "invalid"
    assert sorted(lengths) == [1, 2, 2, 2]
    assert sum(lengths) == 7
    saved = {item["id"]: recorder.path(item["id"]).read_bytes() for item in sessions}
    with pytest.raises(ValueError):
        recorder.start()
    assert saved == {item["id"]: recorder.path(item["id"]).read_bytes() for item in sessions}


def test_rollover_stops_at_total_budget_without_losing_saved_chunks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from tesla_can_dashboard import recording

    sample = frame()
    monkeypatch.setattr(recording, "MAX_CHUNK_FRAMES", 2)
    recorder = Recorder(tmp_path, maximum_bytes=len(sample.encode()) * 3, reserve_bytes=0)
    recorder.start()
    for _ in range(4):
        recorder.append(sample)
    assert recorder.active_id is None
    assert recorder.last_error
    assert sum(len(list(read_frames(recorder.path(item["id"])))) for item in recorder.status()["sessions"]) == 3


def test_rollover_uses_flush_result_instead_of_stale_status_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from tesla_can_dashboard import recording

    sample = frame()
    monkeypatch.setattr(recording, "MAX_CHUNK_FRAMES", 2)
    recorder = Recorder(tmp_path, reserve_bytes=0)
    recorder.start()
    recorder.append(sample)
    recorder.append(sample)
    recorder.last_error = "Earlier transient storage warning"
    recorder.append(sample)
    assert recorder.active_id is not None
    recorder.stop()
    assert sum(len(list(read_frames(recorder.path(item["id"])))) for item in recorder.status()["sessions"]) == 3


def test_unknown_mux_page_keeps_mapped_branch_age_and_known_corruption_is_invalid(tmp_path: Path) -> None:
    from tesla_can_dashboard.analysis import analyze_recording

    dbc = tmp_path / "mux.dbc"
    dbc.write_text("""VERSION "synthetic mux behavior"
NS_ :
BS_:
BU_: TEST
BO_ 103 Mux: 8 TEST
 SG_ Page M : 0|4@1+ (1,0) [0|3] "" TEST
 SG_ BMS_nominalFullPackEnergy m0 : 8|16@1+ (0.01,0) [0|250] "kWh" TEST
 SG_ BMS_nominalEnergyRemaining m0 : 24|16@1+ (0.01,0) [0|250] "kWh" TEST
 SG_ BMS_maxPackTemperature m1 : 8|16@1+ (0.01,0) [0|150] "DegC" TEST
 SG_ BMS_socUI : 48|8@1+ (0.5,0) [0|100] "%" TEST
VAL_ 103 BMS_nominalEnergyRemaining 65535 "SNA";
""")
    recorder = Recorder(tmp_path / "sessions", reserve_bytes=0)
    engine = Engine("synthetic", recorder, dbc)
    session = recorder.start()
    good = bytes.fromhex("0010278813006400")
    unknown = bytes.fromhex("03ffffffff007800")
    engine.ingest(Frame(103, good, 0, 0))
    engine.ingest(Frame(103, unknown, 1, 1_000_000_000))
    recorder.stop()
    readings = engine.store.snapshot(now=2)["signals"]
    assert readings["fullPackEnergyKwh"]["value"] == 100
    assert readings["remainingEnergyKwh"]["value"] == 50
    assert readings["remainingEnergyKwh"]["ageSeconds"] == 2
    assert readings["displayedChargePercent"]["value"] == 60
    assert readings["displayedChargePercent"]["ageSeconds"] == 1
    assert engine.store.decode_errors == 0
    result = analyze_recording(recorder.path(session), engine.decoder)
    assert result["recording"]["decodeErrors"] == 0
    assert result["battery"]["signals"]["remainingEnergyKwh"]["samples"] == 1
    assert len(list(read_frames(recorder.path(session)))) == 2
    engine.ingest(Frame(103, bytes.fromhex("001027ffff006400"), 2, 2_000_000_000))
    assert engine.store.snapshot(now=2)["signals"]["remainingEnergyKwh"]["quality"] == "invalid"
    engine.ingest(Frame(103, b"bad", 3, 3_000_000_000))
    assert engine.store.decode_errors == 1
    assert engine.store.snapshot(now=3)["signals"]["fullPackEnergyKwh"]["quality"] == "invalid"
    engine.close()


def test_failed_chunk_flush_stops_capture_instead_of_rolling_forward(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from tesla_can_dashboard import recording

    sample = frame()
    monkeypatch.setattr(recording, "MAX_CHUNK_FRAMES", 1)
    recorder = Recorder(tmp_path, reserve_bytes=0)
    recorder.start()
    recorder.append(sample)

    def failed_flush(_: int) -> None:
        raise OSError("Synthetic flush failure")

    monkeypatch.setattr(recording.os, "fsync", failed_flush)
    recorder.append(sample)
    assert recorder.active_id is None
    assert recorder.last_error
    assert len(recorder.status()["sessions"]) == 1
    assert len(list(read_frames(recorder.path(recorder.status()["sessions"][0]["id"])))) == 1

import json
import time

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
        deadline = time.monotonic() + 1
        while engine.replay_store.frames == 0 and time.monotonic() < deadline:
            time.sleep(0.001)
        assert engine.replay_store.frames == 1
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
    engine.replay_thread.join(timeout=1)
    assert engine.replay_state == "finished"
    assert engine.replay_store.frames == 1
    assert engine.replay_store.decode_errors == 1
    engine.close()

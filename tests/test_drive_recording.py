from tesla_can_dashboard.engine import PARK_RECORDING_GRACE_SECONDS, Engine
from tesla_can_dashboard.recording import Frame, Recorder, read_frames


def gear(seconds: float, value: int) -> Frame:
    return Frame(100, bytes(2) + bytes([value]) + bytes(5), 1000 + seconds, round(seconds * 1e9))


def test_automatic_capture_skips_park_and_keeps_reverse_and_drive_together(tmp_path, telemetry_dbc) -> None:
    recorder = Recorder(tmp_path / "raw", reserve_bytes=0)
    engine = Engine("can0", recorder, telemetry_dbc, auto_drives=True)
    engine.ingest(gear(0, 1))
    assert recorder.active_id is None
    engine.ingest(gear(1, 2))
    session = recorder.active_id
    assert session
    engine.ingest(gear(2, 4))
    assert recorder.active_id == session
    engine.ingest(gear(3, 1))
    engine.ingest(gear(3 + PARK_RECORDING_GRACE_SECONDS + 1, 1))
    assert recorder.active_id is None
    assert isinstance(session, str)
    assert [frame.data[2] for frame in read_frames(recorder.path(session))] == [2, 4, 1]


def test_manual_capture_is_not_stopped_by_the_drive_policy(tmp_path, telemetry_dbc) -> None:
    recorder = Recorder(tmp_path / "raw", reserve_bytes=0)
    session = recorder.start()
    engine = Engine("can0", recorder, telemetry_dbc, auto_drives=True)
    for frame in [gear(0, 4), gear(1, 1), gear(2 + PARK_RECORDING_GRACE_SECONDS, 1)]:
        engine.ingest(frame)
    assert recorder.active_id == session
    recorder.stop()


def test_manual_stop_is_respected_until_park_rearms_the_next_drive(tmp_path, telemetry_dbc) -> None:
    recorder = Recorder(tmp_path / "raw", reserve_bytes=0)
    engine = Engine("can0", recorder, telemetry_dbc, auto_drives=True)
    engine.ingest(gear(0, 4))
    recorder.stop()
    for frame in [gear(1, 4), gear(2, 3), gear(3, 4)]:
        engine.ingest(frame)
    assert recorder.active_id is None
    engine.ingest(gear(4, 1))
    engine.ingest(gear(5, 4))
    assert recorder.active_id
    recorder.stop()


def test_rolled_over_automatic_capture_still_stops_in_park(tmp_path, telemetry_dbc, monkeypatch) -> None:
    monkeypatch.setattr("tesla_can_dashboard.recording.MAX_CHUNK_FRAMES", 2)
    recorder = Recorder(tmp_path / "raw", reserve_bytes=0)
    engine = Engine("can0", recorder, telemetry_dbc, auto_drives=True)
    engine.ingest(gear(0, 4))
    original = recorder.active_id
    engine.ingest(gear(1, 4))
    engine.ingest(gear(2, 4))
    assert recorder.active_id != original
    engine.ingest(gear(3, 1))
    engine.ingest(gear(3 + PARK_RECORDING_GRACE_SECONDS + 1, 1))
    assert recorder.active_id is None
    assert len(recorder.status()["sessions"]) == 2


def test_storage_failure_does_not_retry_every_frame_or_stop_live_decoding(tmp_path, telemetry_dbc, monkeypatch) -> None:
    recorder = Recorder(tmp_path / "raw", reserve_bytes=0)
    engine = Engine("can0", recorder, telemetry_dbc, auto_drives=True)
    calls = []

    def unavailable() -> str:
        calls.append(True)
        raise OSError("storage unavailable")

    monkeypatch.setattr(recorder, "start", unavailable)
    for seconds in range(4):
        engine.ingest(gear(seconds, 4))
    assert len(calls) == 1
    assert recorder.last_error
    assert engine.store.snapshot()["signals"]["driveGear"]["value"] == 4


def test_capture_waits_for_analysis_admission_without_losing_the_drive(tmp_path, telemetry_dbc) -> None:
    recorder = Recorder(tmp_path / "raw", reserve_bytes=0)
    completed = recorder.start()
    recorder.stop()
    engine = Engine("can0", recorder, telemetry_dbc, auto_drives=True)
    with recorder.completed_recording(completed):
        engine.ingest(gear(0, 4))
        assert recorder.active_id is None
    engine.ingest(gear(1, 4))
    assert recorder.active_id
    recorder.stop()

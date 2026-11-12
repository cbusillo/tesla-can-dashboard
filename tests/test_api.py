import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tesla_can_dashboard.analysis import analyze_recording
from tesla_can_dashboard.api import create_app
from tesla_can_dashboard.decoder import Decoder
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Frame, Recorder


def test_demo_is_labelled_replay_and_does_not_start_vehicle_recording(tmp_path) -> None:
    engine = Engine(None, Recorder(tmp_path / "sessions", reserve_bytes=0))
    with TestClient(create_app(engine, tmp_path)) as client:
        data = client.get("/api/snapshot").json()
        assert data["mode"] == "replay"
        assert len(data["cellGroups"]) == engine.store.cell_count
        assert client.post("/api/recordings/start").status_code == 409
        assert client.post("/api/vehicle/command").status_code == 404


def test_layout_survives_restart_and_rejects_unknown_signals(tmp_path) -> None:
    for cycle in range(2):
        engine = Engine(None, Recorder(tmp_path / "sessions", reserve_bytes=0))
        with TestClient(create_app(engine, tmp_path, allowed_origins={"https://dashboard.example"})) as client:
            if cycle == 0:
                saved = client.put(
                    "/api/layout",
                    json={
                        "theme": "night",
                        "units": "imperial",
                        "instruments": ["voltageV"],
                        "presentation": "history",
                        "ranges": {"voltageV": {"minimum": 250, "maximum": 450}},
                    },
                )
                assert saved.status_code == 200
            layout = client.get("/api/layout").json()
            assert layout["theme"] == "night"
            assert layout["presentation"] == "history"
            assert layout["ranges"]["voltageV"] == {"minimum": 250, "maximum": 450}
            assert client.put("/api/layout", json={"instruments": ["invented"]}).status_code == 422
            assert (
                client.put("/api/layout", json={"theme": "day"}, headers={"Origin": "https://unrelated.example"}).status_code == 403
            )


def test_reload_changes_revision_without_touching_vehicle_state(tmp_path) -> None:
    engine = Engine(None, Recorder(tmp_path / "sessions", reserve_bytes=0))
    with TestClient(create_app(engine, tmp_path, allowed_origins={"https://dashboard.example"})) as client:
        before = client.get("/api/snapshot").json()["reloadRevision"]
        assert client.post("/api/control/reload", headers={"Origin": "https://dashboard.example"}).status_code == 200
        assert client.get("/api/snapshot").json()["reloadRevision"] != before
        assert engine.store.frames == 0


def test_recording_export_delete_and_active_session_protection(tmp_path, monkeypatch) -> None:
    engine = Engine("can0", Recorder(tmp_path / "sessions", reserve_bytes=0))
    monkeypatch.setattr(engine, "start", lambda: None)
    with TestClient(create_app(engine, tmp_path)) as client:
        identifier = client.post("/api/recordings/start").json()["id"]
        sample = Frame(0x132, bytes.fromhex("8393faff00000000"), time.time(), time.monotonic_ns())
        engine.ingest(sample)
        assert client.delete(f"/api/recordings/{identifier}").status_code == 409
        client.post("/api/recordings/stop")
        result = client.get(f"/api/recordings/{identifier}")
        assert result.status_code == 200
        assert json.loads(result.text)["data"] == sample.data.hex()
        assert client.delete(f"/api/recordings/{identifier}").status_code == 200
        assert client.get(f"/api/recordings/{identifier}").status_code == 404


def test_bad_browser_report_cannot_break_report_history(tmp_path) -> None:
    engine = Engine(None, Recorder(tmp_path / "sessions", reserve_bytes=0))
    with TestClient(create_app(engine, tmp_path)) as client:
        report: dict[str, object] = {"browser": "test browser", "updates": 10, "visibility": "visible", "requestTimesMs": [24]}
        assert client.post("/api/browser-check", json=report).status_code == 200
        report["requestTimesMs"] = [float("nan")]
        assert (
            client.post("/api/browser-check", content=json.dumps(report), headers={"Content-Type": "application/json"}).status_code
            == 400
        )
        assert len(client.get("/api/browser-checks").json()["checks"]) == 1


def test_health_describes_receiver_separately_from_replay(tmp_path, monkeypatch) -> None:
    engine = Engine("can0", Recorder(tmp_path / "sessions", reserve_bytes=0))
    monkeypatch.setattr(engine, "start", lambda: None)
    monkeypatch.setattr(engine, "snapshot", lambda: {"connection": {"state": "connected"}, "mode": "replay"})
    with TestClient(create_app(engine, tmp_path)) as client:
        health = client.get("/api/health").json()
        assert health["mode"] == "live"
        assert health["connection"] == "waiting"


def test_bad_dial_ranges_do_not_replace_saved_layout(tmp_path) -> None:
    engine = Engine(None, Recorder(tmp_path / "sessions", reserve_bytes=0))
    with TestClient(create_app(engine, tmp_path)) as client:
        original = client.get("/api/layout").json()
        for ranges in (
            {"voltageV": {"minimum": 400, "maximum": 300}},
            {"voltageV": {"minimum": 0, "maximum": float("nan")}},
            {"invented": {"minimum": 0, "maximum": 100}},
        ):
            response = client.put(
                "/api/layout", content=json.dumps({"ranges": ranges}), headers={"Content-Type": "application/json"}
            )
            assert response.status_code == 422
        assert client.get("/api/layout").json() == original


def test_previous_layout_loads_without_replacing_instrument_choices(tmp_path) -> None:
    legacy = {"theme": "day", "units": "imperial", "instruments": ["currentA", "voltageV"]}
    (tmp_path / "layout.json").write_text(json.dumps(legacy))
    engine = Engine(None, Recorder(tmp_path / "sessions", reserve_bytes=0))
    with TestClient(create_app(engine, tmp_path)) as client:
        loaded = client.get("/api/layout").json()
        assert all(loaded[key] == value for key, value in legacy.items())
        assert "presentation" in loaded and "ranges" in loaded


def test_analysis_excludes_active_recordings_and_ignores_browser_replay_clock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = Engine("can0", Recorder(tmp_path / "sessions", reserve_bytes=0))
    monkeypatch.setattr(engine, "start", lambda: None)
    with TestClient(create_app(engine, tmp_path)) as client:
        identifier = client.post("/api/recordings/start").json()["id"]
        engine.ingest(Frame(0x132, bytes.fromhex("8393faff00000000"), 200, 1_000_000_000))
        engine.ingest(Frame(0x132, bytes.fromhex("8393faff00000000"), 100, 3_000_000_000))
        url = f"/api/recordings/{identifier}/analysis"
        assert client.get(url).status_code == 409
        client.post("/api/recordings/stop")
        response = client.get(url)
        assert response.status_code == 200
        result = response.json()
        assert result["sessionId"] == identifier
        assert result["recording"]["durationSeconds"] == 2
        assert "missing_speed" in result["reasons"]
        engine.replay_time = 1e20
        engine.replay_rate = 4
        engine.replay_clock = -1e20
        assert client.get(url).json() == result
        assert client.get("/api/recordings/bad/analysis").status_code == 404
        assert client.get(f"/api/recordings/{'a' * 32}/analysis").status_code == 404
        with engine.analysis_lock:
            assert client.get(url).status_code == 409
        with engine.recorder.completed_recording(identifier):
            assert client.delete(f"/api/recordings/{identifier}").status_code == 409


def test_analysis_rejects_oversized_input_and_does_not_return_changed_recording(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = Engine(None, Recorder(tmp_path / "sessions", reserve_bytes=0))
    identifier = engine.recorder.start()
    engine.recorder.append(Frame(0x132, bytes(8), 0, 1))
    engine.recorder.stop()
    with TestClient(create_app(engine, tmp_path)) as client:
        monkeypatch.setattr("tesla_can_dashboard.analysis.MAX_ANALYSIS_BYTES", 1)
        assert client.get(f"/api/recordings/{identifier}/analysis").status_code == 413
        monkeypatch.undo()

        def mutate_during_analysis(path: Path, decoder: Decoder) -> dict:
            result = analyze_recording(path, decoder)
            with path.open("ab") as stream:
                stream.write(Frame(0x132, bytes(8), 0, 2).encode())
            return result

        monkeypatch.setattr("tesla_can_dashboard.engine.analyze_recording", mutate_during_analysis)
        assert client.get(f"/api/recordings/{identifier}/analysis").status_code == 409
        assert not engine.recorder.analysis_ids
        assert not engine.analysis_lock.locked()

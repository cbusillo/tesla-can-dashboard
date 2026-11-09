import json
import time

from fastapi.testclient import TestClient

from tesla_can_dashboard.api import create_app
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
                saved = client.put("/api/layout", json={"theme": "night", "units": "imperial", "instruments": ["voltageV"]})
                assert saved.status_code == 200
            assert client.get("/api/layout").json()["theme"] == "night"
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
        report = {"browser": "test browser", "updates": 10, "visibility": "visible", "requestTimesMs": [24]}
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

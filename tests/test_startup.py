import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tesla_can_dashboard import __main__ as cli
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Recorder


def test_auto_capture_storage_failure_keeps_cli_server_and_live_receiver(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    served = []
    monkeypatch.setattr(sys, "argv", ["dashboard", "--interface", "synthetic", "--record-on-start", "--data-dir", str(tmp_path)])
    monkeypatch.setattr(Engine, "_receive", lambda _: None)

    def unavailable(_: Recorder) -> str:
        raise OSError("storage unavailable")

    def serve(app: FastAPI, host: str, port: int) -> None:
        with TestClient(app) as client:
            assert client.get("/api/health").json()["mode"] == "live"
            recording = client.get("/api/recordings").json()
            assert recording["activeId"] is None
            assert recording["error"]
            served.append((host, port))

    monkeypatch.setattr(Recorder, "start", unavailable)
    monkeypatch.setattr(cli.uvicorn, "run", serve)
    cli.main()
    assert served


def test_auto_capture_cannot_start_a_demonstration_recording(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["dashboard", "--record-on-start"])
    with pytest.raises(SystemExit) as failure:
        cli.main()
    assert failure.value.code != 0

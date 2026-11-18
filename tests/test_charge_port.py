import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from fastapi.testclient import TestClient

from tesla_can_dashboard.api import create_app
from tesla_can_dashboard.ble_helper import BluetoothControls, ControlServer
from tesla_can_dashboard.controls import VehicleControls
from tesla_can_dashboard.decoder import Decoder
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Recorder
from tesla_can_dashboard.signals import SignalStore


@pytest.fixture
def controls(tmp_path: Path) -> VehicleControls:
    token = tmp_path / "token"
    token.write_text("synthetic-private-access-token-for-testing")
    engine = Engine("can0", Recorder(tmp_path / "recordings", reserve_bytes=0))
    engine.store.update({"chargePortOpen": 0, "driveGear": 1}, {}, time.time())
    return VehicleControls(engine, tmp_path / "helper.sock", token, charge_port=True)


def test_charge_door_feedback_comes_from_operator_profile(tmp_path: Path) -> None:
    profile = tmp_path / "synthetic.dbc"
    profile.write_text("""VERSION "synthetic"
NS_ :
BS_:
BU_: TEST
BO_ 100 ChargeDoor: 1 TEST
 SG_ CP_chargeDoorOpen : 0|1@1+ (1,0) [0|1] "" TEST
""")
    decoder = Decoder(profile)
    assert decoder.decode(100, b"\x01")[0] == {"chargePortOpen": 1}
    assert decoder.decode(100, b"\x00")[0] == {"chargePortOpen": 0}


def test_fractional_door_or_gear_reading_is_invalid() -> None:
    store = SignalStore()
    store.update({"chargePortOpen": 0.5, "driveGear": 1.5}, {}, time.time())
    snapshot = store.snapshot()
    assert snapshot["signals"]["chargePortOpen"]["quality"] == "invalid"
    assert snapshot["signals"]["driveGear"]["quality"] == "invalid"


@pytest.mark.parametrize("condition", ["disabled", "drive", "reverse", "neutral", "gear-stale", "door-stale", "missing", "replay"])
def test_charge_port_never_sends_without_enabled_live_park(controls: VehicleControls, monkeypatch, condition: str) -> None:
    monkeypatch.setattr(controls, "_send", lambda _: pytest.fail("No command is permitted"))
    if condition == "disabled":
        controls.charge_port = False
    elif condition in {"drive", "reverse", "neutral"}:
        controls.engine.store.update({"driveGear": {"drive": 4, "reverse": 2, "neutral": 3}[condition]}, {}, time.time())
    elif condition.endswith("stale"):
        key = "driveGear" if condition == "gear-stale" else "chargePortOpen"
        controls.engine.store.series[key].sample.received_at -= 10
    elif condition == "missing":
        controls.engine.store.series["chargePortOpen"].sample = None
    else:
        controls.engine.replay_state = "playing"
    with pytest.raises(ValueError):
        controls.change_charge_port(True, controls.issue_nonce(), confirmation_seconds=0)


def test_charge_port_requires_later_feedback_and_never_retries(controls: VehicleControls, monkeypatch) -> None:
    sent = []

    def send(payload: dict) -> str:
        sent.append(payload)
        return "acknowledged"

    monkeypatch.setattr(controls, "_send", send)
    nonce = controls.issue_nonce()
    assert controls.change_charge_port(True, nonce, confirmation_seconds=0)["outcome"] == "acknowledged"
    with pytest.raises(ValueError):
        controls.change_charge_port(True, nonce, confirmation_seconds=0)
    assert sent == [{"chargePortOpen": True}]

    def confirmed(payload: dict) -> str:
        controls.engine.store.update({"chargePortOpen": int(payload["chargePortOpen"])}, {}, time.time())
        raise TimeoutError

    monkeypatch.setattr(controls, "_send", confirmed)
    assert controls.change_charge_port(True, controls.issue_nonce())["outcome"] == "confirmed"
    monkeypatch.setattr(controls, "_send", lambda _: pytest.fail("Already open"))
    assert controls.change_charge_port(True, controls.issue_nonce())["outcome"] == "unchanged"


def test_charge_port_api_requires_authentication_opt_in_and_strict_payload(
    controls: VehicleControls, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(controls.engine, "start", lambda: None)
    app = create_app(controls.engine, tmp_path, controls=controls)
    headers = {"Origin": "http://localhost:8088", "Authorization": f"Bearer {controls.token}"}
    with TestClient(app) as client:
        assert "charge-port" in client.get("/api/vehicle-controls").json()["actions"]
        assert (
            client.post(
                "/api/vehicle-controls/charge-port", headers={"Origin": headers["Origin"]}, json={"open": True, "nonce": "unused"}
            ).status_code
            == 401
        )
        for body in [
            {"open": "true", "nonce": "unused"},
            {"open": 1, "nonce": "unused"},
            {"open": True, "nonce": "unused", "command": "unlock"},
        ]:
            assert client.post("/api/vehicle-controls/charge-port", headers=headers, json=body).status_code == 422
        controls.charge_port = False
        assert "charge-port" not in client.get("/api/vehicle-controls").json()["actions"]
        assert (
            client.post(
                "/api/vehicle-controls/charge-port", headers=headers, json={"open": True, "nonce": controls.issue_nonce()}
            ).status_code
            == 409
        )


@pytest.mark.parametrize("opened,command", [(True, "charge-port-open"), (False, "charge-port-close")])
def test_charge_port_helper_opt_in_uses_fixed_command_and_restores_radio(
    tmp_path: Path, monkeypatch, opened: bool, command: str
) -> None:
    (tmp_path / "vin").write_text("synthetic-target")
    bluetooth = BluetoothControls(tmp_path)
    radio = []
    monkeypatch.setattr(bluetooth, "_radio", lambda *args: radio.append(args) or "blocked")
    with pytest.raises(ValueError):
        bluetooth.change_charge_port(opened)
    assert radio == []
    bluetooth.charge_port = True
    calls = []

    def run(arguments: list[str], **kwargs) -> subprocess.CompletedProcess:
        calls.append(arguments)
        return subprocess.CompletedProcess(arguments, 0)

    monkeypatch.setattr(subprocess, "run", run)
    assert bluetooth.change_charge_port(opened)["outcome"] == "acknowledged"
    assert calls[0][-1] == command
    assert radio[-2:] == [("unblock", "bluetooth"), ("block", "bluetooth")]


@pytest.mark.skipif(not hasattr(socket, "SO_PEERCRED"), reason="Linux peer credentials")
@pytest.mark.parametrize(
    "enabled,payload,accepted",
    [
        (True, {"chargePortOpen": True}, True),
        (True, {"chargePortOpen": False}, True),
        (False, {"chargePortOpen": True}, False),
        (True, {"chargePortOpen": 1}, False),
        (True, {"chargePortOpen": "true"}, False),
        (True, {"chargePortOpen": True, "command": "unlock"}, False),
    ],
)
def test_charge_port_helper_wire_requires_opt_in_and_boolean_only(
    tmp_path: Path, monkeypatch, enabled: bool, payload: dict, accepted: bool
) -> None:
    bluetooth = BluetoothControls(tmp_path, charge_port=enabled)
    calls = []
    monkeypatch.setattr(bluetooth, "change_charge_port", lambda value: calls.append(value) or {"outcome": "acknowledged"})
    with TemporaryDirectory(prefix="tc-", dir="/tmp") as directory:
        path = Path(directory) / "s"
        with ControlServer(path, os.getuid(), bluetooth) as server:
            thread = threading.Thread(target=server.handle_request, daemon=True)
            thread.start()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
                peer.connect(str(path))
                peer.sendall(json.dumps(payload).encode() + b"\n")
                peer.recv(1024)
            thread.join(2)
            assert not thread.is_alive()
    assert calls == ([payload["chargePortOpen"]] if accepted else [])

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
from tesla_can_dashboard.controls import MAXIMUM_CHARGE_LIMIT_PERCENT, MINIMUM_CHARGE_LIMIT_PERCENT, VehicleControls
from tesla_can_dashboard.decoder import Decoder
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Recorder
from tesla_can_dashboard.signals import SignalStore


@pytest.fixture
def controller(tmp_path: Path) -> VehicleControls:
    token = tmp_path / "access-code"
    token.write_text("test-only-access-code-not-a-real-key")
    engine = Engine("can0", Recorder(tmp_path / "sessions", reserve_bytes=0))
    engine.store.update({"driverTemperatureC": 19.5, "passengerTemperatureC": 19.5}, {}, time.time())
    return VehicleControls(engine, tmp_path / "private.sock", token)


def test_hvac_profile_decodes_independent_sides_and_preserves_lo_hi(tmp_path: Path) -> None:
    profile = tmp_path / "climate.dbc"
    profile.write_text("""VERSION "synthetic"
NS_ :
BS_:
BU_: TEST
BO_ 100 Climate: 8 TEST
 SG_ UI_hvacReqTempSetpointLeft : 0|5@1+ (0.5,15) [15|28] "degC" TEST
 SG_ UI_hvacReqTempSetpointRight : 8|5@1+ (0.5,15) [15|28] "C" TEST
VAL_ 100 UI_hvacReqTempSetpointLeft 0 "LO" 26 "HI";
""")
    decoder = Decoder(profile)
    assert decoder.decode(100, bytes([9, 10, 0, 0, 0, 0, 0, 0]))[0] == {
        "driverTemperatureC": 19.5,
        "passengerTemperatureC": 20,
    }
    values, _ = decoder.decode(100, bytes([0, 26, 0, 0, 0, 0, 0, 0]))
    store = SignalStore()
    store.update(values, {}, time.time())
    assert all(store.snapshot()["signals"][key]["value"] is None for key in values)
    with pytest.raises(ValueError, match="length"):
        decoder.decode(100, bytes(5))


def test_acknowledgement_without_new_can_is_not_confirmation(controller: VehicleControls, monkeypatch) -> None:
    calls = []

    def send(payload: dict) -> str:
        target = payload["temperatureC"]
        calls.append(target)
        controller.engine.store.update(
            {"driverTemperatureC": target, "passengerTemperatureC": target}, {}, time.time(), now=time.monotonic() - 1
        )
        return "acknowledged"

    monkeypatch.setattr(controller, "_send", send)
    nonce = controller.issue_nonce()
    assert controller.change(20, nonce, confirmation_seconds=0.02)["outcome"] == "acknowledged"
    with pytest.raises(ValueError, match="already used"):
        controller.change(20, nonce, confirmation_seconds=0)
    assert calls == [20]


def test_new_can_from_both_sides_confirms_even_when_ack_is_lost(controller: VehicleControls, monkeypatch) -> None:
    def send(payload: dict) -> str:
        target = payload["temperatureC"]
        controller.engine.store.update({"driverTemperatureC": target, "passengerTemperatureC": target}, {}, time.time())
        raise TimeoutError

    monkeypatch.setattr(controller, "_send", send)
    assert controller.change(20, controller.issue_nonce())["outcome"] == "confirmed"


@pytest.mark.parametrize("condition", ["stale", "replay", "missing", "disconnected"])
def test_non_live_inputs_never_send(controller: VehicleControls, monkeypatch, condition: str) -> None:
    def forbidden(_: float) -> str:
        pytest.fail("A non-live reading must never cause a command")

    monkeypatch.setattr(controller, "_send", forbidden)
    if condition == "replay":
        controller.engine.replay_state = "playing"
    elif condition == "disconnected":
        controller.engine.interface = None
    elif condition == "missing":
        controller.engine.store.series["passengerTemperatureC"].sample = None
    else:
        for series in controller.engine.store.series.values():
            if series.sample:
                series.sample.received_at -= 10
    with pytest.raises(ValueError, match="unavailable"):
        controller.change(20, controller.issue_nonce())


def test_unchanged_target_does_not_transmit(controller: VehicleControls, monkeypatch) -> None:
    monkeypatch.setattr(controller, "_send", lambda _: pytest.fail("Already set"))
    assert controller.change(19.5, controller.issue_nonce())["outcome"] == "unchanged"


def test_api_requires_access_code_and_dashboard_origin(controller: VehicleControls, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(controller.engine, "start", lambda: None)
    app = create_app(controller.engine, tmp_path, controls=controller)
    headers = {"Origin": "http://localhost:8088", "Authorization": f"Bearer {controller.token}"}
    with TestClient(app) as client:
        assert client.post("/api/vehicle-controls/prepare", headers={"Origin": headers["Origin"]}).status_code == 401
        assert (
            client.post("/api/vehicle-controls/prepare", headers={**headers, "Origin": "https://other.example"}).status_code == 403
        )
        prepared = client.post("/api/vehicle-controls/prepare", headers=headers)
        assert prepared.status_code == 200
        body = {"temperatureC": 20.1, "nonce": prepared.json()["nonce"]}
        assert client.post("/api/vehicle-controls/temperature", headers=headers, json=body).status_code == 422
        body.update(temperatureC=20, command="unlock")
        assert client.post("/api/vehicle-controls/temperature", headers=headers, json=body).status_code == 422


def test_helper_restores_radio_after_command_timeout(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "vin").write_text("synthetic-test-target")
    bluetooth = BluetoothControls(tmp_path)
    radio_calls = []
    monkeypatch.setattr(bluetooth, "_radio", lambda *args: radio_calls.append(args) or "blocked")

    def timeout(*args, **kwargs) -> None:
        raise subprocess.TimeoutExpired("synthetic", 25)

    monkeypatch.setattr(subprocess, "run", timeout)
    with pytest.raises(subprocess.TimeoutExpired):
        bluetooth.change(20)
    assert radio_calls[-2:] == [("unblock", "bluetooth"), ("block", "bluetooth")]


def test_helper_passes_only_fixed_command_and_keeps_target_out_of_arguments(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "vin").write_text("synthetic-test-target")
    bluetooth = BluetoothControls(tmp_path)
    monkeypatch.setattr(bluetooth, "_radio", lambda *args: "unblocked")
    calls = []

    def run(arguments: list[str], **kwargs) -> subprocess.CompletedProcess:
        calls.append((arguments, kwargs))
        return subprocess.CompletedProcess(arguments, 0)

    monkeypatch.setattr(subprocess, "run", run)
    assert bluetooth.change(19.5)["outcome"] == "acknowledged"
    arguments, options = calls[0]
    assert arguments[-1] == "19.5C"
    assert "synthetic-test-target" not in json.dumps(arguments)
    assert options["env"]["TESLA_VIN"] == "synthetic-test-target"


def test_browser_access_survives_reload_but_disconnect_and_rotation_revoke_it(
    controller: VehicleControls, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(controller.engine, "start", lambda: None)
    origin = "https://dashboard.example"
    app = create_app(controller.engine, tmp_path, allowed_origins={origin}, controls=controller)
    with TestClient(app, base_url=origin) as client:
        assert not client.get("/api/vehicle-controls").json()["connected"]
        response = client.post(
            "/api/vehicle-controls/connect", headers={"Origin": origin, "Authorization": f"Bearer {controller.token}"}
        )
        assert response.status_code == 200
        assert client.get("/api/vehicle-controls").json()["connected"]
        assert client.post("/api/vehicle-controls/prepare", headers={"Origin": origin}).status_code == 200
        assert client.post("/api/vehicle-controls/prepare").status_code == 403
        assert client.post("/api/vehicle-controls/disconnect", headers={"Origin": origin}).status_code == 200
        assert not client.get("/api/vehicle-controls").json()["connected"]
        client.cookies.set("tesla_controls", controller.token, path="/api/vehicle-controls")
        controller.token = "replacement-test-code-that-invalidates-old-access"
        assert not client.get("/api/vehicle-controls").json()["connected"]
        assert client.post("/api/vehicle-controls/prepare", headers={"Origin": origin}).status_code == 401
        assert client.post("/api/vehicle-controls/disconnect", headers={"Origin": origin}).status_code == 200


def test_controls_require_a_secure_origin_and_separate_preview(controller: VehicleControls, tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        create_app(controller.engine, tmp_path, allowed_origins={"http://dashboard.example"}, controls=controller)
    with pytest.raises(ValueError):
        create_app(controller.engine, tmp_path, designs=tmp_path, controls=controller)


def test_missing_helper_is_not_reported_as_an_uncertain_vehicle_command(controller: VehicleControls) -> None:
    with pytest.raises(ValueError):
        controller.change(20, controller.issue_nonce())


@pytest.mark.parametrize(
    "reply,expected", [(b'{"outcome":"acknowledged"}\n', "acknowledged"), (b'{"outcome":"unknown"}\n', "unknown"), (b"", "unknown")]
)
def test_helper_wire_reply_preserves_acknowledgement_and_uncertainty(
    controller: VehicleControls, reply: bytes, expected: str
) -> None:
    with TemporaryDirectory(prefix="tc-", dir="/tmp") as directory, socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
        controller.socket_path = Path(directory) / "s"
        listener.bind(str(controller.socket_path))
        listener.listen(1)

        def respond() -> None:
            with listener.accept()[0] as peer:
                peer.recv(1024)
                peer.sendall(reply)

        thread = threading.Thread(target=respond, daemon=True)
        thread.start()
        assert controller.change(20, controller.issue_nonce(), confirmation_seconds=0.01)["outcome"] == expected
        thread.join(2)
        assert not thread.is_alive()


def test_charge_limit_uses_the_same_single_use_can_confirmation_path(controller: VehicleControls, monkeypatch) -> None:
    controller.engine.store.update({"chargeLimitPercent": 70}, {}, time.time())
    sent = []

    def send(payload: dict) -> str:
        sent.append(payload)
        controller.engine.store.update({"chargeLimitPercent": payload["chargeLimitPercent"]}, {}, time.time())
        return "acknowledged"

    monkeypatch.setattr(controller, "_send", send)
    nonce = controller.issue_nonce()
    assert controller.change_charge_limit(69, nonce)["outcome"] == "confirmed"
    assert sent == [{"chargeLimitPercent": 69}]
    with pytest.raises(ValueError):
        controller.change_charge_limit(69, nonce)
    assert len(sent) == 1


def test_charge_limit_cannot_send_into_a_quiet_bus_even_while_its_setting_is_fresh(controller: VehicleControls, monkeypatch) -> None:
    now = time.monotonic()
    controller.engine.store.update({"chargeLimitPercent": 70}, {}, time.time(), now=now - 10)
    assert controller.engine.store.snapshot()["signals"]["chargeLimitPercent"]["quality"] == "fresh"
    monkeypatch.setattr(controller, "_send", lambda _: pytest.fail("Quiet bus must not trigger a command"))
    with pytest.raises(ValueError):
        controller.change_charge_limit(69, controller.issue_nonce())


@pytest.mark.parametrize("value", [MINIMUM_CHARGE_LIMIT_PERCENT - 1, MAXIMUM_CHARGE_LIMIT_PERCENT + 1, 70.5, True, "70"])
def test_invalid_charge_limit_never_reaches_helper(controller: VehicleControls, monkeypatch, value: object) -> None:
    monkeypatch.setattr(controller, "_send", lambda _: pytest.fail("Invalid setting must not transmit"))
    with pytest.raises(ValueError):
        controller.change_charge_limit(value, controller.issue_nonce())


def test_charge_endpoint_requires_access_and_does_not_accept_other_commands(
    controller: VehicleControls, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(controller.engine, "start", lambda: None)
    controller.engine.store.update({"chargeLimitPercent": 70}, {}, time.time())
    app = create_app(controller.engine, tmp_path, controls=controller)
    headers = {"Origin": "http://localhost:8088", "Authorization": f"Bearer {controller.token}"}
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/vehicle-controls/charge-limit", headers={"Origin": headers["Origin"]}, json={"percent": 69, "nonce": "unused"}
            ).status_code
            == 401
        )
        nonce = client.post("/api/vehicle-controls/prepare", headers=headers).json()["nonce"]
        assert (
            client.post("/api/vehicle-controls/charge-limit", headers=headers, json={"percent": 69.5, "nonce": nonce}).status_code
            == 422
        )
        assert (
            client.post(
                "/api/vehicle-controls/charge-limit",
                headers=headers,
                json={"percent": 69, "nonce": nonce, "command": "charging-start"},
            ).status_code
            == 422
        )
        assert (
            client.post("/api/vehicle-controls/charge-limit", headers=headers, json={"percent": 70, "nonce": nonce}).json()[
                "outcome"
            ]
            == "unchanged"
        )


@pytest.mark.skipif(not hasattr(socket, "SO_PEERCRED"), reason="Linux peer credentials")
@pytest.mark.parametrize(
    "payload,accepted",
    [
        ({"chargeLimitPercent": 69}, True),
        ({"chargeLimitPercent": True}, False),
        ({"chargeLimitPercent": 70.5}, False),
        ({"chargeLimitPercent": 69, "temperatureC": 20}, False),
        ({"command": "charging-start"}, False),
    ],
)
def test_helper_whitelist_accepts_only_the_single_valid_charge_limit(
    tmp_path: Path, monkeypatch, payload: dict, accepted: bool
) -> None:
    bluetooth = BluetoothControls(tmp_path)
    calls = []
    monkeypatch.setattr(bluetooth, "change", lambda _: pytest.fail("No temperature command expected"))
    monkeypatch.setattr(bluetooth, "change_charge_limit", lambda value: calls.append(value) or {"outcome": "acknowledged"})
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
    assert calls == ([payload["chargeLimitPercent"]] if accepted else [])


def test_charge_helper_invokes_only_the_fixed_limit_command(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "vin").write_text("synthetic-test-target")
    bluetooth = BluetoothControls(tmp_path)
    monkeypatch.setattr(bluetooth, "_radio", lambda *args: "unblocked")
    calls = []

    def run(arguments: list[str], **kwargs) -> subprocess.CompletedProcess:
        calls.append(arguments)
        return subprocess.CompletedProcess(arguments, 0)

    monkeypatch.setattr(subprocess, "run", run)
    assert bluetooth.change_charge_limit(69)["outcome"] == "acknowledged"
    assert calls[0][-2:] == ["charging-set-limit", "69"]


def test_busy_and_expired_changes_never_send(controller: VehicleControls, monkeypatch) -> None:
    monkeypatch.setattr(controller, "_send", lambda _: pytest.fail("No command expected"))
    nonce = controller.issue_nonce()
    controller.nonces[nonce] = time.monotonic() - 1
    with pytest.raises(ValueError, match="expired"):
        controller.change(20, nonce)
    with controller.lock:
        with pytest.raises(ValueError, match="in progress"):
            controller.change(20, controller.issue_nonce())


@pytest.mark.skipif(not hasattr(socket, "SO_PEERCRED"), reason="Linux peer credentials")
def test_helper_rejects_another_local_identity_before_reading_command(tmp_path: Path, monkeypatch) -> None:
    bluetooth = BluetoothControls(tmp_path)
    monkeypatch.setattr(bluetooth, "change", lambda _: pytest.fail("Wrong identity must never command the vehicle"))
    path = tmp_path / "helper.sock"
    with ControlServer(path, os.getuid() + 1, bluetooth) as server:
        thread = threading.Thread(target=server.handle_request, daemon=True)
        thread.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(path))
            assert client.recv(100) == b""
        thread.join(2)
        assert not thread.is_alive()

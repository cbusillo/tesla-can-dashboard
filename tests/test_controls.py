import json
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tesla_can_dashboard.api import create_app
from tesla_can_dashboard.ble_helper import BluetoothTemperature
from tesla_can_dashboard.controls import TemperatureControls
from tesla_can_dashboard.decoder import Decoder
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Recorder


@pytest.fixture
def controller(tmp_path: Path) -> TemperatureControls:
    token = tmp_path / "access-code"
    token.write_text("test-only-access-code-not-a-real-key")
    engine = Engine("can0", Recorder(tmp_path / "sessions", reserve_bytes=0))
    engine.store.update({"driverTemperatureC": 19.5, "passengerTemperatureC": 19.5}, {}, time.time())
    return TemperatureControls(engine, tmp_path / "private.sock", token)


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
    assert values == {"driverTemperatureC": None, "passengerTemperatureC": None}
    with pytest.raises(ValueError, match="length"):
        decoder.decode(100, bytes(5))


def test_acknowledgement_without_new_can_is_not_confirmation(controller: TemperatureControls, monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(controller, "_send", lambda target: calls.append(target) or "acknowledged")
    nonce = controller.issue_nonce()
    assert controller.change(20, nonce, confirmation_seconds=0)["outcome"] == "acknowledged"
    with pytest.raises(ValueError, match="already used"):
        controller.change(20, nonce, confirmation_seconds=0)
    assert calls == [20]


def test_new_can_from_both_sides_confirms_even_when_ack_is_lost(controller: TemperatureControls, monkeypatch) -> None:
    def send(target: float) -> str:
        controller.engine.store.update({"driverTemperatureC": target, "passengerTemperatureC": target}, {}, time.time())
        raise TimeoutError

    monkeypatch.setattr(controller, "_send", send)
    assert controller.change(20, controller.issue_nonce())["outcome"] == "confirmed"


@pytest.mark.parametrize("condition", ["stale", "replay", "missing", "disconnected"])
def test_non_live_inputs_never_send(controller: TemperatureControls, monkeypatch, condition: str) -> None:
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


def test_unchanged_target_does_not_transmit(controller: TemperatureControls, monkeypatch) -> None:
    monkeypatch.setattr(controller, "_send", lambda _: pytest.fail("Already set"))
    assert controller.change(19.5, controller.issue_nonce())["outcome"] == "unchanged"


def test_api_requires_access_code_and_dashboard_origin(controller: TemperatureControls, tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(controller.engine, "start", lambda: None)
    app = create_app(controller.engine, tmp_path, controls=controller)
    headers = {"Origin": "http://localhost:8088", "Authorization": f"Bearer {controller.token}"}
    with TestClient(app) as client:
        assert client.post("/api/vehicle-controls/prepare").status_code == 403
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
    bluetooth = BluetoothTemperature(tmp_path)
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
    bluetooth = BluetoothTemperature(tmp_path)
    monkeypatch.setattr(bluetooth, "_radio", lambda *args: "unblocked")
    calls = []

    def run(arguments: list[str], **kwargs) -> subprocess.CompletedProcess:
        calls.append((arguments, kwargs))
        return subprocess.CompletedProcess(arguments, 0)

    monkeypatch.setattr(subprocess, "run", run)
    assert bluetooth.change(20)["outcome"] == "acknowledged"
    arguments, options = calls[0]
    assert arguments[-2:] == ["climate-set-temp", "20C"]
    assert "synthetic-test-target" not in json.dumps(arguments)
    assert options["env"]["TESLA_VIN"] == "synthetic-test-target"

import hmac
import json
import math
import secrets
import socket
import threading
import time
from pathlib import Path
from typing import cast

from .engine import Engine
from .signals import CATALOG

TEMPERATURE_KEYS = ("driverTemperatureC", "passengerTemperatureC")
MINIMUM_TEMPERATURE_C = 16
MAXIMUM_TEMPERATURE_C = 27
TEMPERATURE_STEP_C = 0.5
MINIMUM_CHARGE_LIMIT_PERCENT = 50
MAXIMUM_CHARGE_LIMIT_PERCENT = 100


class HelperUnavailable(OSError):
    pass


def valid_temperature(value: object) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    number = cast(float, value)
    return (
        MINIMUM_TEMPERATURE_C <= number <= MAXIMUM_TEMPERATURE_C
        and math.isfinite(number)
        and number / TEMPERATURE_STEP_C == int(number / TEMPERATURE_STEP_C)
    )


def valid_charge_limit(value: object) -> bool:
    return type(value) is int and MINIMUM_CHARGE_LIMIT_PERCENT <= value <= MAXIMUM_CHARGE_LIMIT_PERCENT


class VehicleControls:
    def __init__(self, engine: Engine, socket_path: Path, token_file: Path) -> None:
        self.engine = engine
        self.socket_path = socket_path
        self.token = token_file.read_text().strip()
        if len(self.token) < 32:
            raise ValueError("Controls need a private access code of at least 32 characters")
        self.lock = threading.Lock()
        self.nonce_lock = threading.Lock()
        self.nonces: dict[str, float] = {}

    def authenticated(self, authorization: str) -> bool:
        return hmac.compare_digest(authorization.encode(), f"Bearer {self.token}".encode())

    def issue_nonce(self) -> str:
        now = time.monotonic()
        with self.nonce_lock:
            self.nonces = {key: expires for key, expires in self.nonces.items() if expires > now}
            if len(self.nonces) >= 32:
                raise ValueError("Too many pending changes")
            nonce = secrets.token_urlsafe(24)
            self.nonces[nonce] = now + 60
        return nonce

    def _live_values(self, keys: tuple[str, ...], after: float = 0) -> dict[str, float] | None:
        if not self.engine.interface or self.engine.replay_state != "stopped":
            return None
        store = self.engine.store
        now = time.monotonic()
        with store.lock:
            if not store.is_connected(now):
                return None
            readings = {}
            for key in keys:
                sample = store.series[key].sample
                if (
                    sample is None
                    or not sample.valid
                    or sample.value is None
                    or sample.received_at <= after
                    or now - sample.received_at > CATALOG[key].stale_after
                ):
                    return None
                readings[key] = sample.value
            return readings

    def _send(self, payload: dict[str, float | int]) -> str:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(40)
            try:
                connection.connect(str(self.socket_path))
            except OSError as error:
                raise HelperUnavailable from error
            connection.sendall(json.dumps(payload).encode() + b"\n")
            with connection.makefile("rb") as response:
                data = json.loads(response.readline(1024))
            return "acknowledged" if data.get("outcome") == "acknowledged" else "unknown"

    def change(self, temperature: float, nonce: str, confirmation_seconds: float = 5) -> dict:
        if not valid_temperature(temperature):
            raise ValueError("Choose 16–27°C in half-degree steps")
        return self._change("temperatureC", temperature, TEMPERATURE_KEYS, nonce, confirmation_seconds)

    def change_charge_limit(self, percent: int, nonce: str, confirmation_seconds: float = 5) -> dict:
        if not valid_charge_limit(percent):
            raise ValueError("Choose a whole percentage from 50 to 100")
        return self._change("chargeLimitPercent", percent, ("chargeLimitPercent",), nonce, confirmation_seconds)

    def _change(self, field: str, target: float | int, keys: tuple[str, ...], nonce: str, confirmation_seconds: float) -> dict:
        with self.nonce_lock:
            expires = self.nonces.pop(nonce, 0)
        if expires <= time.monotonic():
            raise ValueError("Change expired or already used; check the current reading")
        if not self.lock.acquire(blocking=False):
            raise ValueError("Another change is still in progress")
        if not self.engine.control_lock.acquire(blocking=False):
            self.lock.release()
            raise ValueError("Replay is changing; check the live view")
        try:
            before = self._live_values(keys)
            if before is None:
                raise ValueError("Live readings are unavailable")
            if all(value == target for value in before.values()):
                return {"outcome": "unchanged", field: target}
            started = time.monotonic()
            try:
                acknowledgement = self._send({field: target})
            except HelperUnavailable:
                raise ValueError("Controls are offline. No change was sent.") from None
            except (OSError, ValueError):
                acknowledgement = "unknown"
            deadline = time.monotonic() + confirmation_seconds
            while time.monotonic() < deadline:
                observed = self._live_values(keys, after=started)
                if observed is not None and all(value == target for value in observed.values()):
                    return {"outcome": "confirmed", field: target}
                time.sleep(0.1)
            return {"outcome": acknowledgement, field: target}
        finally:
            self.engine.control_lock.release()
            self.lock.release()

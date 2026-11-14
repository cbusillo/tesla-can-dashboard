import hmac
import json
import math
import secrets
import socket
import threading
import time
from pathlib import Path

from .engine import Engine
from .signals import CATALOG

TEMPERATURE_KEYS = ("driverTemperatureC", "passengerTemperatureC")


def valid_temperature(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and 16 <= value <= 27 and value * 2 == int(value * 2)


class TemperatureControls:
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

    def live_temperatures(self, after: float = 0) -> dict[str, float] | None:
        if not self.engine.interface or self.engine.replay_state != "stopped":
            return None
        store = self.engine.store
        now = time.monotonic()
        with store.lock:
            readings = {}
            for key in TEMPERATURE_KEYS:
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

    def _send(self, temperature: float) -> str:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(30)
            connection.connect(str(self.socket_path))
            connection.sendall(json.dumps({"temperatureC": temperature}).encode() + b"\n")
            with connection.makefile("rb") as response:
                data = json.loads(response.readline(1024))
            return "acknowledged" if data.get("outcome") == "acknowledged" else "unknown"

    def change(self, temperature: float, nonce: str, confirmation_seconds: float = 5) -> dict:
        if not valid_temperature(temperature):
            raise ValueError("Choose 16–27°C in half-degree steps")
        with self.nonce_lock:
            expires = self.nonces.pop(nonce, 0)
        if expires <= time.monotonic():
            raise ValueError("Change expired or already used; check the current temperature")
        if not self.lock.acquire(blocking=False):
            raise ValueError("Another change is still in progress")
        if not self.engine.control_lock.acquire(blocking=False):
            self.lock.release()
            raise ValueError("Replay is changing; check the live view")
        try:
            before = self.live_temperatures()
            if before is None:
                raise ValueError("Live cabin temperatures are unavailable")
            if all(value == temperature for value in before.values()):
                return {"outcome": "unchanged", "temperatureC": temperature}
            started = time.monotonic()
            try:
                acknowledgement = self._send(temperature)
            except (OSError, ValueError):
                acknowledgement = "unknown"
            deadline = time.monotonic() + confirmation_seconds
            while time.monotonic() < deadline:
                observed = self.live_temperatures(after=started)
                if observed is not None and all(value == temperature for value in observed.values()):
                    return {"outcome": "confirmed", "temperatureC": temperature}
                time.sleep(0.1)
            return {"outcome": acknowledgement, "temperatureC": temperature}
        finally:
            self.engine.control_lock.release()
            self.lock.release()

import hashlib
import hmac
import json
import math
import secrets
import socket
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict, cast

from .engine import Engine
from .signals import CATALOG

TEMPERATURE_KEYS = ("driverTemperatureC", "passengerTemperatureC")
MINIMUM_TEMPERATURE_C = 16
MAXIMUM_TEMPERATURE_C = 27
TEMPERATURE_STEP_C = 0.5
MINIMUM_CHARGE_LIMIT_PERCENT = 50
MAXIMUM_CHARGE_LIMIT_PERCENT = 100
BROWSER_REQUEST_SECONDS = 300
BROWSER_SESSION_SECONDS = 30 * 86400
MAXIMUM_BROWSER_REQUESTS = 10
MAXIMUM_BROWSER_REQUESTS_PER_CLIENT = 2
BROWSER_REQUEST_COOKIE = "__Host-tesla_control_request"
BROWSER_SESSION_COOKIE = "__Host-tesla_controls"


class BrowserPrompt(TypedDict):
    number: str
    expiresInSeconds: int


class PendingBrowser(BrowserPrompt):
    requestId: str


@dataclass
class BrowserRequest:
    number: str
    client: str
    secret_hash: bytes
    expires: float
    approved: bool = False


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
        self.browser_lock = threading.Lock()
        self.browser_requests: dict[str, BrowserRequest] = {}

    def authenticated(self, authorization: str) -> bool:
        return hmac.compare_digest(authorization.encode(), f"Bearer {self.token}".encode())

    def _session_signature(self, payload: str) -> str:
        return hmac.new(self.token.encode(), f"tesla-browser-session:{payload}".encode(), hashlib.sha256).hexdigest()

    def issue_browser_session(self) -> str:
        payload = f"v1.{int(time.time()) + BROWSER_SESSION_SECONDS}.{secrets.token_urlsafe(24)}"
        return f"{payload}.{self._session_signature(payload)}"

    def authenticated_browser(self, cookie: str) -> bool:
        try:
            payload, signature = cookie.rsplit(".", 1)
            if not hmac.compare_digest(self._session_signature(payload).encode(), signature.encode()):
                return False
            version, expires, _ = payload.split(".")
            return version == "v1" and int(expires) > time.time()
        except ValueError:
            return False

    def _expire_browser_requests_locked(self) -> None:
        now = time.monotonic()
        self.browser_requests = {number: request for number, request in self.browser_requests.items() if request.expires > now}

    def _browser_request_locked(self, cookie: str) -> tuple[str, BrowserRequest] | None:
        request_id, _, secret = cookie.partition(".")
        request = self.browser_requests.get(request_id)
        if request is None or not hmac.compare_digest(request.secret_hash, hashlib.sha256(secret.encode()).digest()):
            return None
        return request_id, request

    def request_browser(self, cookie: str, client: str) -> tuple[BrowserPrompt, str]:
        with self.browser_lock:
            self._expire_browser_requests_locked()
            existing = self._browser_request_locked(cookie)
            if existing is not None:
                _, request = existing
                return BrowserPrompt(number=request.number, expiresInSeconds=max(0, int(request.expires - time.monotonic()))), cookie
            if len(self.browser_requests) >= MAXIMUM_BROWSER_REQUESTS:
                raise ValueError("Too many connection requests. Try again in a few minutes.")
            if sum(request.client == client for request in self.browser_requests.values()) >= MAXIMUM_BROWSER_REQUESTS_PER_CLIENT:
                raise ValueError("Other connections are waiting. Finish one or try again in a few minutes.")
            number = f"{secrets.randbelow(1_000_000):06d}"
            while any(request.number == number for request in self.browser_requests.values()):
                number = f"{secrets.randbelow(1_000_000):06d}"
            request_id = secrets.token_urlsafe(16)
            secret = secrets.token_urlsafe(32)
            self.browser_requests[request_id] = BrowserRequest(
                number, client, hashlib.sha256(secret.encode()).digest(), time.monotonic() + BROWSER_REQUEST_SECONDS
            )
            return BrowserPrompt(number=number, expiresInSeconds=BROWSER_REQUEST_SECONDS), f"{request_id}.{secret}"

    def pending_browsers(self) -> list[PendingBrowser]:
        with self.browser_lock:
            self._expire_browser_requests_locked()
            return [
                {
                    "requestId": request_id,
                    "number": request.number,
                    "expiresInSeconds": max(0, int(request.expires - time.monotonic())),
                }
                for request_id, request in self.browser_requests.items()
                if not request.approved
            ]

    def approve_browser(self, request_id: str) -> None:
        with self.browser_lock:
            self._expire_browser_requests_locked()
            request = self.browser_requests.get(request_id)
            if request is None:
                raise ValueError("Request expired. Connect again.")
            request.approved = True

    def consume_browser_request(self, cookie: str) -> bool:
        with self.browser_lock:
            self._expire_browser_requests_locked()
            matched = self._browser_request_locked(cookie)
            if matched is None:
                raise ValueError("Request expired. Connect again.")
            number, request = matched
            if not request.approved:
                return False
            del self.browser_requests[number]
            return True

    def cancel_browser_request(self, cookie: str) -> None:
        with self.browser_lock:
            matched = self._browser_request_locked(cookie)
            if matched is not None:
                del self.browser_requests[matched[0]]

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

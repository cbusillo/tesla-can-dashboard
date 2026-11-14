import socket
import threading
import time
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import NoReturn, cast

import pytest
from fastapi.testclient import TestClient

from tesla_can_dashboard import browser_approval
from tesla_can_dashboard.api import create_app
from tesla_can_dashboard.controls import (
    BROWSER_REQUEST_COOKIE,
    BROWSER_REQUEST_SECONDS,
    BROWSER_SESSION_COOKIE,
    BROWSER_SESSION_SECONDS,
    MAXIMUM_BROWSER_REQUESTS,
    MAXIMUM_BROWSER_REQUESTS_PER_CLIENT,
    VehicleControls,
)
from tesla_can_dashboard.engine import Engine
from tesla_can_dashboard.recording import Recorder


@pytest.fixture
def browser_setup(tmp_path: Path, monkeypatch):
    token = tmp_path / "access-code"
    token.write_text("synthetic-browser-master-code-for-tests-only")
    engine = Engine("can0", Recorder(tmp_path / "raw", reserve_bytes=0))
    monkeypatch.setattr(engine, "start", lambda: None)
    controls = VehicleControls(engine, tmp_path / "absent-helper", token)

    def forbid_vehicle_command(payload: dict) -> NoReturn:
        raise AssertionError(f"Browser approval must not call the vehicle helper: {payload}")

    monkeypatch.setattr(controls, "_send", forbid_vehicle_command)
    origin = "https://dashboard.example"
    app = create_app(engine, tmp_path, allowed_origins={origin}, controls=controls)
    return app, controls, origin


def test_browser_needs_operator_approval_and_its_own_secret_then_receives_a_scoped_session(browser_setup) -> None:
    app, controls, origin = browser_setup
    with TestClient(app, base_url=origin) as browser, TestClient(app, base_url=origin) as stranger:
        response = browser.post("/api/vehicle-controls/connection-request", headers={"Origin": origin})
        assert response.status_code == 200
        number = response.json()["number"]
        cookies = browser.cookies
        cookie = cookies.get(BROWSER_REQUEST_COOKIE)
        assert cookie is not None and cookie not in response.text and controls.token not in response.text
        request_cookie = next(entry for entry in cast(CookieJar, cookies.jar) if entry.name == BROWSER_REQUEST_COOKIE)
        assert request_cookie.secure and not request_cookie.domain_specified and request_cookie.path == "/"
        assert request_cookie.has_nonstandard_attr("HttpOnly")
        assert not browser.post("/api/vehicle-controls/connection-request/exchange", headers={"Origin": origin}).json()["connected"]
        assert browser.post("/api/vehicle-controls/prepare", headers={"Origin": origin}).status_code == 401
        assert stranger.get("/api/vehicle-controls/browser-requests").status_code == 401
        operator = {"Authorization": f"Bearer {controls.token}", "Origin": origin}
        pending = stranger.get("/api/vehicle-controls/browser-requests", headers=operator).json()["pending"]
        assert len(pending) == 1 and pending[0]["number"] == number
        request_id = pending[0]["requestId"]
        for headers in ({}, {"Origin": "https://other.example"}):
            assert browser.post("/api/vehicle-controls/connection-request/exchange", headers=headers).status_code == 403
        assert stranger.post(f"/api/vehicle-controls/browser-requests/{number}/approve", headers=operator).status_code == 404
        assert stranger.post(f"/api/vehicle-controls/browser-requests/{request_id}/approve", headers=operator).status_code == 200
        stranger.cookies.set(BROWSER_REQUEST_COOKIE, f"{request_id}.wrong-secret")
        assert stranger.post("/api/vehicle-controls/connection-request/exchange", headers={"Origin": origin}).status_code == 404
        assert browser.post("/api/vehicle-controls/connection-request/exchange", headers={"Origin": origin}).json()["connected"]
        session = cookies.get(BROWSER_SESSION_COOKIE)
        assert session and controls.token not in session and session != cookie
        session_cookie = next(entry for entry in cast(CookieJar, cookies.jar) if entry.name == BROWSER_SESSION_COOKIE)
        assert session_cookie.secure and not session_cookie.domain_specified and session_cookie.path == "/"
        assert session_cookie.has_nonstandard_attr("HttpOnly")
        assert browser.get("/api/vehicle-controls").json()["connected"]
        assert browser.post("/api/vehicle-controls/connect", headers={"Origin": origin}).status_code == 401
        assert browser.get("/api/vehicle-controls/browser-requests").status_code == 401
        assert (
            browser.get("/api/vehicle-controls/browser-requests", headers={"Authorization": f"Bearer {session}"}).status_code == 401
        )
        assert (
            browser.post(f"/api/vehicle-controls/browser-requests/{request_id}/approve", headers={"Origin": origin}).status_code
            == 401
        )
        assert not controls.browser_requests
        stranger.cookies.set(BROWSER_REQUEST_COOKIE, cookie)
        assert stranger.post("/api/vehicle-controls/connection-request/exchange", headers={"Origin": origin}).status_code == 404
        assert browser.post("/api/vehicle-controls/disconnect", headers={"Origin": origin}).status_code == 200
        assert not browser.get("/api/vehicle-controls").json()["connected"]


def test_session_survives_a_server_restart_but_pending_approval_does_not(browser_setup, tmp_path: Path) -> None:
    _, controls, _ = browser_setup
    session = controls.issue_browser_session()
    _, pending_cookie = controls.request_browser("", "synthetic-client")
    token = tmp_path / "same-master"
    token.write_text(controls.token)
    restarted = VehicleControls(controls.engine, tmp_path / "absent-helper", token)
    assert restarted.authenticated_browser(session)
    with pytest.raises(ValueError):
        restarted.consume_browser_request(pending_cookie)


def test_cancelling_an_approved_request_before_exchange_cannot_mint_a_session(browser_setup) -> None:
    _, controls, _ = browser_setup
    _, cookie = controls.request_browser("", "synthetic-client")
    request_id = controls.pending_browsers()[0]["requestId"]
    controls.approve_browser(request_id)
    controls.cancel_browser_request(cookie)
    with pytest.raises(ValueError):
        controls.consume_browser_request(cookie)


def test_requests_expire_cancel_and_do_not_refresh_their_lifetime(browser_setup, monkeypatch) -> None:
    app, controls, origin = browser_setup
    with TestClient(app, base_url=origin) as browser:
        first = browser.post("/api/vehicle-controls/connection-request", headers={"Origin": origin}).json()
        original_clock = time.monotonic()
        assert (
            browser.post("/api/vehicle-controls/connection-request", headers={"Origin": origin}).json()["number"] == first["number"]
        )
        with monkeypatch.context() as clock:
            clock.setattr(time, "monotonic", lambda: original_clock + BROWSER_REQUEST_SECONDS / 2)
            assert browser.post("/api/vehicle-controls/connection-request", headers={"Origin": origin}).status_code == 200
        with monkeypatch.context() as clock:
            clock.setattr(time, "monotonic", lambda: original_clock + BROWSER_REQUEST_SECONDS + 1)
            assert browser.post("/api/vehicle-controls/connection-request/exchange", headers={"Origin": origin}).status_code == 404
        browser.post("/api/vehicle-controls/connection-request", headers={"Origin": origin})
        request_id = controls.pending_browsers()[0]["requestId"]
        browser.post("/api/vehicle-controls/disconnect", headers={"Origin": origin})
        with pytest.raises(ValueError):
            controls.approve_browser(request_id)
        browser.post("/api/vehicle-controls/connection-request", headers={"Origin": origin})
        request_id = controls.pending_browsers()[0]["requestId"]
        real_clock = time.monotonic()
        with monkeypatch.context() as clock:
            clock.setattr(time, "monotonic", lambda: real_clock + BROWSER_REQUEST_SECONDS + 1)
            assert browser.post("/api/vehicle-controls/connection-request/exchange", headers={"Origin": origin}).status_code == 404
            with pytest.raises(ValueError):
                controls.approve_browser(request_id)


def test_only_current_operator_requests_can_approve_and_origin_is_required(browser_setup) -> None:
    app, controls, origin = browser_setup
    with TestClient(app, base_url=origin) as browser:
        for headers in ({}, {"Origin": "https://other.example"}):
            assert browser.post("/api/vehicle-controls/connection-request", headers=headers).status_code == 403
        browser.post("/api/vehicle-controls/connection-request", headers={"Origin": origin})
        request_id = controls.pending_browsers()[0]["requestId"]
        assert (
            browser.post(
                f"/api/vehicle-controls/browser-requests/{request_id}/approve", headers={"Authorization": f"Bearer {controls.token}"}
            ).status_code
            == 403
        )
        for index in range(MAXIMUM_BROWSER_REQUESTS - len(controls.pending_browsers())):
            controls.request_browser("", f"synthetic-client-{index}")
        with TestClient(app, base_url=origin) as extra:
            assert extra.post("/api/vehicle-controls/connection-request", headers={"Origin": origin}).status_code == 429


def test_session_tampering_expiry_and_master_rotation_cannot_keep_access(browser_setup, monkeypatch) -> None:
    _, controls, _ = browser_setup
    session = controls.issue_browser_session()
    assert controls.authenticated_browser(session)
    for invalid in ("", session + "x", session.rsplit(".", 1)[0] + ".é", "v1.99999999999.not-signed"):
        assert not controls.authenticated_browser(invalid)
    issued = time.time()
    with monkeypatch.context() as clock:
        clock.setattr(time, "time", lambda: issued + BROWSER_SESSION_SECONDS + 1)
        assert not controls.authenticated_browser(session)
    controls.token = "another-synthetic-master-code-for-rotation"
    assert not controls.authenticated_browser(session)


def test_operator_client_does_not_follow_redirects_with_its_credential(tmp_path: Path, monkeypatch) -> None:
    visited = []

    class Redirect(BaseHTTPRequestHandler):
        # noinspection PyPep8Naming
        def do_GET(self) -> None:
            visited.append(self.path)
            self.send_response(302)
            self.send_header("Location", "/credential-capture")
            self.end_headers()

    def redirect_handler(request: socket.socket, address: tuple[str, int], server: HTTPServer) -> Redirect:
        return Redirect(request, address, server)

    token = tmp_path / "test-token"
    token.write_text("synthetic-not-a-real-credential")
    with HTTPServer(("127.0.0.1", 0), redirect_handler) as http_server:
        thread = threading.Thread(target=http_server.serve_forever, daemon=True)
        thread.start()
        monkeypatch.setattr(
            "sys.argv",
            [
                "browser_approval",
                "--url",
                f"http://127.0.0.1:{http_server.server_port}",
                "--origin",
                "https://dashboard.example",
                "--token-file",
                str(token),
                "--list",
            ],
        )
        try:
            with pytest.raises(SystemExit, match="302"):
                browser_approval.main()
            assert len(visited) == 1
        finally:
            http_server.shutdown()
            thread.join()


@pytest.mark.parametrize(
    "url",
    [
        "http://dashboard.example",
        "http://127.0.0.1.example",
        "https://user:password@dashboard.example",
        "https://dashboard.example/?token=placeholder",
    ],
)
def test_operator_rejects_cleartext_or_credential_urls_before_reading_the_secret(tmp_path: Path, monkeypatch, url: str) -> None:
    monkeypatch.setattr(
        "sys.argv",
        [
            "browser_approval",
            "--url",
            url,
            "--origin",
            "https://dashboard.example",
            "--token-file",
            str(tmp_path / "does-not-exist"),
            "--list",
        ],
    )
    with pytest.raises(SystemExit) as error:
        browser_approval.main()
    assert error.value.code == 2


def test_one_client_cannot_fill_the_global_browser_queue(browser_setup) -> None:
    _, controls, _ = browser_setup
    for _ in range(MAXIMUM_BROWSER_REQUESTS_PER_CLIENT):
        controls.request_browser("", "one-client")
    with pytest.raises(ValueError):
        controls.request_browser("", "one-client")
    prompt, cookie = controls.request_browser("", "other-client")
    assert cookie and prompt["number"]


@pytest.mark.parametrize("approval", ["", "   "])
def test_empty_operator_approval_is_rejected_before_reading_a_secret(tmp_path: Path, monkeypatch, approval: str) -> None:
    monkeypatch.setattr(
        "sys.argv",
        [
            "browser_approval",
            "--url",
            "http://127.0.0.1:8088",
            "--origin",
            "https://dashboard.example",
            "--token-file",
            str(tmp_path / "missing"),
            "--approve",
            approval,
        ],
    )
    with pytest.raises(SystemExit) as error:
        browser_approval.main()
    assert error.value.code == 2


def test_unreadable_operator_secret_has_a_clean_error(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "sys.argv",
        [
            "browser_approval",
            "--url",
            "http://127.0.0.1:8088",
            "--origin",
            "https://dashboard.example",
            "--token-file",
            str(tmp_path / "missing"),
            "--list",
        ],
    )
    with pytest.raises(SystemExit, match="unreadable"):
        browser_approval.main()

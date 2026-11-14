import json
import math
import os
import sqlite3
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator

from .analysis import AnalysisLimitError
from .battery_history import BatteryHistory
from .controls import MAXIMUM_TEMPERATURE_C, MINIMUM_TEMPERATURE_C, TEMPERATURE_STEP_C, TemperatureControls, valid_temperature
from .engine import Engine
from .recording import SESSION_ID
from .signals import CATALOG


class DialRange(BaseModel):
    minimum: float
    maximum: float

    @model_validator(mode="after")
    def increasing_finite_range(self) -> Self:
        if not math.isfinite(self.minimum) or not math.isfinite(self.maximum) or self.minimum >= self.maximum:
            raise ValueError("Choose finite dial limits with the maximum greater than the minimum")
        return self


class Layout(BaseModel):
    theme: Literal["auto", "day", "night"] = "auto"
    units: Literal["metric", "imperial"] = "metric"
    instruments: list[str] = Field(default_factory=lambda: ["voltageV", "currentA", "displayedChargePercent"], max_length=12)
    presentation: Literal["dials", "readings", "history"] = "dials"
    historyInstrument: str = "voltageV"
    ranges: dict[str, DialRange] = Field(default_factory=dict, max_length=12)

    @field_validator("instruments")
    @classmethod
    def known_instruments(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or any(key not in CATALOG for key in value):
            raise ValueError("Select distinct instruments from the catalog")
        return value

    @field_validator("ranges")
    @classmethod
    def known_ranges(cls, value: dict[str, DialRange]) -> dict[str, DialRange]:
        if any(key not in CATALOG for key in value):
            raise ValueError("Choose dial ranges for known instruments")
        return value

    @field_validator("historyInstrument")
    @classmethod
    def known_history_instrument(cls, value: str) -> str:
        if value not in CATALOG:
            raise ValueError("Choose a known instrument for history")
        return value


class ReplayRequest(BaseModel):
    session_id: str | None = None
    rate: float = 1

    @field_validator("rate")
    @classmethod
    def supported_rate(cls, value: float) -> float:
        if value not in (0.5, 1, 2, 4):
            raise ValueError("Unsupported replay speed")
        return value


class TemperatureRequest(BaseModel):
    model_config = {"extra": "forbid"}
    temperatureC: float
    nonce: str = Field(min_length=1, max_length=64)

    @field_validator("temperatureC")
    @classmethod
    def supported_temperature(cls, value: float) -> float:
        if not valid_temperature(value):
            raise ValueError("Choose a supported temperature in half-degree steps")
        return value


class BrowserReport(BaseModel):
    browser: str = Field(max_length=1024)
    updates: int = Field(ge=0, le=1000000)
    requestTimesMs: list[float] = Field(default_factory=list, max_length=30)
    visibility: Literal["visible", "hidden"]
    width: int | None = Field(default=None, ge=0, le=20000)
    height: int | None = Field(default=None, ge=0, le=20000)

    @field_validator("requestTimesMs")
    @classmethod
    def finite_timings(cls, value: list[float]) -> list[float]:
        if any(not 0 <= item <= 3600000 for item in value):
            raise ValueError("Invalid request timing")
        return value


CONTROL_PAGE = """<!doctype html><html><head>
<meta name="viewport" content="width=device-width"><title>Dashboard controls</title>
</head><body style="font:20px system-ui;padding:24px"><h1>Dashboard controls</h1>
<p>Reload the dashboard while it remains open in the car.</p>
<button style="font:inherit;padding:20px" onclick="reloadDashboard()">Reload dashboard</button>
<p id="status"></p><a href="/api/browser-checks">Browser reports</a><p><a href="/">Dashboard</a></p>
<script>function reloadDashboard(){fetch('/api/control/reload',{method:'POST'}).then(function(r){
document.getElementById('status').textContent=r.ok?'Reload requested.':'Request failed.';});}</script></body></html>"""


def create_app(
    engine: Engine,
    data_directory: Path,
    assets: Path | None = None,
    allowed_origins: set[str] | None = None,
    designs: Path | None = None,
    controls: TemperatureControls | None = None,
) -> FastAPI:
    allowed_origins = allowed_origins or {"http://127.0.0.1:8088", "http://localhost:8088"}
    if controls is not None:
        if designs is not None:
            raise ValueError("Serve design previews separately from vehicle controls")
        if any(
            urlsplit(origin).scheme != "https" and urlsplit(origin).hostname not in {"127.0.0.1", "localhost", "::1"}
            for origin in allowed_origins
        ):
            raise ValueError("Vehicle controls require HTTPS or a loopback origin")
    reports: deque[dict] = deque(maxlen=20)
    layout_path = data_directory / "layout.json"
    engine.battery_history = BatteryHistory(data_directory / "battery.sqlite3", reserve_bytes=engine.recorder.reserve_bytes)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        engine.start()
        yield
        engine.close()

    app = FastAPI(title="Tesla CAN Dashboard", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.exception_handler(RequestValidationError)
    async def invalid_input(_: Request, error: RequestValidationError) -> JSONResponse:
        # Raw invalid input can contain non-finite numbers, which JSON responses reject.
        return JSONResponse({"detail": "; ".join(str(item["msg"]) for item in error.errors())}, status_code=422)

    @app.middleware("http")
    async def same_origin_changes(request: Request, call_next):
        if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
            origin = request.headers.get("origin")
            if (origin is not None and origin not in allowed_origins) or (
                request.url.path.startswith("/api/vehicle-controls/") and origin is None
            ):
                return JSONResponse({"detail": "Unexpected request origin"}, status_code=403)
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return JSONResponse({"detail": "Invalid request length"}, status_code=400)
            if length > 65536 or length < 0:
                return JSONResponse({"detail": "Request is too large"}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.url.path.startswith("/api/") or request.url.path in {"/", "/snapshot", "/control"}:
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/health")
    def health() -> dict:
        return {
            "status": "ok",
            "receiveOnly": True,
            "bluetoothControls": controls is not None,
            "mode": "live" if engine.interface else "demonstration",
            "connection": engine.store.snapshot()["connection"]["state"] if engine.interface else "not-connected",
        }

    def has_controls_access(request: Request) -> bool:
        return controls is not None and (
            controls.authenticated(request.headers.get("authorization", ""))
            or controls.authenticated(f"Bearer {request.cookies.get('tesla_controls', '')}")
        )

    def authorize_controls(request: Request) -> TemperatureControls:
        if controls is None:
            raise HTTPException(404, "Controls are not connected")
        if not has_controls_access(request):
            raise HTTPException(401, "Connect controls with your access code")
        return controls

    @app.get("/api/vehicle-controls")
    def controls_status(request: Request) -> dict:
        return {
            "available": controls is not None,
            "connected": has_controls_access(request),
            "actions": ["temperature"] if controls else [],
            "temperature": {"minimumC": MINIMUM_TEMPERATURE_C, "maximumC": MAXIMUM_TEMPERATURE_C, "stepC": TEMPERATURE_STEP_C},
        }

    @app.post("/api/vehicle-controls/connect")
    def connect_controls(request: Request, response: Response) -> dict:
        controller = authorize_controls(request)
        response.set_cookie(
            "tesla_controls",
            controller.token,
            max_age=30 * 86400,
            path="/api/vehicle-controls",
            secure=True,
            httponly=True,
            samesite="strict",
        )
        return {"connected": True}

    @app.post("/api/vehicle-controls/disconnect")
    def disconnect_controls(response: Response) -> dict:
        response.delete_cookie("tesla_controls", path="/api/vehicle-controls", secure=True, httponly=True, samesite="strict")
        return {"connected": False}

    @app.post("/api/vehicle-controls/prepare")
    def prepare_temperature(request: Request) -> dict:
        controller = authorize_controls(request)
        try:
            return {"nonce": controller.issue_nonce()}
        except ValueError as error:
            raise HTTPException(429, str(error)) from None

    @app.post("/api/vehicle-controls/temperature")
    def change_temperature(body: TemperatureRequest, request: Request) -> dict:
        controller = authorize_controls(request)
        try:
            return controller.change(body.temperatureC, body.nonce)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None

    @app.get("/api/snapshot")
    @app.get("/snapshot")
    def snapshot() -> dict:
        return engine.snapshot()

    @app.get("/api/catalog")
    def catalog() -> dict:
        return {"signals": [asdict(value) for value in CATALOG.values()], "currentDirection": engine.decoder.current_direction}

    @app.get("/api/battery-history")
    def battery_history(days: int = Query(default=30, ge=1, le=365)) -> dict:
        assert engine.battery_history is not None
        try:
            result = engine.battery_history.read(time.time() - days * 86400)
            for observation in result["observations"]:
                observation.pop("cellGroups", None)
            return result
        except (OSError, sqlite3.Error, ValueError):
            raise HTTPException(503, "Battery history could not be loaded") from None

    @app.get("/api/layout")
    def get_layout() -> dict:
        try:
            return Layout.model_validate_json(layout_path.read_text()).model_dump()
        except (OSError, ValueError):
            return Layout().model_dump()

    @app.put("/api/layout")
    def save_layout(layout: Layout) -> dict:
        data_directory.mkdir(parents=True, exist_ok=True)
        temporary = data_directory / f"layout-{time.time_ns()}.tmp"
        try:
            with temporary.open("x") as target:
                target.write(layout.model_dump_json())
                target.flush()
                os.fsync(target.fileno())
            temporary.replace(layout_path)
        except OSError:
            temporary.unlink(missing_ok=True)
            raise HTTPException(507, "Layout could not be saved") from None
        return layout.model_dump()

    @app.post("/api/recordings/start")
    def start_recording() -> dict:
        if engine.interface is None:
            raise HTTPException(409, "Recording requires a live CAN receiver")
        try:
            return {"id": engine.recorder.start()}
        except (ValueError, OSError) as error:
            raise HTTPException(409, str(error) if isinstance(error, ValueError) else "Recording storage is unavailable") from None

    @app.post("/api/recordings/stop")
    def stop_recording() -> dict:
        engine.recorder.stop()
        return engine.recording_status()

    @app.get("/api/recordings")
    def recordings() -> dict:
        return engine.recording_status()

    @app.get("/api/recordings/{session_id}/analysis")
    def analyze_session(session_id: str) -> dict:
        if not SESSION_ID.fullmatch(session_id):
            raise HTTPException(404, "Recording not found")
        try:
            return engine.analyze_session(session_id)
        except FileNotFoundError:
            raise HTTPException(404, "Recording not found") from None
        except AnalysisLimitError as error:
            raise HTTPException(413, str(error)) from None
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        except OSError:
            raise HTTPException(503, "Recording storage is unavailable") from None

    @app.get("/api/recordings/{session_id}")
    def download_recording(session_id: str) -> FileResponse:
        try:
            path = engine.recorder.path(session_id)
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, "Recording not found") from None
        return FileResponse(path, filename=path.name, media_type="application/x-ndjson")

    @app.delete("/api/recordings/{session_id}")
    def delete_recording(session_id: str) -> dict:
        if engine.replay_id == session_id:
            raise HTTPException(409, "Stop replay before deleting this session")
        try:
            engine.recorder.delete(session_id)
        except FileNotFoundError:
            raise HTTPException(404, "Recording not found") from None
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        return {"deleted": True}

    @app.post("/api/replay")
    def replay(body: ReplayRequest) -> dict:
        try:
            if body.session_id is None:
                engine.stop_replay()
            else:
                engine.start_replay(body.session_id, body.rate)
        except FileNotFoundError:
            raise HTTPException(404, "Recording not found") from None
        except ValueError as error:
            raise HTTPException(409, str(error)) from None
        return engine.snapshot()

    @app.post("/api/control/reload")
    def reload_dashboard() -> dict:
        engine.revision = str(time.time_ns())
        return {"requested": True}

    @app.post("/api/browser-check")
    async def browser_check(request: Request) -> dict:
        raw = await request.body()
        if len(raw) > 8192:
            raise HTTPException(413, "Browser report is too large")
        try:
            report = BrowserReport.model_validate(json.loads(raw))
        except ValueError:
            raise HTTPException(400, "Invalid browser report") from None
        reports.append({"time": time.time(), **report.model_dump()})
        return {"received": True}

    @app.get("/api/browser-checks")
    def browser_checks() -> dict:
        return {"checks": list(reports)}

    @app.get("/control", response_class=HTMLResponse)
    def browser_controls_page() -> str:
        return CONTROL_PAGE

    if designs is not None and designs.is_dir():
        app.mount("/designs", StaticFiles(directory=designs, html=True), name="designs")
    if assets is not None and assets.is_dir():
        app.mount("/", StaticFiles(directory=assets, html=True), name="frontend")
    else:

        @app.get("/", response_class=HTMLResponse)
        def development() -> str:
            return "<h1>Tesla CAN Dashboard</h1><p>Frontend assets have not been built.</p><a href='/api/snapshot'>Data</a>"

    return app

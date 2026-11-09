import math
import threading
import time
from collections import deque
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SignalDefinition:
    key: str
    label: str
    unit: str
    group: str
    minimum: float
    maximum: float
    stale_after: float = 3


SIGNALS = (
    SignalDefinition("voltageV", "Pack voltage", "V", "battery", 0, 1000),
    SignalDefinition("currentA", "Pack current (CAN sign)", "A", "battery", -3000, 3000),
    SignalDefinition("displayedChargePercent", "Displayed charge", "%", "battery", 0, 100),
    SignalDefinition("fullPackEnergyKwh", "Full pack energy", "kWh", "battery", 0, 250, 30),
    SignalDefinition("remainingEnergyKwh", "Remaining energy", "kWh", "battery", 0, 250, 30),
    SignalDefinition("minimumTemperatureC", "Minimum pack temperature", "°C", "battery", -60, 150, 30),
    SignalDefinition("maximumTemperatureC", "Maximum pack temperature", "°C", "battery", -60, 150, 30),
    SignalDefinition("chargingPowerKw", "Charging power", "kW", "charging", 0, 1000),
    SignalDefinition("chargeLimitPercent", "Charge limit", "%", "charging", 0, 100, 30),
    SignalDefinition("speedKmh", "Speed", "km/h", "drive", 0, 450),
)
CATALOG = {definition.key: definition for definition in SIGNALS}


@dataclass
class Sample:
    value: float | None
    source_time: float
    received_at: float
    valid: bool


@dataclass
class SignalSeries:
    sample: Sample | None = None
    minimum: float | None = None
    maximum: float | None = None
    history: deque = field(default_factory=lambda: deque(maxlen=240))


class SignalStore:
    def __init__(self, cell_count: int = 96) -> None:
        self.cell_count = cell_count
        self.lock = threading.RLock()
        self.series = {key: SignalSeries() for key in CATALOG}
        self.cells = {index: SignalSeries() for index in range(1, cell_count + 1)}
        self.frames = 0
        self.decode_errors = 0
        self.last_frame_at: float | None = None
        self.receiver_error: str | None = None

    @staticmethod
    def _add(series: SignalSeries, value: float | None, valid: bool, timestamp: float, now: float) -> None:
        valid = valid and value is not None and math.isfinite(value)
        series.sample = Sample(value if valid else None, timestamp, now, valid)
        if not valid or value is None:
            return
        series.minimum = value if series.minimum is None else min(series.minimum, value)
        series.maximum = value if series.maximum is None else max(series.maximum, value)
        if not series.history or now - series.history[-1][0] >= 0.25:
            series.history.append((now, timestamp, value))

    def update(self, values: dict[str, float], cells: dict[int, float | None], timestamp: float, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self.lock:
            self.frames += 1
            self.last_frame_at = now
            self.receiver_error = None
            for key, value in values.items():
                if key not in CATALOG:
                    continue
                definition = CATALOG[key]
                self._add(self.series[key], value, definition.minimum <= value <= definition.maximum, timestamp, now)
            for index, value in cells.items():
                if index in self.cells:
                    self._add(self.cells[index], value, value is not None and 0 < value < 6, timestamp, now)

    @staticmethod
    def _reading(series: SignalSeries, stale_after: float, now: float, unit: str, include_history: bool = True) -> dict:
        sample = series.sample
        if sample is None:
            return {
                "value": None,
                "quality": "unavailable",
                "ageSeconds": None,
                "unit": unit,
                "sourceTimestamp": None,
                "minimum": None,
                "maximum": None,
                "history": [],
            }
        age = max(0, now - sample.received_at)
        quality = "invalid" if not sample.valid else "stale" if age > stale_after else "fresh"
        return {
            "value": sample.value,
            "quality": quality,
            "ageSeconds": age,
            "unit": unit,
            "sourceTimestamp": sample.source_time,
            "minimum": series.minimum,
            "maximum": series.maximum,
            "history": [[timestamp, value] for received, timestamp, value in series.history if now - received <= 120]
            if include_history
            else [],
        }

    def snapshot(self, now: float | None = None) -> dict:
        now = time.monotonic() if now is None else now
        with self.lock:
            signals = {
                key: self._reading(self.series[key], definition.stale_after, now, definition.unit)
                for key, definition in CATALOG.items()
            }
            cells = [
                {"index": index, **self._reading(series, 30, now, "V", include_history=False)}
                for index, series in self.cells.items()
            ]
            fresh_cells = [cell["value"] for cell in cells if cell["quality"] == "fresh"]
            age = None if self.last_frame_at is None else max(0, now - self.last_frame_at)
            state = (
                "waiting"
                if age is None and not self.receiver_error
                else "connected"
                if age is not None and age <= 3
                else "disconnected"
            )
            return {
                "mode": "live",
                "connection": {"state": state, "ageSeconds": age, "error": self.receiver_error},
                "signals": signals,
                "cellGroups": cells,
                "cellSpreadMv": (max(fresh_cells) - min(fresh_cells)) * 1000 if len(fresh_cells) == self.cell_count else None,
                "freshCellCount": len(fresh_cells),
                "statistics": {"framesReceived": self.frames, "decodeErrors": self.decode_errors},
                "currentDirection": "unqualified",
            }

import json
import math
import sqlite3
from contextlib import closing
from pathlib import Path

from .recording import DEFAULT_RESERVE_BYTES, has_storage_space
from .signals import CATALOG

INTERVAL_SECONDS = 300
SETTLE_SECONDS = 30
OBSERVATION_LIMIT = 200_000
BATTERY_KEYS = tuple(key for key, definition in CATALOG.items() if definition.group in {"battery", "charging"})


class BatteryHistory:
    def __init__(self, path: Path, limit: int = OBSERVATION_LIMIT, reserve_bytes: int = DEFAULT_RESERVE_BYTES) -> None:
        self.path = path
        self.limit = limit
        self.reserve_bytes = reserve_bytes
        self.error: str | None = None

    def append(self, snapshot: dict, timestamp: float) -> bool:
        if snapshot["mode"] != "live" or snapshot["connection"]["state"] != "connected" or not math.isfinite(timestamp):
            return False
        signals = {
            key: reading["value"] if reading["quality"] == "fresh" else None
            for key in BATTERY_KEYS
            if (reading := snapshot["signals"].get(key)) is not None
        }
        cells = [round(cell["value"], 4) if cell["quality"] == "fresh" else None for cell in snapshot["cellGroups"]]
        if not any(value is not None for value in signals.values()) and not any(value is not None for value in cells):
            return False
        observation = {
            "timestamp": timestamp,
            "signals": signals,
            "cellGroups": cells,
            "cellSpreadMv": snapshot["cellSpreadMv"],
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not has_storage_space(self.path.parent, self.reserve_bytes):
            raise OSError("Battery history storage is low")
        with closing(sqlite3.connect(self.path, timeout=0.2)) as connection, connection:
            connection.execute("CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, timestamp REAL, payload TEXT)")
            connection.execute("CREATE INDEX IF NOT EXISTS observed_at ON observations(timestamp)")
            connection.execute(
                "INSERT INTO observations(timestamp, payload) VALUES (?, ?)",
                (timestamp, json.dumps(observation, separators=(",", ":"), allow_nan=False)),
            )
            connection.execute(
                "DELETE FROM observations WHERE id <= (SELECT id FROM observations ORDER BY id DESC LIMIT 1 OFFSET ?)",
                (self.limit,),
            )
        return True

    def read(self, since: float, points: int = 480) -> dict:
        result = {"observations": [], "count": 0, "error": self.error}
        if not self.path.exists():
            return result
        with closing(sqlite3.connect(f"{self.path.resolve().as_uri()}?mode=rw", uri=True, timeout=0.2)) as connection:
            count, latest = connection.execute(
                "SELECT count(*), max(id) FROM observations WHERE timestamp >= ?", (since,)
            ).fetchone()
            stride = max(1, math.ceil(count / points))
            rows = connection.execute(
                "SELECT payload FROM observations WHERE timestamp >= ? AND (id % ? = 0 OR id = ?) ORDER BY id",
                (since, stride, latest),
            ).fetchall()
        result["observations"] = [json.loads(row[0]) for row in rows]
        result["count"] = count
        return result

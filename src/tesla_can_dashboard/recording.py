import json
import math
import os
import re
import shutil
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast

SESSION_ID = re.compile(r"[0-9a-f]{32}\Z")


@dataclass(frozen=True)
class Frame:
    identifier: int
    data: bytes
    timestamp: float
    monotonic_ns: int

    def encode(self) -> bytes:
        value = {"id": self.identifier, "data": self.data.hex(), "time": self.timestamp, "monotonicNs": self.monotonic_ns}
        return (json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n").encode()


def read_frames(path: Path) -> Iterator[Frame]:
    with path.open("rb") as source:
        while line := source.readline(2049):
            if len(line) > 2048:
                raise ValueError("Recording contains an oversized frame")
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                if not line.endswith(b"\n"):
                    return
                raise ValueError("Recording contains a malformed frame") from None
            if not isinstance(value, dict):
                raise ValueError("Recording contains an invalid frame")
            identifier = value.get("id")
            payload = value.get("data")
            timestamp = value.get("time")
            monotonic = value.get("monotonicNs")
            if not isinstance(identifier, int) or not 0 <= identifier <= 0x1FFFFFFF:
                raise ValueError("Recording contains an invalid CAN identifier")
            if not isinstance(payload, str) or len(payload) > 16:
                raise ValueError("Recording contains an invalid CAN payload")
            if not isinstance(timestamp, (int, float)):
                raise ValueError("Recording contains an invalid timestamp")
            source_time = cast(float | int, timestamp)
            if isinstance(timestamp, bool) or not math.isfinite(source_time):
                raise ValueError("Recording contains an invalid timestamp")
            if not isinstance(monotonic, int):
                raise ValueError("Recording contains an invalid timestamp")
            if isinstance(monotonic, bool) or monotonic < 0:
                raise ValueError("Recording contains an invalid timestamp")
            try:
                data = bytes.fromhex(payload)
            except ValueError:
                raise ValueError("Recording contains an invalid CAN payload") from None
            yield Frame(identifier, data, source_time, cast(int, monotonic))


class Recorder:
    def __init__(self, directory: Path, maximum_bytes: int = 256 * 1024 * 1024, reserve_bytes: int = 1024 * 1024 * 1024) -> None:
        self.directory = directory
        self.maximum_bytes = maximum_bytes
        self.reserve_bytes = reserve_bytes
        self.lock = threading.RLock()
        self.active_id: str | None = None
        self.stream = None
        self.bytes_used = 0
        self.last_error: str | None = None
        self.last_space_check = 0.0

    def _files(self) -> list[Path]:
        if not self.directory.exists():
            return []
        return [path for path in self.directory.glob("*.jsonl") if SESSION_ID.fullmatch(path.stem) and not path.is_symlink()]

    def start(self) -> str:
        with self.lock:
            if self.active_id:
                return self.active_id
            self.directory.mkdir(parents=True, exist_ok=True)
            self.bytes_used = sum(path.stat().st_size for path in self._files())
            if self.bytes_used >= self.maximum_bytes or shutil.disk_usage(self.directory).free < self.reserve_bytes:
                raise ValueError("Recording storage is full; export or remove a saved session first")
            session_id = uuid.uuid4().hex
            self.stream = (self.directory / f"{session_id}.jsonl").open("xb", buffering=0)
            self.active_id = session_id
            self.last_error = None
            self.last_space_check = 0
            return session_id

    def append(self, frame: Frame) -> None:
        with self.lock:
            if self.stream is None:
                return
            encoded = frame.encode()
            now = time.monotonic()
            try:
                if now - self.last_space_check > 1:
                    self.last_space_check = now
                    self.bytes_used = sum(path.stat().st_size for path in self._files())
                    if shutil.disk_usage(self.directory).free < self.reserve_bytes:
                        self.last_error = "Recording stopped because storage is low"
                        self.stop()
                        return
                if self.bytes_used + len(encoded) > self.maximum_bytes:
                    self.last_error = "Recording stopped at its storage limit; saved sessions were kept"
                    self.stop()
                    return
                written = self.stream.write(encoded)
                if written != len(encoded):
                    raise OSError("Incomplete recording write")
                self.bytes_used += written
            except OSError:
                self.last_error = "Recording stopped because storage is unavailable"
                self.stop()

    def stop(self) -> None:
        with self.lock:
            if self.stream is not None:
                try:
                    os.fsync(self.stream.fileno())
                except OSError:
                    self.last_error = "Recording stopped; its final write could not be confirmed"
                finally:
                    self.stream.close()
            self.stream = None
            self.active_id = None

    def path(self, session_id: str) -> Path:
        if not SESSION_ID.fullmatch(session_id):
            raise ValueError("Invalid session identifier")
        path = self.directory / f"{session_id}.jsonl"
        if path.is_symlink() or not path.is_file():
            raise FileNotFoundError("Recording not found")
        return path

    def delete(self, session_id: str) -> None:
        with self.lock:
            if session_id == self.active_id:
                raise ValueError("Stop recording before deleting this session")
            self.path(session_id).unlink()

    def status(self) -> dict:
        with self.lock:
            try:
                sessions = [
                    {"id": path.stem, "sizeBytes": path.stat().st_size, "modifiedAt": path.stat().st_mtime}
                    for path in sorted(self._files(), key=lambda value: value.stat().st_mtime, reverse=True)
                ]
            except OSError:
                sessions = []
                self.last_error = "Recording storage is unavailable"
            return {"activeId": self.active_id, "error": self.last_error, "maximumBytes": self.maximum_bytes, "sessions": sessions}

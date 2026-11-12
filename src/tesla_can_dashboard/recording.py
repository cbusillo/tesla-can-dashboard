import json
import math
import os
import re
import shutil
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import cast

MAX_ANALYSIS_BYTES = 64 * 1024 * 1024
MAX_ANALYSIS_FRAMES = 500_000
SESSION_ID = re.compile(r"[0-9a-f]{32}\Z")


class InterruptedTailError(ValueError):
    pass


@dataclass(frozen=True)
class Frame:
    identifier: int
    data: bytes
    timestamp: float
    monotonic_ns: int

    def encode(self) -> bytes:
        value = {"id": self.identifier, "data": self.data.hex(), "time": self.timestamp, "monotonicNs": self.monotonic_ns}
        return (json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n").encode()


def read_frames(path: Path, *, require_complete: bool = False, maximum_bytes: int | None = None) -> Iterator[Frame]:
    with path.open("rb") as source:
        bytes_read = 0
        while line := source.readline(2049):
            bytes_read += len(line)
            if maximum_bytes is not None and bytes_read > maximum_bytes:
                raise ValueError("Recording exceeds the read byte limit")
            if require_complete and not line.endswith(b"\n"):
                raise InterruptedTailError("Completed recording contains an interrupted frame")
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
            if type(identifier) is not int or not 0 <= identifier <= 0x1FFFFFFF:
                raise ValueError("Recording contains an invalid CAN identifier")
            if not isinstance(payload, str) or len(payload) > 16:
                raise ValueError("Recording contains an invalid CAN payload")
            if not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool):
                raise ValueError("Recording contains an invalid timestamp")
            source_time: float | int = timestamp
            try:
                finite = math.isfinite(source_time)
            except OverflowError:
                finite = False
            if not finite:
                raise ValueError("Recording contains an invalid timestamp")
            if not isinstance(monotonic, int):
                raise ValueError("Recording contains an invalid timestamp")
            if isinstance(monotonic, bool) or not 0 <= monotonic <= 2**63 - 1:
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
        self.session_bytes = 0
        self.session_frames = 0
        self.last_error: str | None = None
        self.last_space_check = 0.0
        self.analysis_ids: set[str] = set()

    def _files(self) -> list[Path]:
        if not self.directory.exists():
            return []
        return [path for path in self.directory.glob("*.jsonl") if SESSION_ID.fullmatch(path.stem) and not path.is_symlink()]

    def start(self) -> str:
        with self.lock:
            if self.analysis_ids:
                raise ValueError("Wait for session analysis before starting recording")
            if self.active_id:
                return self.active_id
            self.directory.mkdir(parents=True, exist_ok=True)
            self.bytes_used = sum(path.stat().st_size for path in self._files())
            if self.bytes_used >= self.maximum_bytes or shutil.disk_usage(self.directory).free < self.reserve_bytes:
                raise ValueError("Recording storage is full; export or remove a saved session first")
            session_id = uuid.uuid4().hex
            self.stream = (self.directory / f"{session_id}.jsonl").open("xb", buffering=0)
            self.active_id = session_id
            self.session_bytes = 0
            self.session_frames = 0
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
                if len(encoded) > MAX_ANALYSIS_BYTES:
                    self.last_error = "Recording stopped because a frame exceeds the chunk limit"
                    self.stop()
                    return
                if self.session_bytes + len(encoded) > MAX_ANALYSIS_BYTES or self.session_frames >= MAX_ANALYSIS_FRAMES:
                    self.stop()
                    if self.last_error:
                        return
                    self.start()
                written = self.stream.write(encoded)
                if written != len(encoded):
                    raise OSError("Incomplete recording write")
                self.bytes_used += written
                self.session_bytes += written
                self.session_frames += 1
            except (OSError, ValueError) as error:
                self.last_error = str(error) if isinstance(error, ValueError) else "Recording stopped because storage is unavailable"
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

    @contextmanager
    def completed_recording(self, session_id: str) -> Iterator[Path]:
        with self.lock:
            if self.active_id is not None:
                raise ValueError("Stop recording before analyzing saved sessions")
            path = self.path(session_id)
            before = path.stat()
            self.analysis_ids.add(session_id)
        try:
            yield path
            after = path.stat()
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev,
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            ):
                raise ValueError("Recording changed during analysis")
        finally:
            with self.lock:
                self.analysis_ids.discard(session_id)

    def delete(self, session_id: str) -> None:
        with self.lock:
            if session_id == self.active_id:
                raise ValueError("Stop recording before deleting this session")
            if session_id in self.analysis_ids:
                raise ValueError("Wait for session analysis before deleting this session")
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

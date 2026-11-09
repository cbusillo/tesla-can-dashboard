import json
import logging
import socket
import struct
import threading
import time
from importlib.resources import files
from pathlib import Path

import cantools

from .decoder import Decoder
from .recording import Frame, Recorder, read_frames
from .signals import SignalStore

LOGGER = logging.getLogger(__name__)


class Engine:
    def __init__(self, interface: str | None, recorder: Recorder, dbc: Path | None = None, cell_count: int = 96) -> None:
        self.interface = interface
        self.decoder = Decoder(dbc)
        self.recorder = recorder
        self.store = SignalStore(cell_count)
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.replay_thread: threading.Thread | None = None
        self.replay_stop = threading.Event()
        self.replay_store: SignalStore | None = None
        self.replay_time = 0.0
        self.replay_clock = time.monotonic()
        self.replay_rate = 1.0
        self.replay_state = "stopped"
        self.replay_id: str | None = None
        self.replay_error: str | None = None
        self.control_lock = threading.RLock()
        self.revision = str(time.time_ns())
        self.started_at = time.monotonic()
        self.demo = self._load_demo() if interface is None else None

    @staticmethod
    def _load_demo() -> dict:
        bundled = files("tesla_can_dashboard").joinpath("data/demo.json")
        source = bundled if bundled.is_file() else Path(__file__).resolve().parents[2] / "design/fixture.json"
        return json.loads(source.read_text())

    def start(self) -> None:
        if self.interface:
            self.thread = threading.Thread(target=self._receive, daemon=True)
            self.thread.start()

    def close(self) -> None:
        self.stop_event.set()
        try:
            self.stop_replay()
        finally:
            if self.thread:
                self.thread.join(timeout=3)
            self.recorder.stop()

    def ingest(self, frame: Frame) -> None:
        if frame.identifier not in self.decoder.frame_ids:
            return
        self.recorder.append(frame)
        try:
            values, cells = self.decoder.decode(frame.identifier, frame.data)
        except (ValueError, cantools.database.errors.DecodeError):
            with self.store.lock:
                self.store.decode_errors += 1
            return
        self.store.update(values, cells, frame.timestamp, now=frame.monotonic_ns / 1e9)

    def _receive(self) -> None:
        while not self.stop_event.is_set():
            try:
                with socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW) as receiver:
                    receiver.settimeout(1)
                    receiver.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024 * 1024)
                    receiver.bind((self.interface,))
                    while not self.stop_event.is_set():
                        try:
                            packet = receiver.recv(16)
                        except TimeoutError:
                            continue
                        acquired_ns = time.monotonic_ns()
                        timestamp = time.time()
                        if len(packet) != 16:
                            continue
                        identifier, length, payload = struct.unpack("=IB3x8s", packet)
                        if identifier & 0xE0000000 or length > 8:
                            continue
                        self.ingest(Frame(identifier & 0x1FFFFFFF, payload[:length], timestamp, acquired_ns))
            except OSError:
                LOGGER.exception("CAN receiver interrupted")
                with self.store.lock:
                    self.store.receiver_error = "CAN receiver is unavailable; waiting for the interface"
                self.stop_event.wait(1)

    def _demo_snapshot(self) -> dict:
        elapsed = (time.monotonic() - self.started_at) % 30
        store = SignalStore(self.store.cell_count)
        store.update(self.demo["values"], {cell["index"]: cell["voltageV"] for cell in self.demo["cellGroups"]}, time.time(), now=0)
        snapshot = store.snapshot(now=0)
        if 10 <= elapsed < 15:
            snapshot["signals"]["currentA"].update(quality="stale", ageSeconds=8)
        elif 15 <= elapsed < 20:
            snapshot["signals"]["currentA"].update(value=None, quality="unavailable", ageSeconds=None)
        elif 20 <= elapsed < 25:
            snapshot["connection"]["state"] = "disconnected"
            for signal in snapshot["signals"].values():
                if signal["quality"] == "fresh":
                    signal["quality"] = "stale"
        snapshot["mode"] = "replay"
        snapshot["replay"] = {"state": "playing", "source": "demonstration", "elapsedSeconds": elapsed}
        return snapshot

    def snapshot(self) -> dict:
        replay_store = self.replay_store
        if replay_store is not None:
            replay_now = self.replay_time
            if self.replay_state == "playing":
                replay_now += max(0, time.monotonic() - self.replay_clock) * self.replay_rate
            snapshot = replay_store.snapshot(now=replay_now)
            snapshot["mode"] = "replay"
            snapshot["replay"] = {"state": self.replay_state, "source": self.replay_id, "error": self.replay_error}
        elif self.demo is not None:
            snapshot = self._demo_snapshot()
        else:
            snapshot = self.store.snapshot()
        snapshot["reloadRevision"] = self.revision
        snapshot["recording"] = self.recorder.status()
        return snapshot

    def start_replay(self, session_id: str, rate: float = 1) -> None:
        with self.control_lock:
            self._start_replay(session_id, rate)

    def _start_replay(self, session_id: str, rate: float) -> None:
        if rate not in (0.5, 1, 2, 4):
            raise ValueError("Unsupported replay speed")
        path = self.recorder.path(session_id)
        if session_id == self.recorder.active_id:
            raise ValueError("Stop recording before replaying this session")
        self.stop_replay()
        self.replay_stop.clear()
        self.replay_store = SignalStore(self.store.cell_count)
        self.replay_time = 0
        self.replay_clock = time.monotonic()
        self.replay_rate = rate
        self.replay_state = "playing"
        self.replay_id = session_id
        self.replay_error = None
        self.replay_thread = threading.Thread(target=self._replay, args=(path, rate, self.replay_store), daemon=True)
        self.replay_thread.start()

    def _replay(self, path: Path, rate: float, store: SignalStore) -> None:
        previous = None
        try:
            for frame in read_frames(path):
                if previous is not None:
                    delay = (frame.monotonic_ns - previous) / 1e9 / rate
                    if delay < 0:
                        raise ValueError("Recording timestamps run backwards")
                    if self.replay_stop.wait(delay):
                        return
                previous = frame.monotonic_ns
                self.replay_time = frame.monotonic_ns / 1e9
                self.replay_clock = time.monotonic()
                try:
                    values, cells = self.decoder.decode(frame.identifier, frame.data)
                except (ValueError, cantools.database.errors.DecodeError):
                    with store.lock:
                        store.decode_errors += 1
                    continue
                store.update(values, cells, frame.timestamp, now=self.replay_time)
            self.replay_state = "finished"
        except (OSError, ValueError, cantools.database.errors.DecodeError):
            self.replay_error = "This recording could not be replayed"
            self.replay_state = "error"

    def stop_replay(self) -> None:
        with self.control_lock:
            self._stop_replay()

    def _stop_replay(self) -> None:
        self.replay_stop.set()
        if self.replay_thread:
            self.replay_thread.join(timeout=3)
            if self.replay_thread.is_alive():
                self.replay_state = "stopping"
                raise ValueError("Replay is still stopping")
        self.replay_thread = None
        self.replay_store = None
        self.replay_id = None
        self.replay_state = "stopped"

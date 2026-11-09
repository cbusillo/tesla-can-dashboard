#!/usr/bin/env python3
import logging
import random
import socket
import struct
import sys
import time
from pathlib import Path

DEFAULT_INTERFACE = "can0"
VOLUME_SWITCH_CAN_ID = 0x3C2
SCROLL_MULTIPLEXER = 1
SCROLL_TICKS_MASK = 0x3F
SCROLL_DOWN = -1
SCROLL_UP = 1
FRAME_DATA_LENGTH = 8
PAUSE_BETWEEN_SCROLLS_SECONDS = 0.01
FLICK_INTERVAL_SECONDS = 10.0
FLICK_JITTER_SECONDS = 3.0
TRAFFIC_MAX_AGE_SECONDS = 0.5
STARTUP_GRACE_SECONDS = 5.0
SOCKETCAN_FRAME = struct.Struct("=IB3x8s")

_logger = logging.getLogger("tesla-volume-flicker")


def build_scroll_frame(ticks: int) -> bytes:
    data = bytes([SCROLL_MULTIPLEXER, 0, ticks & SCROLL_TICKS_MASK]).ljust(FRAME_DATA_LENGTH, b"\0")
    return SOCKETCAN_FRAME.pack(VOLUME_SWITCH_CAN_ID, FRAME_DATA_LENGTH, data)


def open_can_socket(interface: str) -> socket.socket:
    can_socket = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
    can_socket.bind((interface,))
    return can_socket


def flick_volume(can_socket: socket.socket) -> None:
    can_socket.send(build_scroll_frame(SCROLL_DOWN))
    time.sleep(PAUSE_BETWEEN_SCROLLS_SECONDS)
    can_socket.send(build_scroll_frame(SCROLL_UP))


def next_flick_delay() -> float:
    return FLICK_INTERVAL_SECONDS + random.uniform(-FLICK_JITTER_SECONDS, FLICK_JITTER_SECONDS)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    interface = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_INTERFACE
    carrier = Path("/sys/class/net") / interface / "carrier"
    started_at = time.monotonic()
    next_flick = started_at + next_flick_delay()
    last_received: float | None = None
    with open_can_socket(interface) as can_socket:
        can_socket.settimeout(0.25)
        _logger.info("Volume flicker ready on %s", interface)
        while True:
            try:
                packet = can_socket.recv(SOCKETCAN_FRAME.size)
                if len(packet) == SOCKETCAN_FRAME.size:
                    last_received = time.monotonic()
            except TimeoutError:
                if carrier.read_text().strip() != "1" and time.monotonic() - started_at >= STARTUP_GRACE_SECONDS:
                    _logger.warning("CAN carrier unavailable; restarting helper")
                    return
            now = time.monotonic()
            if now < next_flick:
                continue
            if last_received is not None and now - last_received <= TRAFFIC_MAX_AGE_SECONDS:
                flick_volume(can_socket)
            next_flick = now + next_flick_delay()


if __name__ == "__main__":
    main()

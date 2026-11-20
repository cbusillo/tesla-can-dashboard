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
SCROLL_MULTIPLEXER_MASK = 0x01
SCROLL_TICKS_MASK = 0x3F
SCROLL_DOWN = -1
SCROLL_UP = 1
FRAME_DATA_LENGTH = 8
FLICK_INTERVAL_SECONDS = 10.0
FLICK_JITTER_SECONDS = 3.0
NEUTRAL_FRAME_TIMEOUT_SECONDS = 0.5
STARTUP_GRACE_SECONDS = 5.0
CAN_IDENTIFIER_MASK = 0x1FFFFFFF
SOCKETCAN_FRAME = struct.Struct("=IB3x8s")

_logger = logging.getLogger("tesla-volume-flicker")


def build_scroll_frame(native_neutral: bytes, ticks: int) -> bytes:
    data = bytearray(native_neutral)
    data[2] = (data[2] & ~SCROLL_TICKS_MASK) | (ticks & SCROLL_TICKS_MASK)
    return SOCKETCAN_FRAME.pack(VOLUME_SWITCH_CAN_ID, FRAME_DATA_LENGTH, data)


def extract_native_neutral(packet: bytes) -> bytes | None:
    if len(packet) != SOCKETCAN_FRAME.size:
        return None
    can_id, data_length, data = SOCKETCAN_FRAME.unpack(packet)
    if can_id & CAN_IDENTIFIER_MASK != VOLUME_SWITCH_CAN_ID or data_length != FRAME_DATA_LENGTH:
        return None
    if data[0] & SCROLL_MULTIPLEXER_MASK != SCROLL_MULTIPLEXER:
        return None
    if data[2] & SCROLL_TICKS_MASK:
        return None
    return data


def open_can_socket(interface: str) -> socket.socket:
    can_socket = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
    can_socket.bind((interface,))
    return can_socket


def next_flick_delay() -> float:
    return FLICK_INTERVAL_SECONDS + random.uniform(-FLICK_JITTER_SECONDS, FLICK_JITTER_SECONDS)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    interface = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_INTERFACE
    carrier = Path("/sys/class/net") / interface / "carrier"
    started_at = time.monotonic()
    next_flick = started_at + next_flick_delay()
    restore_deadline: float | None = None
    with open_can_socket(interface) as can_socket:
        can_socket.settimeout(0.25)
        _logger.info("Volume flicker ready on %s", interface)
        while True:
            try:
                packet = can_socket.recv(SOCKETCAN_FRAME.size)
            except TimeoutError:
                packet = b""
                if carrier.read_text().strip() != "1" and time.monotonic() - started_at >= STARTUP_GRACE_SECONDS:
                    _logger.warning("CAN carrier unavailable; restarting helper")
                    return
            now = time.monotonic()
            if restore_deadline is not None and now >= restore_deadline:
                _logger.warning("No native neutral scroll frame followed volume down; leaving volume lower")
                restore_deadline = None
                next_flick = now + next_flick_delay()
            native_neutral = extract_native_neutral(packet)
            if native_neutral is None:
                continue
            if restore_deadline is not None:
                can_socket.send(build_scroll_frame(native_neutral, SCROLL_UP))
                restore_deadline = None
                next_flick = now + next_flick_delay()
                continue
            if now >= next_flick:
                can_socket.send(build_scroll_frame(native_neutral, SCROLL_DOWN))
                restore_deadline = now + NEUTRAL_FRAME_TIMEOUT_SECONDS


if __name__ == "__main__":
    main()

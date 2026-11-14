import argparse
import json
import logging
import os
import socket
import socketserver
import struct
import subprocess
from pathlib import Path

from .controls import valid_temperature


class BluetoothTemperature:
    def __init__(self, key_directory: Path) -> None:
        self.directory = key_directory

    @staticmethod
    def _radio(*arguments: str) -> str:
        result = subprocess.run(["rfkill", *arguments], capture_output=True, text=True, timeout=3, check=True)
        return result.stdout.strip()

    def change(self, temperature: float) -> dict:
        prior = self._radio("--noheadings", "--output", "SOFT", "list", "bluetooth")
        if prior not in {"blocked", "unblocked"}:
            return {"outcome": "unknown"}
        outcome = "unknown"
        try:
            if prior == "blocked":
                self._radio("unblock", "bluetooth")
            environment = {key: value for key, value in os.environ.items() if not key.startswith("TESLA_")}
            environment["TESLA_VIN"] = (self.directory / "vin").read_text().strip()
            result = subprocess.run(
                [
                    str(self.directory / "bin/tesla-control"),
                    "-ble",
                    "-key-file",
                    str(self.directory / "key.pem"),
                    "-disable-session-cache",
                    "-connect-timeout",
                    "10s",
                    "-command-timeout",
                    "10s",
                    "climate-set-temp",
                    f"{temperature:g}C",
                ],
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=25,
                check=False,
            )
            if result.returncode == 0:
                outcome = "acknowledged"
        finally:
            if prior == "blocked":
                self._radio("block", "bluetooth")
        return {"outcome": outcome}


class TemperatureServer(socketserver.UnixStreamServer):
    def __init__(self, path: Path, allowed_uid: int, bluetooth: BluetoothTemperature) -> None:
        self.allowed_uid = allowed_uid
        self.bluetooth = bluetooth
        super().__init__(str(path), TemperatureHandler)


class TemperatureHandler(socketserver.StreamRequestHandler):
    server: TemperatureServer

    def handle(self) -> None:
        self.connection.settimeout(3)
        _, uid, _ = struct.unpack("3i", self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != self.server.allowed_uid:
            return
        outcome = {"outcome": "unknown"}
        try:
            request = json.loads(self.rfile.readline(1024))
            if not isinstance(request, dict) or set(request) != {"temperatureC"} or not valid_temperature(request["temperatureC"]):
                return
            outcome = self.server.bluetooth.change(request["temperatureC"])
        except (OSError, ValueError, subprocess.SubprocessError):
            logging.getLogger(__name__).warning("Temperature command outcome is unknown")
        self.wfile.write(json.dumps(outcome).encode() + b"\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Private Bluetooth temperature helper; Linux only")
    parser.add_argument("--socket", type=Path, required=True)
    parser.add_argument("--key-directory", type=Path, required=True)
    parser.add_argument("--allowed-uid", type=int, required=True)
    parser.add_argument("--socket-gid", type=int, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    with TemperatureServer(args.socket, args.allowed_uid, BluetoothTemperature(args.key_directory)) as server:
        os.chown(args.socket, 0, args.socket_gid)
        os.chmod(args.socket, 0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()

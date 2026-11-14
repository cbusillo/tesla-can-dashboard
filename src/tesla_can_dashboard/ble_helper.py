import argparse
import grp
import json
import logging
import os
import pwd
import socket
import socketserver
import struct
import subprocess
from pathlib import Path
from typing import cast

from .controls import valid_charge_limit, valid_temperature


class BluetoothControls:
    def __init__(self, key_directory: Path, log_path: Path | None = None) -> None:
        self.directory = key_directory
        self.log_path = log_path

    @staticmethod
    def _radio(*arguments: str) -> str:
        result = subprocess.run(["rfkill", *arguments], capture_output=True, text=True, timeout=3, check=True)
        return result.stdout.strip()

    def change(self, temperature: float) -> dict:
        return self._run("climate-set-temp", f"{temperature:g}C")

    def change_charge_limit(self, percent: int) -> dict:
        return self._run("charging-set-limit", str(percent))

    def _run(self, command: str, value: str) -> dict:
        prior = self._radio("--noheadings", "--output", "SOFT", "list", "bluetooth")
        if prior not in {"blocked", "unblocked"}:
            return {"outcome": "unknown"}
        outcome = "unknown"
        try:
            if prior == "blocked":
                self._radio("unblock", "bluetooth")
            environment = {key: value for key, value in os.environ.items() if not key.startswith("TESLA_")}
            environment["TESLA_VIN"] = (self.directory / "vin").read_text().strip()
            with (self.log_path or Path(os.devnull)).open("w") as output:
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
                        command,
                        value,
                    ],
                    env=environment,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    timeout=25,
                )
            if result.returncode == 0:
                outcome = "acknowledged"
        finally:
            if prior == "blocked":
                self._radio("block", "bluetooth")
        return {"outcome": outcome}


class ControlServer(socketserver.UnixStreamServer):
    def __init__(self, path: Path, allowed_uid: int, bluetooth: BluetoothControls) -> None:
        self.allowed_uid = allowed_uid
        self.bluetooth = bluetooth
        super().__init__(str(path), create_handler)


class ControlHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        server = cast(ControlServer, self.server)
        self.connection.settimeout(3)
        _, uid, _ = struct.unpack("3i", self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != server.allowed_uid:
            logging.getLogger(__name__).warning("Rejected a temperature request from an unexpected local identity")
            return
        outcome = {"outcome": "unknown"}
        try:
            request = json.loads(self.rfile.readline(1024))
            if not isinstance(request, dict):
                return
            if set(request) == {"temperatureC"} and valid_temperature(request["temperatureC"]):
                outcome = server.bluetooth.change(request["temperatureC"])
            elif set(request) == {"chargeLimitPercent"} and valid_charge_limit(request["chargeLimitPercent"]):
                outcome = server.bluetooth.change_charge_limit(request["chargeLimitPercent"])
            else:
                return
        except (OSError, ValueError, subprocess.SubprocessError):
            logging.getLogger(__name__).warning("Vehicle command outcome is unknown")
        self.wfile.write(json.dumps(outcome).encode() + b"\n")


def create_handler(request: socket.socket, address: object, server: socketserver.UnixStreamServer) -> ControlHandler:
    return ControlHandler(request, address, server)


def main() -> None:
    parser = argparse.ArgumentParser(description="Private Bluetooth convenience helper; Linux only")
    parser.add_argument("--socket", type=Path, required=True)
    parser.add_argument("--key-directory", type=Path, required=True)
    parser.add_argument("--allowed-user", required=True)
    parser.add_argument("--socket-group", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    uid = pwd.getpwnam(args.allowed_user).pw_uid
    gid = grp.getgrnam(args.socket_group).gr_gid
    if uid == 0 or uid == 65534 or gid == 65534:
        parser.error("Use a dedicated dashboard account and group")
    with ControlServer(args.socket, uid, BluetoothControls(args.key_directory, args.socket.parent / "last-attempt.log")) as server:
        os.chown(args.socket, 0, gid)
        os.chmod(args.socket, 0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()

import argparse
from pathlib import Path

import uvicorn

from .api import create_app
from .controls import VehicleControls
from .engine import Engine
from .recording import Recorder


def main() -> None:
    parser = argparse.ArgumentParser(description="Receive-only Tesla CAN dashboard")
    parser.add_argument("--interface", help="SocketCAN interface; omitted starts the replay demonstration")
    parser.add_argument("--dbc", type=Path, help="Operator-supplied compatible DBC; not bundled")
    parser.add_argument(
        "--discharge-current", choices=("positive", "negative"), help="Qualified pack-current polarity for this profile"
    )
    recording = parser.add_mutually_exclusive_group()
    recording.add_argument(
        "--record-on-start", action="store_true", help="Start bounded recording at live startup; requires --interface"
    )
    recording.add_argument(
        "--record-drives", action="store_true", help="Record Reverse/Drive until settled Park; requires --interface"
    )
    parser.add_argument("--cells", type=int, default=96)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8088)
    parser.add_argument("--data-dir", type=Path, default=Path.home() / ".local/share/tesla-can-dashboard")
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--designs", type=Path)
    parser.add_argument("--allowed-origin", action="append", default=[])
    parser.add_argument("--controls-socket", type=Path, help="Opt-in private Bluetooth helper socket")
    parser.add_argument("--controls-token-file", type=Path, help="Private browser access-code file, separate from the vehicle key")
    parser.add_argument("--recording-limit-mib", type=int, default=256)
    args = parser.parse_args()
    if not 1 <= args.cells <= 200 or args.recording_limit_mib < 1:
        parser.error("Choose a valid cell count and positive recording storage limit")
    if (args.record_on_start or args.record_drives) and not args.interface:
        parser.error("Automatic recording requires a live --interface")
    if bool(args.controls_socket) != bool(args.controls_token_file) or (args.controls_socket and not args.interface):
        parser.error("Controls require a live interface, helper socket and access-code file")
    recorder = Recorder(args.data_dir / "recordings", args.recording_limit_mib * 1024 * 1024)
    engine = Engine(
        args.interface,
        recorder,
        args.dbc,
        args.cells,
        auto_record=args.record_on_start,
        discharge_current=args.discharge_current,
        auto_drives=args.record_drives,
    )
    controls = VehicleControls(engine, args.controls_socket, args.controls_token_file) if args.controls_socket else None
    app = create_app(engine, args.data_dir, args.assets, set(args.allowed_origin) or None, args.designs, controls)
    uvicorn.run(app, host=args.bind, port=args.port)


if __name__ == "__main__":
    main()

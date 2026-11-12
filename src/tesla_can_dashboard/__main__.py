import argparse
from pathlib import Path

import uvicorn

from .api import create_app
from .engine import Engine
from .recording import Recorder


def main() -> None:
    parser = argparse.ArgumentParser(description="Receive-only Tesla CAN dashboard")
    parser.add_argument("--interface", help="SocketCAN interface; omitted starts the replay demonstration")
    parser.add_argument("--dbc", type=Path, help="Operator-supplied compatible DBC; not bundled")
    parser.add_argument("--speed-dbc", type=Path, help="Optional speed-only supplement; keeps primary battery messages")
    parser.add_argument(
        "--record-on-start", action="store_true", help="Start bounded recording at live startup; requires --interface"
    )
    parser.add_argument("--cells", type=int, default=96)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8088)
    parser.add_argument("--data-dir", type=Path, default=Path.home() / ".local/share/tesla-can-dashboard")
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--designs", type=Path)
    parser.add_argument("--allowed-origin", action="append", default=[])
    parser.add_argument("--recording-limit-mib", type=int, default=256)
    args = parser.parse_args()
    if not 1 <= args.cells <= 200 or args.recording_limit_mib < 1:
        parser.error("Choose a valid cell count and positive recording storage limit")
    if args.record_on_start and not args.interface:
        parser.error("--record-on-start requires a live --interface")
    if args.speed_dbc and not args.dbc:
        parser.error("--speed-dbc requires a primary --dbc")
    recorder = Recorder(args.data_dir / "recordings", args.recording_limit_mib * 1024 * 1024)
    engine = Engine(args.interface, recorder, args.dbc, args.cells, speed_dbc=args.speed_dbc, auto_record=args.record_on_start)
    app = create_app(engine, args.data_dir, args.assets, set(args.allowed_origin) or None, args.designs)
    uvicorn.run(app, host=args.bind, port=args.port)


if __name__ == "__main__":
    main()

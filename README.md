# Tesla CAN Dashboard

A lightweight, receive-only dashboard for a Pi connected to Tesla CAN.
Designed for the in-car browser, including Intel Atom cars. This is an early
development preview. Independent visual designs are being compared before the
final interface is selected.

The first implementation includes selectable instruments, 96 configurable
cell groups, recent history, day/night appearance, local session recording,
export and replay. Missing, invalid, stale and disconnected data stay distinct
from zero. The service reconnects when the interface returns. The browser
reconnects automatically and supports remote page reload at `/control` while
the page is still open.

## Try the demonstration

Install [uv](https://docs.astral.sh/uv/) and Node.js, then run:

```sh
uv sync --frozen
npm ci --prefix web
npm run --prefix web build
uv run tesla-can-dashboard --assets web/dist
```

Open <http://127.0.0.1:8088/>. With no CAN interface selected, the app shows a
labelled demonstration that cycles through normal, stale, missing and
disconnected readings. It does not record or control a vehicle.

For live data, add `--interface can0`. Built-in decoding covers pack voltage,
CAN-sign current and displayed state of charge. An operator-supplied compatible
DBC enables the explicitly mapped energy, temperature and cell group signals.
Unavailable signals remain unavailable. No third-party DBC or real vehicle
recording is distributed here. See [Pi installation](deploy/README.md).

## Limits of this preview

Pack current direction is not yet qualified. Cell group spread requires every
configured group to have a fresh valid reading. Voltage balance alone does not
establish battery health, individual cell age or warranty condition. Source
firmware and pack compatibility must be checked on the actual car.

Recordings contain selected CAN telemetry and acquisition timestamps. Replay
never sends frames and does not interrupt an independent live recording.
Performance timing and convenience controls are planned, not implemented.
No vehicle command endpoint exists.

The dashboard does not provide portable internet or a hotspot setup. Browser
availability while moving, sleep/wake behavior and touch performance require
hands-on vehicle testing. Do not interact with the dashboard while driving.

## Develop

`uv run pytest`, `uv run ruff check .`, and `uv run ruff format --check .`
check the backend. `npm run --prefix web build` checks TypeScript and builds
local frontend assets. For frontend development, start the API, then run
`npm run --prefix web dev`; Vite proxies `/api` to the local API.

Keep real recordings, VINs, pack identifiers, credentials, locations and local
network configuration out of issues and commits. The included design fixture
is artificial.

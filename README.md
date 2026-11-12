# Tesla CAN Dashboard

A lightweight, receive-only dashboard for a Pi connected to Tesla CAN.
Designed for the in-car browser, including Intel Atom cars. This is an early
development preview using Ionic’s standard iOS components and a small set of
telemetry charts.

The first implementation includes selectable dials, numeric readings and
recent history, editable dial ranges, 96 configurable cell groups with a
voltage chart, day/night appearance, local session recording,
export and replay. Missing, invalid, stale and disconnected data stay distinct
from zero. The service reconnects when the interface returns. The browser
reconnects automatically, marks held readings when the connection drops, and
supports remote page reload at `/control` while
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
DBC enables explicitly mapped energy, temperature, cell group, speed, gear,
charger line power and charge-limit signals when names and units match.
Unavailable signals remain unavailable. No third-party DBC or real vehicle
recording is distributed here. See [Pi installation](deploy/README.md).

## Limits of this preview

Pack current direction is not yet qualified. Cell group spread requires every
configured group to have a fresh valid reading. Voltage balance alone does not
establish battery health, individual cell age or warranty condition. Source
firmware and pack compatibility must be checked on the actual car.

Recordings contain selected CAN telemetry and acquisition timestamps. Replay
never sends frames and does not interrupt an independent live recording.
Completed recordings have a bounded analysis API for estimated acceleration,
rolling intervals, quarter-mile timing and battery/charger-line observations.
See [analysis conventions and signal coverage](docs/session-analysis.md).
Use `--record-on-start` with a live `--interface` to capture at server startup
without opening the browser. Existing recordings and storage limits are kept;
a capture-start failure leaves the receiver/server running. The existing
recorder rolls into completed chunks within the analysis limits and reports
a full total budget without erasing older files.
The standalone session-analysis component awaits integration into the selected
interface. New DBC mappings still need target qualification. Convenience
controls are not implemented. No vehicle command endpoint exists.

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
has no identity or location fields.

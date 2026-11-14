# Tesla CAN Dashboard

A lightweight dashboard for a Pi connected to Tesla CAN, with optional local Bluetooth controls.
Designed for the in-car browser, including Intel Atom cars. This is an early
development preview using Preact, Ionic iOS components and local telemetry
charts, with open instruments and restrained day/night colors.
The CAN receiver always remains receive-only.

The first implementation includes selectable dials, numeric readings and
recent history, editable dial ranges, 96 configurable cell groups with a
voltage chart, day/night appearance, local session recording,
export and replay. Missing, invalid, stale and disconnected data stay distinct
from zero. The service reconnects when the interface returns. The browser
reconnects automatically, marks held readings when the connection drops, and
supports remote page reload at `/control` while
the page is still open.
Settings → Connection opens a public test page only when tapped. Use the
browser's Back control to return. This supports parked connectivity observations;
it does not configure an uplink or certify Wi-Fi/cellular coexistence.

Overview shows the first two selected instruments as open dials and the rest
as readings, with selectable recent history. Cells provides chart selection,
a group map and large previous/next controls. Charging shows available pack
readings and current history. Sessions and Settings remain in the bottom
navigation. Existing saved instruments, ranges, units and appearance are
preserved. Overview opens with its instruments ready to read; Edit reveals
instrument choices, display style, history selection and dial limits. Done or
leaving Overview hides those controls. Editing is not restored on reload.
Charging power and charge limit remain unavailable until decoded;
the app does not estimate range, charging ETA or current direction.

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

Pack current direction defaults to unqualified. An operator who has qualified
the exact car/profile can use `--discharge-current negative` or `positive`.
This enables signed battery power from voltage/current decoded together in
one frame. Raw current remains unchanged. Positive power is draw; negative
power flows into the pack. Profiles with separate voltage/current messages
do not synthesize power from held values. Cell group spread requires every
configured group to have a fresh valid reading. Voltage balance alone does not
establish battery health, individual cell age or warranty condition. Source
firmware and pack compatibility must be checked on the actual car.

Recordings contain selected CAN telemetry and acquisition timestamps. Replay
never sends frames and does not interrupt an independent live recording.
Completed recordings have a bounded analysis API for estimated acceleration,
rolling intervals, quarter-mile timing and battery/charger-line observations.
See [analysis conventions and signal coverage](docs/session-analysis.md).
Use `--record-on-start` with a live `--interface` to capture at server startup
without opening the browser. Existing recordings and storage limits are kept.
Alternatively, `--record-drives` starts when decoded gear enters Reverse or
Drive and closes its own capture after settled Park. This avoids spending the
raw budget on parked time. Manual captures are preserved; manual Stop stays
paused until Park rearms the next drive. Analysis admission defers a new capture
until analysis releases it. Both automatic modes require a live receiver and
cannot be combined. Missing gear support leaves the dashboard running with a
recording error. Neither mode erases older captures; choose a bounded storage
budget with `--recording-limit-mib` and export/remove recordings deliberately.
A capture-start failure leaves the receiver/server running. The existing
recorder rolls into completed chunks within the analysis limits and reports
a full total budget without erasing older files.
Sessions includes recording analysis with explicit measurement conventions,
data-quality reasons and sampled battery curves.
Sessions → Review can compare two saved sessions for estimated energy used,
energy regained, peak draw/regen and driving-data coverage. Compare sessions
and per-reading details stay collapsed until requested. Recording chunks are
compared as saved; the table does not claim to combine them into whole trips.
Operator profile identity, charging semantics and precision still require runtime qualification.

Optional cabin controls use a separate private Bluetooth helper and an enrolled
vehicle key. CAN remains receive-only. Both cabin setpoints can be decoded from
a compatible operator profile; LO/HI are not presented as numeric temperatures.
The temperature control sets both sides together, in half-degree steps from
16–27°C. Each manual change requires an access code and a single-use request.
Fresh CAN readings after the request confirm the resulting settings. A Bluetooth
acknowledgement alone displays Sent; a timeout stays unconfirmed and is never
retried automatically. Replay and stale or missing cabin readings disable changes.
Controls remain disabled unless explicitly configured; see [installation](deploy/README.md#optional-bluetooth-temperature-controls).

Charging → History shows recorded pack energy and cell balance. Live battery
observations are saved every five minutes independently of raw CAN recording
or browser activity, after a 30-second wake settling period, including fresh
fields and available cell-group voltages rounded to 0.1 mV.
Replay and demonstration values never enter this history. A background writer
keeps storage work off acquisition; a storage failure leaves live readings
running and appears in History. Storage retains the newest 200,000 observations
(about 23 months of continuous collection) without deleting raw recordings.
History preserves the recorder's free-space reserve. Queries return at most
481 sampled observations, including the latest point, without the stored
per-cell arrays; those stay on disk for later cell comparisons.
Charts show dots rather than inventing continuity across sleep or missing data.
Dates follow the Pi clock; row-count retention does not delete data based on
an offline clock jump. This history is not a health percentage or cell-age
measurement. It begins after installation, rather than manufacturing older data.

The dashboard does not provide portable internet or a hotspot setup. Browser
availability while moving, sleep/wake behavior and touch performance require
hands-on vehicle testing. Do not interact with the dashboard while driving.

## Develop

`uv run pytest`, `uv run ruff check .`, and `uv run ruff format --check .`
check the backend. `npm test --prefix web` checks reading quality and unit
conversion. `npm run --prefix web build` checks TypeScript and builds
local frontend assets. For frontend development, start the API, then run
`npm run --prefix web dev`; Vite proxies `/api` to the local API.

Keep real recordings, VINs, pack identifiers, credentials, locations and local
network configuration out of issues and commits. The included design fixture
has no identity or location fields.

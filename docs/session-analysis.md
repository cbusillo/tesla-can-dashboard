# Recorded session analysis

`GET /api/recordings/{session_id}/analysis` reads a completed raw JSONL recording
through the current decoder. It never uses browser polling, live history,
replay rate or wall-clock differences for measurements. The original recording
has no profile identity, so selecting the right operator DBC and qualifying it
against the recording source remain necessary. This does not prove target
compatibility.

The receive-only candidate adds these exact DBC names:

| Source signal | Dashboard value | Native units accepted |
| --- | --- | --- |
| `DI_vehicleSpeed` | `speedKmh` | `MPH` / `mph` × 1.609344; `kph` / `km/h` unchanged |
| `DI_gear` | `driveGear` | DBC enum labels `DI_GEAR_P/R/N/D` normalized to 1/2/3/4 |
| `PCS_chgInputPower` | `chargingPowerKw` | `W` ÷ 1000; `kW` unchanged |
| `UI_chargeTerminationPct` | `chargeLimitPercent` | `%` unchanged |

Definitions are grounded in the primary
[opendbc Tesla profile](https://github.com/commaai/opendbc/blob/master/opendbc/dbc/tesla_can.dbc)
the [Model 3 DBC](https://github.com/joshwardell/model3dbc/blob/master/Model3CAN.dbc),
and the [modern signal database](https://github.com/talas9/tesla-can-signal-db).
Their layouts differ; these links do not establish compatibility with a
particular vehicle. No new raw bit layout is built in. Message layouts come
only from the operator-supplied DBC. Unsupported units stay unavailable;
reserved/unavailable enum values invalidate readings. Missing gear enums do
not establish forward direction. Charger line power is an AC input
observation, not battery power, delivered pack energy or DC fast-charge power.
Requested power and maximum power limits are not measured power.

## Timing and quality

The response has `schemaVersion: 1`, `sessionId`, `quality`, `reasons`,
`recording`, `timing`, `decoder`, `performance`, and `battery` objects.
Times in results are seconds relative to the first acquired frame.

`performance.groups` separates `standing-no-rollout-v1` and
`rolling-threshold-v1`. Each group's `measurements` contains `id`, `quality`,
`reasons` and `runs`. Standing measurements are `0-60-mph`, `0-100-kmh` and
`quarter-mile`; rolling measurements are `30-70-mph` and `80-120-kmh`.
No best is selected. Compare only matching measurement IDs and conventions,
and only recordings whose source/profile compatibility has been established.

A run contains `startSeconds`, `endSeconds`, `durationSeconds`, `endSpeedKmh`
and `sampleResolutionSeconds`. These are estimates, not certified timings.
UI durations should be displayed to tenths of a second, alongside sample
resolution. Resolution describes the largest acquisition gap during a run;
it does not bound sensor accuracy, CAN delivery latency or quantization error.
Standing starts use the last observed exact zero immediately before movement,
with zero rollout distance. Rolling intervals require an observed upward
crossing of the lower threshold. Speed is linearly interpolated; distance
uses trapezoidal integration and a quadratic crossing of 402.336 metres.

Forward gear must be fresh within 0.5 seconds throughout a run. Reverse,
invalid/unknown/stale gear, invalid speed, decode errors affecting drive
signals, repeated speed times or speed gaps over 0.5 seconds discard pending
runs. A new standing run requires another zero. Rolling runs require another
lower-threshold crossing. An incomplete interval is unavailable, not zero.
Malformed interior frames or backwards acquisition clocks invalidate
all results, including earlier plausible runs. An interrupted final line is
excluded with `interrupted_tail` and partial quality; complete earlier runs
and observations remain usable. Incomplete pending runs are never completed
from the interrupted tail. Gap-free runs elsewhere can
still appear with the session's warnings; warnings must stay visible.

`battery.signals` supplies `quality`, `label`, `unit`, `samples`, `invalidSamples`,
`gaps`, `first`, `last`, `minimum`, `maximum`, `observedDelta`,
`coveredSeconds`, `curve` and `curveSampled`. Curves are sampled `[elapsed
seconds, value-or-null]` observations; a scatter display avoids inventing
coverage between retained points. Summaries use all valid observations,
including ones omitted from curves. First-to-last changes are observations,
not measured consumption or inferred health. Per-signal coverage uses its
catalog stale threshold. Charging energy is a trapezoidal integral of valid
adjacent charger-line samples only, reported as `observedEnergyKwh`,
`coveredSeconds` and `quality`; gaps and invalid samples are excluded.
An invalid recording's observations must not be presented as a valid summary.
CAN-sign current remains unqualified. No regen, age, health percentage,
range or charging ETA is inferred.

## Startup recording

`--record-on-start` explicitly opts a live receiver into recording at server
startup, without a browser visit. It requires `--interface`; demonstrations
cannot opt in. It uses the existing recorder, free-space reserve and total
`--recording-limit-mib` budget. It never erases older recordings, does not
record replay as live, and stops at the storage limit without a retry loop.
A startup storage failure appears in recording status while the receiver and
server continue. Each successful service start creates a new recording;
this is not automatic per-drive segmentation or an indefinite recording promise.
The same Recorder rolls over before either analysis input limit is exceeded:
64 MiB or 500,000 frames per JSONL chunk. The boundary frame goes into the new
chunk exactly once. Older chunks remain immutable and analyzable during
continued capture. All chunks share the existing total budget and free-space
reserve. Reaching either safeguard stops capture and reports the error;
there is no deletion, overwrite or automatic restart loop. Runs do not bridge
chunk boundaries. Stop recording before analyzing the active chunk.

The application reads one operator DBC through the existing `--dbc` option.
If it lacks a required definition, a qualified composite profile is prepared
privately and conflicts are checked there. App source does not contain a
supplement mechanism or profile composition tool. Operator profiles,
composition provenance and real captures stay outside source control.
Exact-zero standing starts intentionally remain unavailable if a source reports
a nonzero value at rest; analysis never invents a calibration offset.

## Limits and coordination

The endpoint admits one analysis at a time, at most 64 MiB and 500,000 frames,
50 runs per measurement and 240 curve points per signal. It streams the raw
recording, writes no decoded copy or analysis cache, and releases the recorder
lock before decoding. Active recordings are excluded; deletion is refused
while analysis owns a recording. A changed file is rejected before returning.

HTTP errors: 404 for missing/invalid IDs, 409 for active/busy/changed recordings,
413 for input bounds, and 503 for unavailable storage. A malformed recording
returns HTTP 200 with `quality: invalid`, reasons and empty run arrays; the UI
must check quality before displaying measurements.

`web/src/session-analysis.tsx` exports `SessionAnalysis({ sessions, activeId })`.
It loads on an explicit Analyze action, cancels obsolete requests, hides
invalid results, and displays unavailable data and sample resolution. It is integrated below saved sessions in the selected interface, using its
day/night appearance and unit preference. Profile/source qualification and
installation remain Supervisor work.

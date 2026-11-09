# Tesla CAN Dashboard

A lightweight dashboard for the Tesla browser, served by a Raspberry Pi with a
SocketCAN adapter. The first version focuses on battery, cell, charging and
power measurements, saved instruments, recording and replay.

This is an early implementation. The current development proof can display live
CAN data and reload remotely in an Intel Atom Tesla browser. A persistent
installation and portable offline connection are still being built.

The application receives CAN frames. Future convenience controls will be
qualified separately; the initial implementation has no vehicle-command API.
Missing, invalid and stale readings must remain distinct from zero.

## Development

The planned application uses Preact and TypeScript for the interface, uPlot for
graphs, and Python with FastAPI and cantools for data acquisition and replay.
Interactive design experiments live in `design/`, using the synthetic/sanitized
fixture at `design/fixture.json`. No vehicle is needed to view these experiments.

Vehicle recordings, identifiers, credentials and host-specific deployment
configuration do not belong in this repository.

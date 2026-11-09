# Pi installation

The service consumes an already configured SocketCAN interface. It never
configures the bus, sends frames, wakes the car or changes network profiles.

Build on a development computer with `npm ci --prefix web` followed by
`npm run --prefix web build`. Copy the source, `uv.lock`, `pyproject.toml`,
`design/fixture.json` and `web/dist` to a dedicated application directory on
the Pi. Do not copy a development virtual environment or private recordings.
Run `uv sync --frozen --no-dev --no-cache --python /usr/bin/python3` there.
This uses the Pi's existing Python instead of downloading another interpreter.

Use the supplied systemd unit as a template. Set its working directory,
executable, assets and data directory to their absolute installed paths.
Create the data directory owned by `nobody:nogroup` with mode 0700. Application
files should be owned by root and readable by the service. Allow the service
only its own writable data directory. On a TeslaUSB image, application files
belong on `/mutable`, and recordings belong in a dedicated directory on
`/backingfiles`. Keep recordings separate from the TeslaUSB disk images.

Pass `--allowed-origin https://your-dashboard.example` for the browser's
actual origin. Bind to the intended LAN address when using a reverse proxy.
The application has no authentication. Keep it behind a trusted local network
or an authenticated proxy; do not expose its port to the internet.

Optional arguments:

- `--dbc /absolute/path/to/your.dbc`: operator-supplied signal definitions.
  No third-party DBC is bundled. Verify compatibility with the car's firmware.
- `--cells 96`: the installed count of measured cell groups. Confirm the count
  for the pack; a different pack can have a different count.
- `--recording-limit-mib 256`: total saved recording budget. Recording stops
  before exceeding this budget or leaving less than 1 GiB free. Nothing is
  automatically deleted.

Before switching the main port, start the new application on a spare port,
check `/api/health`, live values, missing signals, recording/replay and logs.
Then install and enable only this application's unit. Preserve the old working
service until this check passes. A read-only TeslaUSB root must be temporarily
made writable using that image's supported operator helper to install the
unit, then restored to its previous mount state. Do not reboot, replace the
image, restart TeslaUSB or reset the CAN interface to install this dashboard.

Rollback stops only this application's unit and returns the proxy/port to the
previous working service. Keep saved sessions. Check boot enablement and the
next natural power cycle separately; an active service alone does not prove
that it started at boot.

# Pi installation

The CAN receiver consumes an already configured SocketCAN interface. It never
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

## Optional Bluetooth temperature controls

Use this only after enrolling and qualifying a key with Tesla's official
vehicle-command SDK on the target car. Install its `tesla-control` binary under
the root-private key directory's `bin/`, with `key.pem` and a private `vin` file.
Never copy the key into the web service's directory or expose SDK output to clients.
The helper accepts only a temperature number and checks its local peer's UID.
It has no network listener, arbitrary-command option or automatic retry.

Create a dedicated unprivileged system account and group named `tesla-dashboard`;
it must have no login shell and no membership in other service groups. Change the
dashboard's User/Group and its own data-directory ownership to that account.
Do not give the shared nobody account access to the helper or browser credential.
Adapt `tesla-temperature-helper.service` to the installed paths.
Its private runtime directory must be traversable by the dashboard group and its
socket writable only by root and that group. Systemd removes the runtime socket
on service stop. The helper restores the Bluetooth soft-block state after each
bounded attempt; stopping it forcibly during an attempt requires checking that state.
The service uses the installed SDK with session caching disabled.

Generate a random access code of at least 32 characters on the target host into
a separate file readable only by root and the dashboard account. This is a
browser credential, not the vehicle key. Configure the dashboard with
`--controls-socket /run/tesla-temperature/helper.sock` and
`--controls-token-file /absolute/private/access-code` plus the actual allowed
HTTPS origin. The helper cannot read or change dashboard configuration.
To rotate browser access, replace only this access-code file and restart the
dashboard; the vehicle key and helper do not change. Existing browser codes then fail.
Connect controls using the disclosure in Cabin temperature. An HTTPS-only,
HttpOnly, SameSite=Strict cookie remembers access in that browser for 30 days.
Disconnect controls clears it; rotating the access-code file revokes all browsers.
The code is not placed in URLs, local storage or logs, and the input clears after connection.
Use a trusted local network or authenticated HTTPS proxy, including for telemetry.

Include the operator-qualified `UI_hvacReqTempSetpointLeft` and
`UI_hvacReqTempSetpointRight` signals in the installed DBC. Units C, degC, DegC,
deg C and °C are accepted. Frame length must match actual captures; a newer DBC
is not automatically compatible with all car firmware. Keep the existing qualified
battery, cell and driving definitions when extending a profile.

The UI exposes only both-zone temperature changes, without turning climate on.
Startup, reconnect, page reload and replay never send a vehicle command. Controls
require a live receiver with fresh valid cabin setpoints. Nonces expire after a
minute and are consumed before any attempt. An unknown outcome is not retried;
the next request must follow an explicit user action and current car readings.
Rollback removes both dashboard control flags and stops/disables only this helper.
The enrolled key can remain private on the host or be revoked in the car by its owner.

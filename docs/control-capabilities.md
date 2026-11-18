# Convenience controls

The CAN receiver never transmits. The separate Bluetooth helper uses an
enrolled vehicle key and a small command whitelist. Browser approval does not
enroll a key or turn on additional functions.

| Function | Command path | Feedback | Availability |
| --- | --- | --- | --- |
| Both-zone temperature | Official Bluetooth SDK | Later driver and passenger CAN setpoints | Existing opt-in controls |
| Charge limit | Official Bluetooth SDK | Later CAN charge limit | Existing opt-in controls |
| Charge-port open/close | Official Bluetooth SDK | Later `CP_chargeDoorOpen` from a compatible operator DBC | Prepared; disabled by default |
| Glovebox | No command in the supported SDK CLI | Not qualified | Research only |
| Mirror folding | No command in the supported SDK CLI | Not qualified | Research only |
| Seat heat and battery preconditioning | Compatibility and operating conditions not qualified | Not qualified | Hidden |

The primary command reference is Tesla's
[vehicle-command CLI](https://github.com/teslamotors/vehicle-command/blob/main/cmd/tesla-control/commands.go).
The charge-port actions are `charge-port-open` and `charge-port-close`, with no
extra argument. S3XY's [function catalog](https://www.enhauto.com/pages/buttons-functions)
is a source of ideas, not proof that a particular car or connected bus supports
an action. A signal name in a DBC does not qualify a command or a bit layout.

## Charge-port qualification

Keep both services' normal arguments unchanged until an owner-observed parked
test is prepared. First qualify the operator DBC's `CP_chargeDoorOpen` reading
against the actual door. The app accepts dimensionless binary feedback and
preserves missing, invalid and stale values. No raw layout is bundled.

On an isolated qualification installation, add `--enable-charge-port` to both
the dashboard and helper commands. The dashboard also needs its existing
`--controls-socket`, `--controls-token-file`, live interface and secure allowed
origin. The helper keeps its existing dedicated UID, socket, key and radio
restoration settings. No new browser or key is approved by this option.

With the owner watching, the car in Park and the cable disconnected, test Open,
observe the door and its later CAN reading, then test Close and observe both
again. Check that a repeated target sends nothing, and that Drive, replay,
missing feedback and stale gear reject requests. Never move the car solely to
test rejection; use synthetic fixtures for the non-Park cases.

Buttons appear inside Battery's Charging disclosure only when the dashboard
option is enabled. They share the existing browser connection. Park and door
readings must be fresh before sending. A single-use request sends once; a later
matching CAN sample confirms the result even when Bluetooth acknowledgement
was lost. An acknowledgement alone remains unconfirmed. Check actual state
before any deliberate retry; reload, reconnect and service startup send nothing.

After an unsuccessful qualification, remove the option from both service
commands and return to their saved units. This hides the buttons and restores
the original helper whitelist; it does not remove the key or other controls.
Enable on a daily installation only after recording the target's observed
results. The source's existence and passing fixtures are not vehicle acceptance.

import { display, type Definition, type Snapshot } from "./types";
import type { VehicleControls } from "./vehicle-controls";

export function ChargePort({ data, controls, definition }: { data: Snapshot | null; controls: VehicleControls; definition?: Definition }) {
  if (!controls.capabilities?.actions.includes("charge-port")) return null;
  const reading = data?.signals.chargePortOpen;
  const gear = data?.signals.driveGear;
  const fresh = data?.mode === "live" && data.connection.state === "connected" && reading?.quality === "fresh";
  const parked = gear?.quality === "fresh" && gear.value === 1;
  const opened = reading?.value === 1;
  const label = fresh && definition?.choices ? display(reading, "metric", 0, definition.choices) : "Unavailable";
  return <section class="climate-panel" aria-label="Charge port">
    <div class="section-heading"><h2>Charge port</h2><strong>{label}</strong></div>
    {controls.connected && <>
      <ion-button disabled={controls.busy || !fresh || !parked || opened}
        onClick={() => controls.change("charge-port", { open: true })}>Open</ion-button>
      <ion-button fill="outline" disabled={controls.busy || !fresh || !parked || !opened}
        onClick={() => controls.change("charge-port", { open: false })}>Close</ion-button>
      {fresh && !parked && <p role="status">Available in Park</p>}
    </>}
    {controls.result?.action === "charge-port" && <p role="status">{controls.result.message}</p>}
  </section>;
}

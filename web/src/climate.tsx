import { display, nextCabinTemperature, type Snapshot } from "./types";
import { ControlConnection, type VehicleControls } from "./vehicle-controls";

export function Climate({ data, units, controls }: { data: Snapshot | null; units: string; controls: VehicleControls }) {
  const available = controls.capabilities?.available && controls.capabilities.actions.includes("temperature");
  const limits = controls.capabilities?.temperature;
  const left = data?.signals.driverTemperatureC;
  const right = data?.signals.passengerTemperatureC;
  const live = data?.mode === "live" && data.connection.state === "connected" &&
    left?.quality === "fresh" && right?.quality === "fresh";
  function change(direction: -1 | 1) {
    if (!live || left?.value == null || right?.value == null || !limits) return;
    const target = nextCabinTemperature(left.value, right.value, direction, limits);
    if (target !== null) controls.change("temperature", { temperatureC: target });
  }
  if (!available && left?.value == null && right?.value == null) return null;
  return <section class="climate-panel" aria-label="Cabin temperature">
    <div class="section-heading"><h2>Cabin temperature</h2></div>
    <div class="climate-readings">
      <div><span>Driver</span><strong>{display(left, units)}</strong></div>
      <div><span>Passenger</span><strong>{display(right, units)}</strong></div>
      {available && controls.connected && limits && <div class="climate-adjust">
        <span>Both sides</span>
        <div>
          <ion-button aria-label="Lower both temperatures" disabled={controls.busy || !live || Math.min(left?.value ?? 0, right?.value ?? 0) <= limits.minimumC}
            onClick={() => change(-1)}>−</ion-button>
          <ion-button aria-label="Raise both temperatures" disabled={controls.busy || !live || Math.max(left?.value ?? 0, right?.value ?? 0) >= limits.maximumC}
            onClick={() => change(1)}>+</ion-button>
        </div>
      </div>}
    </div>
    <ControlConnection controls={controls} />
    {controls.connected && !live && <p role="status">Waiting for live cabin readings</p>}
    {controls.result?.action === "temperature" && <p role="status">{controls.result.message}</p>}
  </section>;
}

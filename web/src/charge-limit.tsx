import { useEffect, useState } from "preact/hooks";
import { display, type Snapshot } from "./types";
import { ControlConnection, type VehicleControls } from "./vehicle-controls";

export function ChargeLimit({ data, controls, active }: { data: Snapshot | null; controls: VehicleControls; active: boolean }) {
  const [draft, setDraft] = useState<number | null>(null);
  const reading = data?.signals.chargeLimitPercent;
  const limits = controls.capabilities?.chargeLimit;
  const available = controls.capabilities?.available && controls.capabilities.actions.includes("charge-limit");
  const live = data?.mode === "live" && data.connection.state === "connected" && reading?.quality === "fresh";
  useEffect(() => {
    if (!active || !controls.connected || data?.mode !== "live") setDraft(null);
  }, [active, controls.connected, data?.mode]);
  async function apply() {
    if (!live || draft === null) return;
    await controls.change("charge-limit", { percent: draft });
    setDraft(null);
  }
  return <section class="climate-panel charge-limit-panel" aria-label="Charging limit">
    <div class="section-heading"><h2>Charge limit</h2><strong>{display(reading, "metric", 0)}</strong></div>
    {available && controls.connected && limits && <>
      <ion-range aria-label="Charge limit" min={limits.minimumPercent} max={limits.maximumPercent}
        step={1} pin={true} value={draft ?? reading?.value ?? limits.minimumPercent}
        disabled={controls.busy || !live}
        onionChange={(event: CustomEvent) => setDraft(Math.round(Number(event.detail.value)))} />
      <div class="charge-limit-actions">
        <span>{limits.minimumPercent}%</span><span>{limits.maximumPercent}%</span>
        {draft !== null && draft !== reading?.value && <ion-button disabled={controls.busy || !live}
          onClick={apply}>Set {draft}%</ion-button>}
      </div>
    </>}
    <ControlConnection controls={controls} />
    {controls.connected && !live && <p role="status">Waiting for live charge limit</p>}
    {controls.result?.action === "charge-limit" && <p role="status">{controls.result.message}</p>}
  </section>;
}

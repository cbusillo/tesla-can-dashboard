import { useEffect, useState } from "preact/hooks";
import { api, ApiError, display, type Snapshot } from "./types";

export function Climate({ data, units }: { data: Snapshot | null; units: string }) {
  const [available, setAvailable] = useState(false);
  const [limits, setLimits] = useState<{minimumC: number; maximumC: number; stepC: number} | null>(null);
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const left = data?.signals.driverTemperatureC;
  const right = data?.signals.passengerTemperatureC;
  const live = data?.mode === "live" && data?.connection.state === "connected" &&
    left?.quality === "fresh" && right?.quality === "fresh";

  useEffect(() => {
    api<{ available: boolean; temperature: {minimumC: number; maximumC: number; stepC: number} }>("vehicle-controls")
      .then((result) => { setAvailable(result.available); setLimits(result.temperature); })
      .catch(() => setAvailable(false));
  }, []);

  function request<T>(path: string, body?: unknown): Promise<T> {
    return api<T>("vehicle-controls/" + path, "POST", body ?? {}, {
      headers: { Authorization: "Bearer " + code.trim() }, timeoutMs: 50000,
    });
  }

  async function connect() {
    setBusy(true);
    try {
      await request("connect");
      setConnected(true);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Controls could not connect");
    } finally {
      setBusy(false);
    }
  }

  async function change(delta: number) {
    if (!live || left?.value == null || right?.value == null || !limits) return;
    const baseline = delta < 0 ? Math.min(left.value, right.value) : Math.max(left.value, right.value);
    const target = Math.round((baseline + delta) / limits.stepC) * limits.stepC;
    if (target < limits.minimumC || target > limits.maximumC) return;
    setBusy(true);
    setMessage("Sending…");
    try {
      const prepared = await request<{ nonce: string }>("prepare");
      const result = await request<{ outcome: string }>("temperature", {
        temperatureC: target, nonce: prepared.nonce,
      });
      setMessage(result.outcome === "confirmed" ? "Confirmed by car" :
        result.outcome === "unchanged" ? "Already set" :
        result.outcome === "acknowledged" ? "Sent. Waiting for car readings." :
        "Not confirmed. Check the car before trying again.");
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 409].includes(error.status)) {
        setMessage(error.message);
        if (error.status === 401) setConnected(false);
      } else setMessage("Not confirmed. Check the car before trying again.");
    } finally {
      setBusy(false);
    }
  }

  if (!available && !left?.value && !right?.value) return null;
  return <section class="climate-panel" aria-label="Cabin temperature">
    <div class="section-heading"><h2>Cabin temperature</h2></div>
    <div class="climate-readings">
      <div><span>Driver</span><strong>{display(left, units)}</strong></div>
      <div><span>Passenger</span><strong>{display(right, units)}</strong></div>
      {available && connected && limits && <div class="climate-adjust">
        <span>Both sides</span>
        <div>
          <ion-button aria-label="Lower both temperatures" disabled={busy || !live || Math.min(left?.value ?? 0, right?.value ?? 0) <= limits.minimumC}
            onClick={() => change(-limits.stepC)}>−</ion-button>
          <ion-button aria-label="Raise both temperatures" disabled={busy || !live || Math.max(left?.value ?? 0, right?.value ?? 0) >= limits.maximumC}
            onClick={() => change(limits.stepC)}>+</ion-button>
        </div>
      </div>}
    </div>
    {available && !connected && <details>
      <summary>Connect controls</summary>
      <form onSubmit={(event) => { event.preventDefault(); connect(); }}>
        <label>Access code <input type="password" autoComplete="off" value={code}
          onInput={(event) => setCode(event.currentTarget.value)} disabled={busy} /></label>
        <ion-button type="submit" disabled={busy || !code.trim()}>Connect</ion-button>
      </form>
    </details>}
    {connected && !live && <p role="status">Waiting for live cabin readings</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

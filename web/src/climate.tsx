import { useEffect, useState } from "preact/hooks";
import { api, display, type Snapshot } from "./types";

export function Climate({ data, units }: { data: Snapshot | null; units: string }) {
  const [available, setAvailable] = useState(false);
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const left = data?.signals.driverTemperatureC;
  const right = data?.signals.passengerTemperatureC;
  const live = data?.mode === "live" && data?.connection.state === "connected" &&
    left?.quality === "fresh" && right?.quality === "fresh";

  useEffect(() => {
    api<{ available: boolean }>("vehicle-controls")
      .then((result) => setAvailable(result.available))
      .catch(() => setAvailable(false));
  }, []);

  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch("/api/vehicle-controls/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + code.trim() },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(40000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Change could not be sent");
    return result;
  }

  async function connect() {
    setBusy(true);
    try {
      await request("prepare");
      setConnected(true);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Controls could not connect");
    } finally {
      setBusy(false);
    }
  }

  async function change(delta: number) {
    if (!live || left?.value == null || right?.value == null) return;
    const target = Math.round((Math.max(left.value, right.value) + delta) * 2) / 2;
    if (target < 16 || target > 27) return;
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
      setMessage(error instanceof Error && error.name !== "TimeoutError" ? error.message :
        "Not confirmed. Check the car before trying again.");
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
      {available && connected && <div class="climate-adjust">
        <span>Both sides</span>
        <div>
          <ion-button aria-label="Lower both temperatures" disabled={busy || !live || Math.max(left?.value ?? 0, right?.value ?? 0) <= 16}
            onClick={() => change(-0.5)}>−</ion-button>
          <ion-button aria-label="Raise both temperatures" disabled={busy || !live || Math.max(left?.value ?? 0, right?.value ?? 0) >= 27}
            onClick={() => change(0.5)}>+</ion-button>
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

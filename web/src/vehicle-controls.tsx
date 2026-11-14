import { useEffect, useState } from "preact/hooks";
import { api, ApiError } from "./types";

type Capabilities = {
  available: boolean;
  connected: boolean;
  actions: string[];
  temperature: { minimumC: number; maximumC: number; stepC: number };
  chargeLimit: { minimumPercent: number; maximumPercent: number };
};

export function useVehicleControls() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [result, setResult] = useState<{ action: string; message: string } | null>(null);
  useEffect(() => {
    api<Capabilities>("vehicle-controls").then((value) => {
      setCapabilities(value);
      setConnected(value.connected);
    }).catch(() => setCapabilities(null));
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
      setCode("");
      setConnectionMessage("");
      setResult(null);
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "Controls could not connect");
    } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await request("disconnect");
      setConnected(false);
      setCode("");
      setConnectionMessage("");
      setResult(null);
    } catch { setConnectionMessage("Controls could not disconnect"); }
    finally { setBusy(false); }
  }

  async function change(action: string, body: object): Promise<string | null> {
    setBusy(true);
    setResult({ action, message: "Sending…" });
    try {
      const { nonce } = await request<{ nonce: string }>("prepare");
      const response = await request<{ outcome: string }>(action, { ...body, nonce });
      const message = response.outcome === "confirmed" ? "Confirmed by car" :
        response.outcome === "unchanged" ? "Already set" :
        response.outcome === "acknowledged" ? "Sent. Waiting for car readings." :
        "Not confirmed. Check the car before trying again.";
      setResult({ action, message });
      return response.outcome;
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 409, 422, 429].includes(error.status)) {
        setResult({ action, message: error.message });
        if (error.status === 401) setConnected(false);
      } else setResult({ action, message: "Not confirmed. Check the car before trying again." });
      return null;
    } finally { setBusy(false); }
  }

  return { capabilities, code, setCode, connected, busy, connectionMessage, result, connect, disconnect, change };
}

export type VehicleControls = ReturnType<typeof useVehicleControls>;

export function ControlConnection({ controls }: { controls: VehicleControls }) {
  if (!controls.capabilities?.available) return null;
  return <>
    {!controls.connected ? <details>
      <summary>Connect controls</summary>
      <form onSubmit={(event) => { event.preventDefault(); controls.connect(); }}>
        <label>Access code <input type="password" autoComplete="off" value={controls.code}
          onInput={(event) => controls.setCode(event.currentTarget.value)} disabled={controls.busy} /></label>
        <ion-button type="submit" disabled={controls.busy || !controls.code.trim()}>Connect</ion-button>
      </form>
    </details> : <details><summary>Controls</summary>
      <ion-button fill="clear" disabled={controls.busy} onClick={controls.disconnect}>Disconnect controls</ion-button>
    </details>}
    {controls.connectionMessage && <p role="status">{controls.connectionMessage}</p>}
  </>;
}

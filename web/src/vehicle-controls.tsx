import { useEffect, useRef, useState } from "preact/hooks";
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
  const [pairing, setPairing] = useState<{ number: string; expiresInSeconds: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [result, setResult] = useState<{ action: string; message: string } | null>(null);
  const polling = useRef<Promise<{ connected: boolean }> | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    api<Capabilities>("vehicle-controls").then((value) => {
      setCapabilities(value);
      setConnected(value.connected);
    }).catch(() => setCapabilities(null));
  }, []);

  useEffect(() => {
    if (!pairing || connected) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    cancelled.current = false;
    async function poll() {
      if (!alive || cancelled.current) return;
      const pending = api<{ connected: boolean }>("vehicle-controls/connection-request");
      polling.current = pending;
      try {
        const response = await pending;
        if (!alive || cancelled.current) return;
        if (response.connected) {
          setConnected(true);
          setPairing(null);
          setConnectionMessage("");
          setResult(null);
          return;
        }
      } catch (error) {
        if (!alive || cancelled.current) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          setPairing(null);
          setConnectionMessage("Request expired. Connect again.");
          return;
        }
      } finally {
        if (polling.current === pending) polling.current = null;
      }
      if (alive && !cancelled.current) timer = setTimeout(poll, 1500);
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [pairing?.number, connected]);

  function request<T>(path: string, body?: unknown): Promise<T> {
    return api<T>("vehicle-controls/" + path, "POST", body ?? {}, {
      timeoutMs: 50000,
    });
  }

  async function connect() {
    setBusy(true);
    try {
      const pending = await request<{ number: string; expiresInSeconds: number }>("connection-request");
      setPairing(pending);
      setConnectionMessage("");
      setResult(null);
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "Controls could not connect");
    } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    cancelled.current = true;
    setPairing(null);
    try {
      await polling.current?.catch(() => {});
      await request("disconnect");
      setConnected(false);
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

  return { capabilities, pairing, connected, busy, connectionMessage, result, connect, disconnect, change };
}

export type VehicleControls = ReturnType<typeof useVehicleControls>;

export function ControlConnection({ controls }: { controls: VehicleControls }) {
  if (!controls.capabilities?.available) return null;
  return <>
    {!controls.connected ? <details key="connect">
      <summary>Connect controls</summary>
      {controls.pairing ? <>
        <output class="connection-number" aria-label="Approval number">{controls.pairing.number}</output>
        <p role="status">Waiting for approval…</p>
        <ion-button fill="clear" disabled={controls.busy} onClick={controls.disconnect}>Cancel</ion-button>
      </> : <ion-button disabled={controls.busy} onClick={controls.connect}>Connect</ion-button>}
    </details> : <details key="connected"><summary>Controls</summary>
      <ion-button fill="clear" disabled={controls.busy} onClick={controls.disconnect}>Disconnect controls</ion-button>
    </details>}
    {controls.connectionMessage && <p role="status">{controls.connectionMessage}</p>}
  </>;
}

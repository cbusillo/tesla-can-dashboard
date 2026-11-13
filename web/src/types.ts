export type Reading = {
  value: number | null;
  quality: "fresh" | "stale" | "invalid" | "unavailable";
  unit: string;
  ageSeconds: number | null;
  minimum: number | null;
  maximum: number | null;
  history: number[][];
};
export type Session = { id: string; sizeBytes: number; modifiedAt: number };
export type Snapshot = {
  mode: string;
  currentDirection?: string;
  connection: {
    state: string;
    ageSeconds?: number | null;
    error?: string | null;
  };
  signals: Record<string, Reading>;
  cellGroups: (Reading & { index: number })[];
  cellSpreadMv: number | null;
  freshCellCount: number;
  reloadRevision: string;
  recording: {
    activeId: string | null;
    error: string | null;
    sessions: Session[];
  };
  replay?: { state: string; source: string; error?: string };
};
export type Definition = {
  key: string;
  label: string;
  unit: string;
  group: string;
  minimum: number;
  maximum: number;
  stale_after: number;
};
export type DialRange = { minimum: number; maximum: number };
export type Layout = {
  theme: "auto" | "day" | "night";
  units: "metric" | "imperial";
  instruments: string[];
  presentation: "dials" | "readings" | "history";
  historyInstrument: string;
  ranges: Record<string, DialRange>;
};
export const initialLayout: Layout = {
  theme: "auto",
  units: "metric",
  instruments: ["voltageV", "currentA", "displayedChargePercent"],
  presentation: "dials",
  historyInstrument: "voltageV",
  ranges: {},
};
export function convert(value: number, unit: string, units: string) {
  return units === "imperial"
    ? unit === "°C"
      ? (value * 9) / 5 + 32
      : unit === "km/h"
        ? value / 1.609344
        : value
    : value;
}
export function toCanonical(value: number, unit: string, units: string) {
  return units === "imperial"
    ? unit === "°C"
      ? ((value - 32) * 5) / 9
      : unit === "km/h"
        ? value * 1.609344
        : value
    : value;
}
export function displayUnit(unit: string, units: string) {
  return units === "imperial"
    ? unit === "°C"
      ? "°F"
      : unit === "km/h"
        ? "mph"
        : unit
    : unit;
}
export function usableReading(
  reading: Reading | undefined,
): reading is Reading & { value: number } {
  return (
    reading !== undefined &&
    reading.value !== null &&
    Number.isFinite(reading.value) &&
    (reading.quality === "fresh" || reading.quality === "stale")
  );
}
export function display(
  reading: Reading | undefined,
  units: string,
  decimals?: number,
) {
  if (!usableReading(reading)) return "—";
  return (
    convert(reading.value, reading.unit, units).toFixed(
      decimals ?? (reading.unit === "V" ? 2 : 1),
    ) +
    " " +
    displayUnit(reading.unit, units)
  );
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const message = await response
      .json()
      .catch(() => ({ detail: "Request failed" }));
    throw new Error(
      typeof message.detail === "string"
        ? message.detail
        : "Please check the requested values",
    );
  }
  return response.json();
}

export function holdSnapshot(snapshot: Snapshot, elapsed: number): Snapshot {
  const held = (reading: Reading): Reading => ({
    ...reading,
    quality: reading.quality === "fresh" ? "stale" : reading.quality,
    ageSeconds:
      reading.ageSeconds === null ? null : reading.ageSeconds + elapsed,
  });
  return {
    ...snapshot,
    connection: {
      ...snapshot.connection,
      state: "disconnected",
      ageSeconds:
        snapshot.connection.ageSeconds == null
          ? null
          : snapshot.connection.ageSeconds + elapsed,
    },
    signals: Object.fromEntries(
      Object.entries(snapshot.signals).map(([key, value]) => [
        key,
        held(value),
      ]),
    ),
    cellGroups: snapshot.cellGroups.map((cell) => ({ ...cell, ...held(cell) })),
    freshCellCount: 0,
    cellSpreadMv: null,
  };
}

export function elapsed(seconds: number): string {
  const age = Math.max(0, Math.floor(seconds));
  if (age < 60) return `${age} s`;
  if (age < 3600) return `${Math.floor(age / 60)} min`;
  if (age < 86400) return `${Math.floor(age / 3600)} h`;
  return `${Math.floor(age / 86400)} d`;
}
export function readingStatus(reading: Reading | undefined): string {
  if (!reading || reading.quality === "unavailable") return "Unavailable";
  if (reading.quality === "invalid") return "Invalid";
  if (reading?.quality === "stale")
    return reading.ageSeconds === null
      ? "Stale"
      : `${elapsed(reading.ageSeconds)} old`;
  return "";
}
export function sourceStatus(
  snapshot: Snapshot | null,
  offline: boolean,
): string {
  const age = snapshot?.connection.ageSeconds;
  const lastUpdate = age == null ? "" : `Last update ${elapsed(age)} ago`;
  if (offline) {
    if (snapshot?.replay?.source === "demonstration")
      return "Demo · Pi offline";
    if (snapshot?.mode === "replay") return "Replay · Pi offline";
    return lastUpdate
      ? `Pi offline · ${lastUpdate.toLowerCase()}`
      : "Pi offline";
  }
  if (!snapshot) return "Connecting…";
  if (snapshot.replay?.source === "demonstration") return "Demo";
  if (snapshot.mode === "replay")
    return `Replay · ${snapshot.replay?.state || "playing"}`;
  if (snapshot.connection.error) return "CAN unavailable";
  if (snapshot.connection.state === "connected") return "Live";
  return lastUpdate || "Waiting for CAN";
}

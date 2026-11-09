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
  connection: { state: string; error?: string };
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
  ranges: Record<string, DialRange>;
};
export const initialLayout: Layout = {
  theme: "auto",
  units: "metric",
  instruments: ["voltageV", "currentA", "displayedChargePercent"],
  presentation: "dials",
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
export function display(
  reading: Reading | undefined,
  units: string,
  decimals?: number,
) {
  if (!reading || reading.value === null || reading.quality === "invalid")
    return "—";
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
    connection: { ...snapshot.connection, state: "disconnected" },
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

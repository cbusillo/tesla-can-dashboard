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
    automaticMode?: string | null;
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
  choices?: Record<string, string> | null;
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
const usUnits: Record<string, { unit: string; scale: number; offset: number }> =
  {
    "°C": { unit: "°F", scale: 9 / 5, offset: 32 },
    "km/h": { unit: "mph", scale: 1 / 1.609344, offset: 0 },
    bar: { unit: "psi", scale: 14.503773773, offset: 0 },
  };

export function convert(value: number, unit: string, units: string) {
  const conversion = units === "imperial" ? usUnits[unit] : undefined;
  return conversion ? value * conversion.scale + conversion.offset : value;
}
export function toCanonical(value: number, unit: string, units: string) {
  const conversion = units === "imperial" ? usUnits[unit] : undefined;
  return conversion ? (value - conversion.offset) / conversion.scale : value;
}
export function displayUnit(unit: string, units: string) {
  return units === "imperial" ? (usUnits[unit]?.unit ?? unit) : unit;
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
export function decimalPlaces(unit: string, units: string) {
  return unit === "V" || (unit === "bar" && units !== "imperial") ? 2 : 1;
}
export function formatDialLimit(value: number, unit: string, units: string) {
  return String(
    Number(convert(value, unit, units).toFixed(decimalPlaces(unit, units))),
  );
}
export function canonicalDialLimit(
  input: string,
  original: number,
  unit: string,
  units: string,
) {
  const value = Number(input);
  return value === Number(formatDialLimit(original, unit, units))
    ? original
    : toCanonical(value, unit, units);
}
type DisplayScale = {
  dial: [number, number];
  plotSpan: number;
  zero?: boolean;
  floorZero?: boolean;
  imperial?: { dial: [number, number]; plotSpan: number };
};
const unitScales: Record<string, DisplayScale> = {
  V: { dial: [250, 450], plotSpan: 10, floorZero: true },
  A: { dial: [-1000, 1000], plotSpan: 100, zero: true },
  kW: { dial: [-100, 400], plotSpan: 20, zero: true },
  kWh: { dial: [0, 100], plotSpan: 5, floorZero: true },
  "%": { dial: [0, 100], plotSpan: 10, floorZero: true },
  mV: { dial: [0, 50], plotSpan: 10, floorZero: true },
  "km/h": {
    dial: [0, 160],
    plotSpan: 20,
    floorZero: true,
    imperial: { dial: [0, 100], plotSpan: 10 },
  },
  "°C": {
    dial: [-20, 120],
    plotSpan: 20,
    imperial: { dial: [0, 250], plotSpan: 40 },
  },
  bar: {
    dial: [2, 4],
    plotSpan: 0.4,
    floorZero: true,
    imperial: { dial: [25, 60], plotSpan: 5 },
  },
};
const packTemperatureScale: DisplayScale = {
  dial: [-20, 60],
  plotSpan: 10,
  imperial: { dial: [0, 140], plotSpan: 20 },
};
const cabinTemperatureScale: DisplayScale = {
  dial: [15, 30],
  plotSpan: 5,
  imperial: { dial: [55, 85], plotSpan: 10 },
};
const signalScales: Record<string, DisplayScale> = {
  outputLimitKw: { dial: [0, 400], plotSpan: 50, zero: true, floorZero: true },
  regenLimitKw: { dial: [0, 100], plotSpan: 20, zero: true, floorZero: true },
  chargingPowerKw: { dial: [0, 12], plotSpan: 2, zero: true, floorZero: true },
  fullPackEnergyKwh: { ...unitScales.kWh, plotSpan: 1 },
  minimumTemperatureC: packTemperatureScale,
  maximumTemperatureC: packTemperatureScale,
  driverTemperatureC: cabinTemperatureScale,
  passengerTemperatureC: cabinTemperatureScale,
};
function axisStep(span: number) {
  const size = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(size));
  const fraction = size / magnitude;
  return (
    ([1, 2, 5, 10].find((step) => step >= fraction - 1e-12) ?? 10) * magnitude
  );
}
export function dialRange(
  definition: Definition | undefined,
  reading: Reading | undefined,
  units: string,
  custom?: DialRange,
): DialRange {
  if (custom) return custom;
  const unit = definition?.unit ?? reading?.unit ?? "";
  const preset = signalScales[definition?.key ?? ""] ?? unitScales[unit];
  const imperial = units === "imperial" ? preset?.imperial : undefined;
  const canonical = preset?.dial ?? [
    definition?.minimum ?? 0,
    definition?.maximum ?? 100,
  ];
  let minimum = imperial?.dial[0] ?? convert(canonical[0], unit, units);
  let maximum = imperial?.dial[1] ?? convert(canonical[1], unit, units);
  const step = axisStep(maximum - minimum);
  const seen = [
    reading?.minimum,
    reading?.maximum,
    usableReading(reading) ? reading.value : null,
  ]
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
    .map((value) => convert(value, unit, units));
  if (seen.length) {
    minimum = Math.min(minimum, Math.floor(Math.min(...seen) / step) * step);
    maximum = Math.max(maximum, Math.ceil(Math.max(...seen) / step) * step);
  }
  return {
    minimum: toCanonical(minimum, unit, units),
    maximum: toCanonical(maximum, unit, units),
  };
}
export function historyDisplayRange(
  key: string,
  unit: string,
  units: string,
  values: (number | null)[],
): DialRange {
  const preset = signalScales[key] ?? unitScales[unit];
  const valid = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  const minSpan =
    units === "imperial" && preset?.imperial
      ? preset.imperial.plotSpan
      : Math.abs(
          convert(preset?.plotSpan ?? 1, unit, units) - convert(0, unit, units),
        );
  let minimum = valid.length ? Math.min(...valid) : 0;
  let maximum = valid.length ? Math.max(...valid) : minSpan;
  if (preset?.zero) {
    minimum = Math.min(0, minimum);
    maximum = Math.max(0, maximum);
  }
  const span = Math.max(maximum - minimum, minSpan);
  const center = (minimum + maximum) / 2;
  minimum = center - span * 0.6;
  maximum = center + span * 0.6;
  const step = axisStep(maximum - minimum);
  minimum = Math.floor(minimum / step) * step;
  maximum = Math.ceil(maximum / step) * step;
  if (preset?.floorZero && valid.every((value) => value >= 0))
    minimum = Math.max(0, minimum);
  if (unit === "%" && valid.every((value) => value >= 0 && value <= 100)) {
    minimum = Math.max(0, minimum);
    maximum = Math.min(100, maximum);
  }
  return {
    minimum: Number(minimum.toPrecision(12)),
    maximum: Number(maximum.toPrecision(12)),
  };
}
export function display(
  reading: Reading | undefined,
  units: string,
  decimals?: number,
  choices?: Definition["choices"],
) {
  if (!usableReading(reading)) return "—";
  if (choices) return choices[String(reading.value)] ?? "—";
  return (
    convert(reading.value, reading.unit, units).toFixed(
      decimals ?? decimalPlaces(reading.unit, units),
    ) +
    " " +
    displayUnit(reading.unit, units)
  );
}
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function nextCabinTemperature(
  driver: number,
  passenger: number,
  direction: -1 | 1,
  limits: { minimumC: number; maximumC: number; stepC: number },
): number | null {
  const baseline =
    direction < 0 ? Math.min(driver, passenger) : Math.max(driver, passenger);
  const target =
    Math.round((baseline + direction * limits.stepC) / limits.stepC) *
    limits.stepC;
  return Number.isFinite(target) &&
    target >= limits.minimumC &&
    target <= limits.maximumC
    ? target
    : null;
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
  });
  if (!response.ok) {
    const message = await response
      .json()
      .catch(() => ({ detail: "Request failed" }));
    throw new ApiError(
      typeof message.detail === "string"
        ? message.detail
        : "Please check the requested values",
      response.status,
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
  if (snapshot.connection.error) return "Vehicle data unavailable";
  if (snapshot.connection.state === "connected") return "Live";
  return lastUpdate || "Waiting for vehicle";
}

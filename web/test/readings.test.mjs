import assert from "node:assert/strict";
import { test } from "node:test";
import {
  display,
  readingStatus,
  sourceStatus,
  holdSnapshot,
  convert,
  toCanonical,
  nextCabinTemperature,
  formatDialLimit,
  canonicalDialLimit,
  dialRange,
  historyDisplayRange,
} from "../src/types.ts";

test("both-zone adjustment moves each side in the chosen direction and respects the supplied limits", () => {
  const limits = { minimumC: 16, maximumC: 27, stepC: 0.5 };
  assert.equal(nextCabinTemperature(19, 22, -1, limits), 18.5);
  assert.equal(nextCabinTemperature(19, 22, 1, limits), 22.5);
  assert.equal(nextCabinTemperature(limits.minimumC, 22, -1, limits), null);
  assert.equal(nextCabinTemperature(19, limits.maximumC, 1, limits), null);
});

const fresh = (value, unit = "A") => ({
  value,
  unit,
  quality: "fresh",
  ageSeconds: 0,
  minimum: value,
  maximum: value,
  history: [[100, value]],
});

test("categorical readings use supplied labels without making missing or invalid values readable", () => {
  const choices = { "-2": "Idle", 18: "Running" };
  assert.equal(display(fresh(-2), "metric", undefined, choices), choices[-2]);
  assert.equal(
    display({ ...fresh(18), quality: "stale" }, "imperial", undefined, choices),
    choices[18],
  );
  for (const reading of [
    undefined,
    fresh(99),
    { ...fresh(18), quality: "invalid" },
    fresh(null),
  ])
    assert.equal(display(reading, "metric", undefined, choices), "—");
});

test("an offline browser holds zero without converting absent or invalid readings to usable values", () => {
  const snapshot = {
    mode: "live",
    connection: { state: "connected", ageSeconds: 2 },
    signals: {
      currentA: fresh(0),
      missing: { ...fresh(null), quality: "unavailable", ageSeconds: null },
      invalid: { ...fresh(null), quality: "invalid" },
    },
    cellGroups: [{ ...fresh(4.01, "V"), index: 1 }],
    freshCellCount: 1,
    cellSpreadMv: 0,
  };
  const held = holdSnapshot(snapshot, 8);
  assert.equal(held.signals.currentA.value, 0);
  assert.equal(held.signals.currentA.ageSeconds, 8);
  assert.equal(held.signals.currentA.quality, "stale");
  assert.equal(held.signals.missing.ageSeconds, null);
  assert.equal(held.signals.missing.quality, snapshot.signals.missing.quality);
  assert.equal(held.signals.invalid.quality, snapshot.signals.invalid.quality);
  assert.equal(held.cellSpreadMv, null);
  assert.equal(held.freshCellCount, 0);
  assert.notEqual(held.connection.state, snapshot.connection.state);
  assert.equal(snapshot.signals.currentA.quality, "fresh");
  assert.equal(
    display(held.signals.currentA, "metric"),
    display(snapshot.signals.currentA, "metric"),
  );
  assert.notEqual(
    display(held.signals.currentA, "metric"),
    display(held.signals.missing, "metric"),
  );
  assert.notEqual(
    readingStatus(held.signals.currentA),
    readingStatus(held.signals.invalid),
  );
  assert.notEqual(sourceStatus(held, true), sourceStatus(snapshot, false));
});

test("nonfinite and unusable readings never become numeric displays", () => {
  const absent = display(undefined, "metric");
  assert.ok(readingStatus(undefined));
  assert.equal(
    readingStatus(undefined),
    readingStatus({ ...fresh(null), quality: "unavailable" }),
  );
  assert.notEqual(readingStatus(undefined), readingStatus(fresh(0)));
  for (const value of [NaN, Infinity, -Infinity, null])
    assert.equal(display(fresh(value), "metric"), absent);
  for (const quality of ["unavailable", "invalid"])
    assert.equal(display({ ...fresh(0), quality }, "metric"), absent);
  assert.notEqual(display(fresh(0), "metric"), absent);
});

test("saved temperature, speed and pressure limits round trip through US units in canonical units", () => {
  for (const [value, unit] of [
    [0, "°C"],
    [-20, "°C"],
    [80, "°C"],
    [120, "km/h"],
    [3, "bar"],
  ]) {
    assert.ok(
      Math.abs(
        toCanonical(convert(value, unit, "imperial"), unit, "imperial") - value,
      ) < 1e-10,
    );
  }
  assert.equal(display(fresh(3, "bar"), "imperial"), "43.5 psi");
  assert.equal(display(fresh(3, "bar"), "metric"), "3.00 bar");
});

test("rounded dial inputs preserve untouched limits and convert deliberate edits", () => {
  for (const [value, unit] of [
    [2, "bar"],
    [450, "km/h"],
    [-39, "°C"],
  ]) {
    const shown = formatDialLimit(value, unit, "imperial");
    assert.equal(canonicalDialLimit(shown, value, unit, "imperial"), value);
  }
  assert.equal(formatDialLimit(2, "bar", "imperial"), "29");
  const edited = canonicalDialLimit("30", 2, "bar", "imperial");
  assert.ok(edited > 2.06 && edited < 2.07);
});

test("automatic dials focus on driving readings and expand for retained extremes without changing custom limits", () => {
  const definition = { key: "voltageV", unit: "V", minimum: 0, maximum: 1000 };
  const normal = dialRange(definition, fresh(380, "V"), "metric");
  assert.ok(normal.minimum > definition.minimum);
  assert.ok(normal.maximum < definition.maximum);
  assert.ok(normal.minimum <= 380 && normal.maximum >= 380);
  const expanded = dialRange(
    definition,
    { ...fresh(380, "V"), minimum: 180, maximum: 520 },
    "metric",
  );
  assert.ok(expanded.minimum <= 180 && expanded.maximum >= 520);
  const custom = { minimum: 300, maximum: 420 };
  assert.equal(
    dialRange(definition, fresh(520, "V"), "imperial", custom),
    custom,
  );
});

test("US dials have readable endpoints and preserve canonical values", () => {
  for (const [key, unit, value] of [
    ["speedKph", "km/h", 80],
    ["minimumTemperatureC", "°C", 20],
    ["pressure", "bar", 2.8],
  ]) {
    const range = dialRange(
      { key, unit, minimum: -100, maximum: 1000 },
      fresh(value, unit),
      "imperial",
    );
    for (const bound of [range.minimum, range.maximum]) {
      const shown = convert(bound, unit, "imperial");
      assert.ok(Math.abs(shown - Math.round(shown)) < 1e-9);
    }
    assert.ok(range.minimum <= value && range.maximum >= value);
  }
});

test("history scales ignore gaps, resist tiny fluctuations and include all finite extremes", () => {
  for (const [key, unit, values] of [
    ["voltageV", "V", [379.99, null, 380.01]],
    ["powerKw", "kW", [-65, null, 320]],
    ["minimumTemperatureC", "°C", [-12, -11.99]],
    ["displayedChargePercent", "%", [0, 100]],
  ]) {
    const scale = historyDisplayRange(key, unit, "metric", [
      ...values,
      NaN,
      Infinity,
    ]);
    const numbers = values.filter((value) => value !== null);
    assert.ok(scale.minimum <= Math.min(...numbers));
    assert.ok(scale.maximum >= Math.max(...numbers));
    assert.ok(scale.maximum - scale.minimum > 1);
  }
  const metric = historyDisplayRange("minimumTemperatureC", "°C", "metric", [
    20,
  ]);
  const imperial = historyDisplayRange(
    "minimumTemperatureC",
    "°C",
    "imperial",
    [68],
  );
  assert.ok(
    imperial.maximum - imperial.minimum < (metric.maximum - metric.minimum) * 3,
  );
  const zero = historyDisplayRange("powerKw", "kW", "metric", [0, null]);
  assert.ok(
    zero.minimum < zero.maximum && zero.minimum <= 0 && zero.maximum >= 0,
  );
  const missing = historyDisplayRange("unknown", "", "metric", [null, NaN]);
  assert.ok(
    Number.isFinite(missing.minimum) && missing.maximum > missing.minimum,
  );
});

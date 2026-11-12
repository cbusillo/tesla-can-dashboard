import assert from "node:assert/strict";
import { test } from "node:test";
import {
  display,
  readingStatus,
  sourceStatus,
  holdSnapshot,
  convert,
  toCanonical,
} from "../src/types.ts";

const fresh = (value, unit = "A") => ({
  value,
  unit,
  quality: "fresh",
  ageSeconds: 0,
  minimum: value,
  maximum: value,
  history: [[100, value]],
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

test("saved temperature and speed limits round trip through US units in canonical units", () => {
  for (const [value, unit] of [
    [0, "°C"],
    [-20, "°C"],
    [80, "°C"],
    [120, "km/h"],
  ]) {
    assert.ok(
      Math.abs(
        toCanonical(convert(value, unit, "imperial"), unit, "imperial") - value,
      ) < 1e-10,
    );
  }
});

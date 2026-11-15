import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCells } from "../src/cell-summary.ts";

function cell(index, value, quality = "fresh") {
  return {
    index,
    value,
    quality,
    unit: "V",
    ageSeconds: 0,
    minimum: value,
    maximum: value,
    history: [],
  };
}

test("cell deviation reference excludes stale, invalid, missing and nonfinite readings", () => {
  const result = summarizeCells([
    cell(1, 3.9),
    cell(2, 3.92),
    cell(3, 4.2, "stale"),
    cell(4, 0, "invalid"),
    cell(5, null, "unavailable"),
    cell(6, NaN),
  ]);
  assert.deepEqual(
    result.fresh.map((item) => item.index),
    [1, 2],
  );
  assert.equal(result.lowest.index, 1);
  assert.equal(result.highest.index, 2);
  assert(Math.abs(result.average - 3.91) < 0.000001);
});

test("missing cell coverage has no fabricated average while a valid zero remains a value", () => {
  const missing = summarizeCells([
    cell(1, null, "unavailable"),
    cell(2, 3.9, "stale"),
  ]);
  assert.equal(missing.average, null);
  assert.equal(missing.lowest, null);
  assert.equal(missing.highest, null);
  const zero = summarizeCells([cell(1, 0)]);
  assert.equal(zero.average, 0);
  assert.equal(zero.lowest.value, 0);
});

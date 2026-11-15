import { useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { display, readingStatus, usableReading, type Snapshot } from "./types";
import { summarizeCells } from "./cell-summary";
import { Value } from "./dashboard";

const CellChart = lazy(() =>
  import("./charts").then((module) => ({ default: module.CellChart })),
);

export function Cells({
  data,
  active,
  dark,
}: {
  data: Snapshot | null;
  active: boolean;
  dark: boolean;
}) {
  const [selected, setSelected] = useState(1);
  const cells = data?.cellGroups || [];
  const { fresh, lowest, highest, average } = summarizeCells(cells);
  const position = Math.max(
    0,
    cells.findIndex((item) => item.index === selected),
  );
  const cell = cells[position];
  const spread = data?.cellSpreadMv;
  const deviation =
    cell?.quality === "fresh" && usableReading(cell) && average !== null
      ? (cell.value - average) * 1000
      : null;
  return (
    <main class="cells-page">
      <div class="cell-summary">
        <div>
          <span>Spread</span>
          <strong>
            {spread == null || !Number.isFinite(spread) ? (
              "—"
            ) : (
              <>
                {spread.toFixed(1)}
                <small> mV</small>
              </>
            )}
          </strong>
        </div>
        <button
          class="cell-extreme"
          disabled={!lowest}
          onClick={() => lowest && setSelected(lowest.index)}
        >
          <span>Lowest</span>
          <strong>
            <Value reading={lowest ?? undefined} units="metric" decimals={4} />
          </strong>
          {lowest && <small>Group {lowest.index}</small>}
        </button>
        <button
          class="cell-extreme"
          disabled={!highest}
          onClick={() => highest && setSelected(highest.index)}
        >
          <span>Highest</span>
          <strong>
            <Value reading={highest ?? undefined} units="metric" decimals={4} />
          </strong>
          {highest && <small>Group {highest.index}</small>}
        </button>
        <div>
          <span>Average</span>
          <strong>
            {average === null ? (
              "—"
            ) : (
              <>
                {average.toFixed(4)}
                <small> V</small>
              </>
            )}
          </strong>
        </div>
      </div>
      <div class="cell-scale-heading">
        <span>mV from average</span>
        <span>
          {fresh.length === cells.length && cells.length
            ? `${cells.length} groups`
            : `${fresh.length} of ${cells.length || "—"} groups`}
        </span>
      </div>
      {active && (
        <Suspense fallback={<div class="chart-loading">Loading cells…</div>}>
          <CellChart
            cells={cells}
            selected={cell?.index ?? null}
            onSelect={setSelected}
            dark={dark}
          />
        </Suspense>
      )}
      <input
        class="cell-scrubber"
        type="range"
        aria-label="Select cell group"
        min={0}
        max={Math.max(0, cells.length - 1)}
        step={1}
        value={position}
        disabled={!cells.length}
        onInput={(event) =>
          setSelected(cells[Number(event.currentTarget.value)].index)
        }
      />
      <div
        class={`cell-inspector ${cell?.quality || "unavailable"}`}
        aria-live="polite"
      >
        <div class="cell-navigation">
          <button
            aria-label="Previous cell group"
            disabled={!cell || position === 0}
            onClick={() => setSelected(cells[position - 1].index)}
          >
            ‹
          </button>
          <label>
            Group
            <select
              aria-label="Selected cell group"
              value={cell?.index ?? ""}
              disabled={!cells.length}
              onChange={(event) =>
                setSelected(Number(event.currentTarget.value))
              }
            >
              {cells.map((item) => (
                <option key={item.index} value={item.index}>
                  {item.index}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label="Next cell group"
            disabled={!cell || position === cells.length - 1}
            onClick={() => setSelected(cells[position + 1].index)}
          >
            ›
          </button>
        </div>
        <div>
          <span>Voltage</span>
          <strong>
            <Value reading={cell} units="metric" decimals={4} />
          </strong>
          {readingStatus(cell) && <small>{readingStatus(cell)}</small>}
        </div>
        <div>
          <span>From average</span>
          <strong>
            {deviation === null ? (
              "—"
            ) : (
              <>
                {deviation > 0 ? "+" : ""}
                {deviation.toFixed(1)}
                <small> mV</small>
              </>
            )}
          </strong>
        </div>
        <div class="cell-observed">
          <span>Seen</span>
          <strong>
            {cell?.minimum == null || cell.maximum == null ? (
              "—"
            ) : (
              <>
                {cell.minimum.toFixed(4)}–{cell.maximum.toFixed(4)}
                <small> V</small>
              </>
            )}
          </strong>
        </div>
      </div>
      <details class="cell-picker">
        <summary>Choose group</summary>
        <div class="cell-grid" role="group" aria-label="Cell groups">
          {cells.map((item) => (
            <button
              key={item.index}
              aria-label={`Group ${item.index}: ${display(item, "metric", 4)}, ${readingStatus(item) || "Current"}`}
              class={`${item.index === cell?.index ? "selected " : ""}${item.quality}`}
              aria-pressed={item.index === cell?.index}
              onClick={() => setSelected(item.index)}
            >
              {item.index}
            </button>
          ))}
        </div>
      </details>
    </main>
  );
}

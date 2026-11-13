import { useEffect, useRef, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
const Chart = lazy(() =>
  import("./charts").then((module) => ({ default: module.Chart })),
);
import { convert, displayUnit, type Session } from "./types";
import "./session-analysis.css";

type Run = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  endSpeedKmh: number;
  sampleResolutionSeconds: number;
};
type Measurement = {
  id: string;
  quality: string;
  reasons: string[];
  runs: Run[];
};
type Observation = {
  label: string;
  quality: string;
  unit: string;
  samples: number;
  invalidSamples: number;
  gaps: number;
  first: number | null;
  last: number | null;
  minimum: number | null;
  maximum: number | null;
  observedDelta: number | null;
  coveredSeconds: number;
  curve: [number, number | null][];
  curveSampled: boolean;
};
export type Analysis = {
  schemaVersion: number;
  sessionId: string;
  quality: string;
  reasons: string[];
  recording: {
    frames: number;
    durationSeconds: number | null;
    decodeErrors: number;
  };
  timing: { maximumSpeedGapSeconds: number; precision: string };
  performance: {
    groups: { convention: string; measurements: Measurement[] }[];
    omittedRuns: number;
  };
  battery: {
    quality: string;
    currentDirection?: string;
    energy?: {
      drawnKwh: number | null;
      regeneratedKwh: number | null;
      peakDrawKw: number | null;
      peakRegenKw: number | null;
      coveredSeconds: number;
      quality: string;
    };
    signals: Record<string, Observation>;
    charging: {
      quality: string;
      observedEnergyKwh: number | null;
      coveredSeconds: number;
      boundary: string;
    };
  };
};
const labels: Record<string, string> = {
  "0-60-mph": "0–60 mph",
  "0-100-kmh": "0–100 km/h",
  "30-70-mph": "30–70 mph",
  "80-120-kmh": "80–120 km/h",
  "quarter-mile": "Quarter mile",
};
const reasons: Record<string, string> = {
  interrupted_tail:
    "The last reading was incomplete and left out; earlier readings were kept",
  non_forward_gear: "Park or Neutral interrupted measurement",
  missing_speed: "No supported speed samples",
  unknown_direction: "Forward travel was not confirmed",
  reverse_direction: "Reverse gear interrupted measurement",
  invalid_speed: "Invalid speed interrupted measurement",
  speed_gap: "Speed samples too far apart",
  non_monotonic_speed: "Speed reading times were inconsistent",
  incomplete_interval: "No complete interval with sufficient data",
  invalid_recording: "The recording could not be read reliably",
  empty_recording: "No readings recorded",
  decode_errors: "Some readings could not be read",
  run_limit: "Run display limit reached; no best selected",
};
function explain(items: string[]) {
  return items
    .map((item) => reasons[item] || item.replaceAll("_", " "))
    .join(". ");
}
function observed(value: number | null, unit: string, units = "metric") {
  if (value === null) return "Unavailable";
  if (unit === "kWh" && value > 0 && value < 0.001) return "<0.001 kWh";
  return `${convert(value, unit, units).toFixed(unit === "kWh" ? 3 : 1)} ${displayUnit(unit, units)}`;
}
function MeasurementCard({ measurement }: { measurement: Measurement }) {
  return (
    <article className="session-measurement">
      <h4>{labels[measurement.id] || "Measurement"}</h4>
      {measurement.runs.length === 0 ? (
        <p>Unavailable</p>
      ) : (
        <ol>
          {measurement.runs.map((run, index) => (
            <li key={`${run.startSeconds}-${index}`}>
              <strong>{run.durationSeconds.toFixed(1)} s</strong>
              <details>
                <summary>Details</summary>
                <span>
                  From {run.startSeconds.toFixed(1)} s · samples up to{" "}
                  {run.sampleResolutionSeconds.toFixed(2)} s apart
                </span>
              </details>
            </li>
          ))}
        </ol>
      )}
      {measurement.runs.length === 0 && measurement.reasons.length > 0 && (
        <small>
          {explain([
            measurement.reasons.find(
              (reason) => reason !== "incomplete_interval",
            ) || "incomplete_interval",
          ])}
        </small>
      )}
    </article>
  );
}
function ObservationCurve({
  signal,
  label,
  units,
}: {
  signal: Observation;
  label: string;
  units: string;
}) {
  const style = getComputedStyle(document.documentElement);
  const muted = style.getPropertyValue("--muted").trim() || style.color;
  const accent = style.getPropertyValue("--accent").trim() || style.color;
  return (
    <Suspense fallback={<p>Loading chart…</p>}>
      <Chart
        label={`${label} over time`}
        height={160}
        option={{
          grid: { left: 50, right: 16, top: 20, bottom: 35 },
          tooltip: { trigger: "item", renderMode: "richText", confine: true },
          xAxis: { type: "value", name: "s", axisLabel: { color: muted } },
          yAxis: {
            type: "value",
            scale: true,
            name: displayUnit(signal.unit, units),
            axisLabel: { color: muted },
          },
          series: [
            {
              type: "line",
              data: signal.curve.map(([seconds, value]) => [
                seconds,
                value === null ? null : convert(value, signal.unit, units),
              ]),
              showSymbol: true,
              symbolSize: 4,
              connectNulls: false,
              lineStyle: { opacity: 0 },
              itemStyle: { color: accent },
            },
          ],
        }}
      />
    </Suspense>
  );
}
function EnergyComparison({
  first,
  second,
}: {
  first: Analysis;
  second: Analysis;
}) {
  function energy(result: Analysis) {
    return result.quality !== "invalid" &&
      result.battery.energy?.quality !== "unavailable"
      ? result.battery.energy
      : undefined;
  }
  const a = energy(first);
  const b = energy(second);
  return (
    <section aria-label="Session comparison">
      <h3>Comparison</h3>
      <table className="session-comparison">
        <thead>
          <tr>
            <th scope="col">Estimated</th>
            <th scope="col">Selected session</th>
            <th scope="col">Other session</th>
          </tr>
        </thead>
        <tbody>
          {([
            ["Energy used", "drawnKwh", "kWh"],
            ["Energy regained", "regeneratedKwh", "kWh"],
            ["Peak draw", "peakDrawKw", "kW"],
            ["Peak regen", "peakRegenKw", "kW"],
            ["Driving data", "coveredSeconds", "s"],
          ] as const).map(([label, key, unit]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>{observed(a?.[key] ?? null, unit)}</td>
              <td>{observed(b?.[key] ?? null, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(a?.quality === "partial" || b?.quality === "partial") && (
        <p>Some readings missing.</p>
      )}
    </section>
  );
}

export function SessionAnalysis({
  sessions,
  activeId,
  units = "metric",
}: {
  sessions: Session[];
  activeId: string | null;
  units?: string;
}) {
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<Analysis | null>(null);
  const [compareWith, setCompareWith] = useState("");
  const [comparison, setComparison] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const available = sessions.filter((session) => session.id !== activeId);
  const exists = available.some((session) => session.id === selected);
  const comparisonExists = available.some(
    (session) => session.id === compareWith && session.id !== selected,
  );
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setResult(null);
    setComparison(null);
    setError("");
    setBusy(false);
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [selected, exists, compareWith, comparisonExists]);
  async function analyze() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setResult(null);
    setComparison(null);
    const timeout = window.setTimeout(() => request.abort(), 30000);
    try {
      async function review(identifier: string) {
        const response = await fetch(
          `/api/recordings/${encodeURIComponent(identifier)}/analysis`,
          { signal: request.signal },
        );
        const data = await response.json().catch(() => ({
          detail: "Session could not be reviewed. Try again.",
        }));
        if (!response.ok)
          throw new Error(data.detail || "Session could not be reviewed");
        return data as Analysis;
      }
      const data = await review(selected);
      const other = comparisonExists ? await review(compareWith) : null;
      if (!request.signal.aborted) {
        setResult(data);
        setComparison(other);
      }
    } catch (failure) {
      if (controller.current === request) {
        setError(
          request.signal.aborted
            ? "Review took too long. Wait for it to finish before trying again."
            : failure instanceof Error
              ? failure.message
              : "Session could not be reviewed",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === request) setBusy(false);
    }
  }
  return (
    <section
      className="session-analysis"
      aria-label="Recorded session analysis"
    >
      <header>
        <h2>Session review</h2>
      </header>
      <div className="session-picker">
        <label>
          Completed recording
          <select
            value={exists ? selected : ""}
            onChange={(event) => {
              setSelected(event.currentTarget.value);
              setCompareWith("");
            }}
          >
            <option value="">Choose a recording</option>
            {available.map((session) => (
              <option key={session.id} value={session.id}>
                {new Date(session.modifiedAt * 1000).toLocaleString()} ·{" "}
                {(session.sizeBytes / 1024).toFixed(0)} KB
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!exists || busy || activeId !== null}
          onClick={() => void analyze()}
        >
          {busy ? "Reviewing…" : "Review"}
        </button>
      </div>
      <details className="session-conventions">
        <summary>Compare sessions</summary>
        <div className="session-picker">
          <label>
            Other session
            <select
              aria-label="Other session"
              value={comparisonExists ? compareWith : ""}
              onChange={(event) => setCompareWith(event.currentTarget.value)}
            >
              <option value="">No comparison</option>
              {available
                .filter((session) => session.id !== selected)
                .map((session) => (
                  <option key={session.id} value={session.id}>
                    {new Date(session.modifiedAt * 1000).toLocaleString()}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </details>
      {available.length === 0 && (
        <p>Stop and save a recording to analyze it.</p>
      )}
      {activeId !== null && <p>Stop recording to analyze saved sessions.</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div aria-live="polite">
          <p>
            {observed(result.recording.durationSeconds, "s")} · Estimates · No
            rollout
            {result.quality === "partial"
              ? " · Partial"
              : result.quality === "invalid"
                ? " · Invalid"
                : ""}
          </p>
          {result.quality === "invalid" && <p>{explain(result.reasons)}</p>}
          {result.quality !== "invalid" && (
            <>
              {comparison && (
                <EnergyComparison first={result} second={comparison} />
              )}
              <details className="session-conventions">
                <summary>Timing and data quality</summary>
                <p>
                  Estimates with no rollout. Standing timing starts at the last
                  observed zero. Speed samples must be at most{" "}
                  {result.timing.maximumSpeedGapSeconds} s apart. Durations use
                  recorded reading times. Timing accuracy has not been
                  independently verified.
                </p>
                {result.reasons.length > 0 && <p>{explain(result.reasons)}</p>}
                <p>
                  Curves show sampled observations by elapsed seconds. Points
                  are not joined across unobserved time.
                </p>
                <p>
                  Compatibility with the recording's original setup has not been
                  verified.{" "}
                  {(result.battery.currentDirection ?? "unqualified") ===
                  "unqualified"
                    ? "Current direction is unverified. "
                    : "Battery power is positive when used and negative when regained. "}
                  These readings do not establish battery health, age, range or
                  charging ETA.
                </p>
                <p>
                  AC input energy covers{" "}
                  {result.battery.charging.coveredSeconds.toFixed(1)} s of
                  adjacent samples. It is not pack energy or DC fast-charge
                  energy.
                </p>
              </details>
              {result.performance.groups.map((group) => (
                <section key={group.convention}>
                  <h3>
                    {group.convention.startsWith("standing")
                      ? "Standing start"
                      : "Rolling start"}
                  </h3>
                  <div className="session-measurements">
                    {group.measurements.map((measurement) => (
                      <MeasurementCard
                        key={measurement.id}
                        measurement={measurement}
                      />
                    ))}
                  </div>
                </section>
              ))}
              <h3>Battery and charging</h3>
              {result.battery.energy &&
                result.battery.energy.quality !== "unavailable" && (
                  <>
                    <dl className="session-observations">
                      {[
                        ["Energy used", result.battery.energy.drawnKwh, "kWh"],
                        [
                          "Energy regained",
                          result.battery.energy.regeneratedKwh,
                          "kWh",
                        ],
                        ["Peak draw", result.battery.energy.peakDrawKw, "kW"],
                        ["Peak regen", result.battery.energy.peakRegenKw, "kW"],
                      ].map(([label, value, unit]) => (
                        <div key={String(label)}>
                          <dt>{label}</dt>
                          <dd>
                            {observed(value as number | null, String(unit))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p>
                      {result.battery.energy.coveredSeconds.toFixed(0)} s
                      recorded ·{" "}
                      {result.battery.energy.quality === "partial"
                        ? "Some readings missing"
                        : "Estimated pack energy"}
                    </p>
                  </>
                )}
              <p>
                AC input energy ·{" "}
                {observed(result.battery.charging.observedEnergyKwh, "kWh")}
                {result.battery.charging.quality === "partial" &&
                  " · Some readings missing"}
              </p>
              <dl className="session-observations">
                {Object.entries(result.battery.signals).map(([key, signal]) => (
                  <div key={key}>
                    <dt>{signal.label}</dt>
                    <dd>
                      {signal.samples ? (
                        <>
                          {observed(signal.first, signal.unit, units)} →{" "}
                          {observed(signal.last, signal.unit, units)}
                          <details className="session-reading-details">
                            <summary>Details</summary>
                            <small>
                            Observed{" "}
                            {observed(signal.minimum, signal.unit, units)} to{" "}
                            {observed(signal.maximum, signal.unit, units)} ·{" "}
                            {signal.samples} samples · {signal.quality}
                            </small>
                          </details>
                        </>
                      ) : (
                        "Unavailable"
                      )}
                    </dd>
                    {signal.samples > 0 && (
                      <ObservationCurve
                        signal={signal}
                        label={signal.label}
                        units={units}
                      />
                    )}
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      )}
    </section>
  );
}

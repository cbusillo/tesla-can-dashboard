import { useEffect, useState } from "preact/hooks";
import { lazy, memo, Suspense } from "preact/compat";
import { api, type Reading } from "./types";

const metrics = [
  { key: "displayedChargePercent", label: "Charge", unit: "%" },
  { key: "fullPackEnergyKwh", label: "Full pack", unit: "kWh" },
  { key: "cellSpreadMv", label: "Cell spread", unit: "mV" },
  { key: "maximumTemperatureC", label: "Temperature", unit: "°C" },
];

const History = lazy(() =>
  import("./charts").then((module) => ({ default: module.History })),
);
type Observation = {
  timestamp: number;
  signals: Record<string, number | null>;
  cellSpreadMv: number | null;
};
type Result = {
  observations: Observation[];
  count: number;
  error: string | null;
};

export const BatteryHistory = memo(function BatteryHistory({
  active,
  units,
  dark,
}: {
  active: boolean;
  units: string;
  dark: boolean;
}) {
  const [days, setDays] = useState(7),
    [metric, setMetric] = useState("displayedChargePercent"),
    [data, setData] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!active) return;
    let canceled = false;
    setLoading(true);
    setError("");
    setData(null);
    api<Result>(`battery-history?days=${days}`)
      .then((result) => {
        if (!canceled) {
          setData(result);
          setError("");
        }
      })
      .catch((reason: Error) => {
        if (!canceled) setError(reason.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [active, days]);
  function reading(key: string, unit: string): Reading {
    return {
      value: null,
      quality: "unavailable",
      ageSeconds: null,
      unit,
      minimum: null,
      maximum: null,
      history: (data?.observations || [])
        .flatMap((row) => {
          const value =
            key === "cellSpreadMv" ? row.cellSpreadMv : row.signals[key];
          return typeof value === "number" &&
            Number.isFinite(value) &&
            Number.isFinite(row.timestamp)
            ? [[row.timestamp, value]]
            : [];
        })
        .sort((a, b) => a[0] - b[0]),
    };
  }
  const selected = metrics.find((item) => item.key === metric) || metrics[0];
  return (
    <section class="battery-history">
      <div class="battery-trend-controls">
        <ion-segment
          value={metric}
          aria-label="Battery history reading"
          onionChange={(event: CustomEvent) => setMetric(event.detail.value)}
        >
          {metrics.map((item) => (
            <ion-segment-button key={item.key} value={item.key}>
              <ion-label>{item.label}</ion-label>
            </ion-segment-button>
          ))}
        </ion-segment>
        <ion-segment
          value={String(days)}
          aria-label="Battery history period"
          onionChange={(event: CustomEvent) =>
            setDays(Number(event.detail.value))
          }
        >
          {[
            [1, "Day"],
            [7, "Week"],
            [30, "Month"],
            [365, "Year"],
          ].map(([value, label]) => (
            <ion-segment-button value={String(value)} key={value}>
              <ion-label>{label}</ion-label>
            </ion-segment-button>
          ))}
        </ion-segment>
      </div>
      {(error || data?.error) && (
        <p role="status" class="history-message">
          {error || data?.error}
        </p>
      )}
      {loading ? (
        <p class="history-message">Loading history…</p>
      ) : !data?.count && (error || data?.error) ? null : !data?.count ? (
        <p class="history-message">No readings in this period.</p>
      ) : (
        <>
          <section class="history-panel battery-trend">
            <div class="section-heading">
              <h2>
                {metric === "maximumTemperatureC"
                  ? "Highest pack temperature"
                  : selected.label}
              </h2>
              <small>
                {selected.unit === "°C" && units === "imperial"
                  ? "°F"
                  : selected.unit}
              </small>
            </div>
            {active && (
              <Suspense fallback={<p>Loading chart…</p>}>
                <History
                  reading={reading(selected.key, selected.unit)}
                  units={units}
                  dark={dark}
                  label={
                    metric === "maximumTemperatureC"
                      ? "Highest pack temperature"
                      : selected.label
                  }
                  samplesOnly
                  height={135}
                  range={
                    metric === "displayedChargePercent"
                      ? { minimum: 0, maximum: 100 }
                      : undefined
                  }
                />
              </Suspense>
            )}
          </section>
          <details class="history-notes">
            <summary>About these readings</summary>
            <p>
              Dots are recorded readings. Gaps have no readings. Temperature
              shows the highest pack reading.
            </p>
            <p>
              Pack energy varies with charge and temperature. Cell balance alone
              does not measure battery health or cell age.
            </p>
          </details>
        </>
      )}
    </section>
  );
});

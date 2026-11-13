import { useEffect, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { api, type Reading } from "./types";

const History = lazy(() =>
  import("./charts").then((module) => ({ default: module.History })),
);
type Observation = {
  timestamp: number;
  capture: string;
  signals: Record<string, number | null>;
  cellSpreadMv: number | null;
};
type Result = {
  observations: Observation[];
  count: number;
  error: string | null;
};

export function BatteryHistory({
  active,
  units,
  dark,
}: {
  active: boolean;
  units: string;
  dark: boolean;
}) {
  const [days, setDays] = useState(30),
    [data, setData] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!active) return;
    let canceled = false;
    setLoading(true);
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
          return typeof value === "number" ? [[row.timestamp, value]] : [];
        })
        .sort((a, b) => a[0] - b[0]),
    };
  }
  return (
    <section class="battery-history">
      <ion-segment
        value={String(days)}
        aria-label="Battery history period"
        onionChange={(event: CustomEvent) =>
          setDays(Number(event.detail.value))
        }
      >
        {[
          [7, "Week"],
          [30, "Month"],
          [365, "Year"],
        ].map(([value, label]) => (
          <ion-segment-button value={String(value)} key={value}>
            <ion-label>{label}</ion-label>
          </ion-segment-button>
        ))}
      </ion-segment>
      {(error || data?.error) && (
        <p role="status" class="history-message">
          {error || data?.error}
        </p>
      )}
      {loading ? (
        <p class="history-message">Loading history…</p>
      ) : !data?.count ? (
        <p class="history-message">
          History begins with live battery readings.
        </p>
      ) : (
        <>
          <section class="history-panel">
            <div class="section-heading">
              <h2>Full pack energy</h2>
              <small>kWh</small>
            </div>
            {active && (
              <Suspense fallback={<p>Loading chart…</p>}>
                <History
                  reading={reading("fullPackEnergyKwh", "kWh")}
                  units={units}
                  dark={dark}
                  label="Full pack energy"
                  samplesOnly
                  height={150}
                />
              </Suspense>
            )}
          </section>
          <section class="history-panel">
            <div class="section-heading">
              <h2>Cell balance</h2>
              <small>mV</small>
            </div>
            {active && (
              <Suspense fallback={<p>Loading chart…</p>}>
                <History
                  reading={reading("cellSpreadMv", "mV")}
                  units={units}
                  dark={dark}
                  label="Cell balance"
                  samplesOnly
                  height={130}
                />
              </Suspense>
            )}
          </section>
          <details class="history-notes">
            <summary>About these readings</summary>
            <p>
              Recorded every five minutes while battery readings are available.
              Dots are observations, not a continuous trace. Dates follow the
              Pi’s clock.
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
}

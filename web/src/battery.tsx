import { useState } from "preact/hooks";
import { BatteryHistory } from "./battery-history";
import { Metric, Value } from "./dashboard";
import { ChargeLimit } from "./charge-limit";
import { ChargePort } from "./charge-port";
import { readingStatus, usableReading, type Definition, type Snapshot } from "./types";
import type { VehicleControls } from "./vehicle-controls";

export function Battery({
  data,
  units,
  dark,
  active,
  controls,
  catalog,
}: {
  data: Snapshot | null;
  units: string;
  dark: boolean;
  active: boolean;
  controls: VehicleControls;
  catalog: Definition[];
}) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const signals = data?.signals || {};
  const charge = signals.displayedChargePercent;
  const limit = signals.chargeLimitPercent;
  const low = signals.minimumTemperatureC,
    high = signals.maximumTemperatureC;
  const temperatureQuality =
    !usableReading(low) || !usableReading(high)
      ? "unavailable"
      : low.quality === "stale" || high.quality === "stale"
        ? "stale"
        : "fresh";
  const showCharge = charge?.quality === "fresh" && usableReading(charge);
  const showLimit = limit?.quality === "fresh" && usableReading(limit);
  return (
    <main class="battery-page">
      <div class={`battery-charge ${charge?.quality || "unavailable"}`}>
        <div>
          <span>Charge</span>
          <strong>
            <Value reading={charge} units={units} />
          </strong>
          {readingStatus(charge) && <small>{readingStatus(charge)}</small>}
        </div>
        <div class="battery-energy">
          <div class={signals.remainingEnergyKwh?.quality || "unavailable"}>
            <span>
              Remaining
              {signals.remainingEnergyKwh?.quality === "stale" && " · Held"}
            </span>
            <strong>
              <Value reading={signals.remainingEnergyKwh} units={units} />
            </strong>
          </div>
          <div class={signals.fullPackEnergyKwh?.quality || "unavailable"}>
            <span>
              Full pack
              {signals.fullPackEnergyKwh?.quality === "stale" && " · Held"}
            </span>
            <strong>
              <Value reading={signals.fullPackEnergyKwh} units={units} />
            </strong>
          </div>
        </div>
      </div>
      <div class="battery-level">
        <div
          class={`charge-progress ${showCharge ? "" : "unknown"}`}
          role="img"
          aria-label={
            showCharge
              ? `Charge ${charge.value}%`
              : "Charge progress unavailable"
          }
        >
          {showCharge && (
            <span
              style={{ width: `${Math.max(0, Math.min(100, charge.value))}%` }}
            />
          )}
        </div>
        {showLimit && (
          <span
            class="charge-limit-tick"
            style={{ left: `${Math.max(0, Math.min(100, limit.value))}%` }}
            aria-label={`Charge limit ${limit.value}%`}
          />
        )}
        <div class="battery-level-labels">
          <span>0</span>
          <span>{showLimit ? `Limit ${limit.value}%` : "50"}</span>
          <span>100</span>
        </div>
      </div>
      <div class="metric-strip battery-metrics">
        <Metric
          label="Battery power"
          reading={signals.batteryPowerKw}
          units={units}
        />
        <Metric label="Pack voltage" reading={signals.voltageV} units={units} />
        <Metric label="Pack current" reading={signals.currentA} units={units} />
        <div class={`metric ${temperatureQuality}`}>
          <div class="metric-label">Pack temperature</div>
          <div class="metric-value temperature-range">
            {temperatureQuality === "unavailable" ? (
              "—"
            ) : (
              <>
                <Value reading={low} units={units} showUnit={false} />–
                <Value reading={high} units={units} />
              </>
            )}
          </div>
          <div class="quality">
            {temperatureQuality === "fresh"
              ? ""
              : temperatureQuality === "stale"
                ? "Held"
                : "Unavailable"}
          </div>
        </div>
      </div>
      <BatteryHistory active={active} units={units} dark={dark} />
      <details
        class="battery-controls"
        open={controlsOpen}
        onToggle={(event) => setControlsOpen(event.currentTarget.open)}
      >
        <summary>Charging</summary>
        <Metric
          label="Charging power"
          reading={signals.chargingPowerKw}
          units={units}
        />
        <ChargeLimit
          data={data}
          controls={controls}
          active={active && controlsOpen}
        />
        <ChargePort data={data} controls={controls} definition={catalog.find(item => item.key === "chargePortOpen")} />
      </details>
    </main>
  );
}

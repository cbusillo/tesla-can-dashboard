import type { ComponentChildren } from "preact";
import {
  convert,
  displayUnit,
  usableReading,
  readingStatus,
  type Reading,
  type Definition,
} from "./types";

export function Value({
  reading,
  units,
  decimals,
  choices,
  showUnit = true,
}: {
  reading?: Reading;
  units: string;
  decimals?: number;
  choices?: Definition["choices"];
  showUnit?: boolean;
}) {
  if (!usableReading(reading)) return <>—</>;
  if (choices) return <>{choices[String(reading.value)] ?? "—"}</>;
  return (
    <>
      {convert(reading.value, reading.unit, units).toFixed(
        decimals ?? (reading.unit === "V" ? 2 : 1),
      )}
      {showUnit && (
        <small class="reading-unit"> {displayUnit(reading.unit, units)}</small>
      )}
    </>
  );
}

export function Metric({
  label,
  reading,
  units,
  children,
  choices,
}: {
  label: string;
  reading?: Reading;
  units: string;
  children?: ComponentChildren;
  choices?: Definition["choices"];
}) {
  return (
    <div class={`metric ${reading?.quality || "unavailable"}`}>
      <div class="metric-label">
        {label}
        {children}
      </div>
      <div class="metric-value">
        <Value reading={reading} units={units} choices={choices} />
      </div>
      <div class="quality">{readingStatus(reading)}</div>
    </div>
  );
}

export function Page({
  name,
  title,
  status,
  children,
  toggleTheme,
  toolbar,
}: {
  name: string;
  title: string;
  status: string;
  children: ComponentChildren;
  toggleTheme: () => void;
  toolbar?: ComponentChildren;
}) {
  return (
    <ion-tab tab={name}>
      <ion-header class="page-header">
        <div class="identity">
          <h1>{title}</h1>
        </div>
        <div class="header-actions">
          <span class="source-status" role="status">
            {status}
          </span>
          {toolbar}
          <ion-button
            fill="clear"
            onClick={toggleTheme}
            aria-label="Change appearance"
          >
            <ion-icon name="moon-outline" slot="icon-only" />
          </ion-button>
        </div>
      </ion-header>
      <ion-content>{children}</ion-content>
    </ion-tab>
  );
}

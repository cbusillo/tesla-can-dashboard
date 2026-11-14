import type { ComponentChildren } from "preact";
import { display, readingStatus, type Reading, type Definition } from "./types";

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
      <div class="metric-value">{display(reading, units, undefined, choices)}</div>
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
          <span class="mark" aria-hidden="true">
            ╱╱
          </span>
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

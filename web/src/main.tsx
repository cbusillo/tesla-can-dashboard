import { render, type ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { initialize } from "@ionic/core/components";
import { addIcons } from "ionicons";
import {
  batteryHalfOutline,
  thermometerOutline,
  gridOutline,
  settingsOutline,
  moonOutline,
  documentTextOutline,
  speedometerOutline,
  addOutline,
  optionsOutline,
} from "ionicons/icons";
import "@ionic/core/css/core.css";
import "@ionic/core/css/normalize.css";
import "@ionic/core/css/structure.css";
import "@ionic/core/css/typography.css";
import "@ionic/core/css/padding.css";
import "@ionic/core/css/palettes/dark.class.css";
import { defineComponents } from "./ionic";
import { lazy, Suspense } from "preact/compat";
const Dial = lazy(() =>
  import("./charts").then((module) => ({ default: module.Dial })),
);
const History = lazy(() =>
  import("./charts").then((module) => ({ default: module.History })),
);
const CellChart = lazy(() =>
  import("./charts").then((module) => ({ default: module.CellChart })),
);
import {
  api,
  convert,
  toCanonical,
  display,
  displayUnit,
  initialLayout,
  holdSnapshot,
  readingStatus,
  sourceStatus,
  type Definition,
  type Layout,
  type Reading,
  type Snapshot,
} from "./types";
import "./style.css";
initialize({ mode: "ios", animated: false });
addIcons({
  batteryHalfOutline,
  thermometerOutline,
  gridOutline,
  settingsOutline,
  moonOutline,
  documentTextOutline,
  speedometerOutline,
  addOutline,
  optionsOutline,
});
defineComponents();

function useDashboard() {
  const [data, setData] = useState<Snapshot | null>(null),
    [catalog, setCatalog] = useState<Definition[]>([]),
    [layout, setLayout] = useState(initialLayout),
    [offline, setOffline] = useState(false),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const revision = useRef<string | null>(null);
  const lastKnown = useRef<{ snapshot: Snapshot; receivedAt: number } | null>(
    null,
  );
  function acceptSnapshot(snapshot: Snapshot) {
    lastKnown.current = { snapshot, receivedAt: performance.now() };
    setData(snapshot);
  }
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    let updates = 0;
    const timings: number[] = [];
    let metadataLoaded = false,
      metadataLoading = false;
    function loadMetadata() {
      if (metadataLoaded || metadataLoading) return;
      metadataLoading = true;
      Promise.all([
        api<{ signals: Definition[] }>("catalog"),
        api<Layout>("layout"),
      ])
        .then(([c, l]) => {
          if (alive) {
            setCatalog(c.signals);
            setLayout({ ...initialLayout, ...l });
            setReady(true);
            metadataLoaded = true;
          }
        })
        .catch(() => {})
        .finally(() => {
          metadataLoading = false;
        });
    }
    loadMetadata();
    async function poll() {
      try {
        const started = performance.now(),
          next = await api<Snapshot>("snapshot");
        if (!alive) return;
        if (revision.current && revision.current !== next.reloadRevision) {
          location.reload();
          return;
        }
        revision.current = next.reloadRevision;
        acceptSnapshot(next);
        setOffline(false);
        loadMetadata();
        updates++;
        timings.push(performance.now() - started);
        if (timings.length > 20) timings.shift();
        if (updates === 10 || updates % 120 === 0)
          api("browser-check", "POST", {
            browser: navigator.userAgent,
            updates,
            requestTimesMs: timings,
            visibility: document.visibilityState,
            width: innerWidth,
            height: innerHeight,
          }).catch(() => {});
      } catch {
        if (alive) {
          setOffline(true);
          const last = lastKnown.current;
          if (last)
            setData(
              holdSnapshot(
                last.snapshot,
                (performance.now() - last.receivedAt) / 1000,
              ),
            );
        }
      }
      if (alive) timer = setTimeout(poll, document.hidden ? 2000 : 500);
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  async function act(path: string, method = "POST", body?: unknown) {
    setBusy(true);
    try {
      await api(path, method, body);
      acceptSnapshot(await api<Snapshot>("snapshot"));
      setActionError("");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(next: Layout) {
    if (!ready) return false;
    setBusy(true);
    try {
      const saved = await api<Layout>("layout", "PUT", next);
      setLayout(saved);
      setActionError("");
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    data,
    catalog,
    layout,
    offline,
    actionError,
    setActionError,
    busy: busy || !ready,
    act,
    save,
  };
}
function Row({
  label,
  reading,
  units,
  icon,
  decimals,
}: {
  label: string;
  reading: Reading | undefined;
  units: string;
  icon?: string;
  decimals?: number;
}) {
  return (
    <ion-item>
      {icon && <ion-icon slot="start" name={icon} color="primary" />}
      <ion-label>
        {label}
        {readingStatus(reading) && <p>{readingStatus(reading)}</p>}
      </ion-label>
      <ion-note
        slot="end"
        color={reading?.quality === "fresh" ? "dark" : "medium"}
      >
        {display(reading, units, decimals)}
      </ion-note>
    </ion-item>
  );
}
function Page({
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
      <ion-header>
        <ion-toolbar>
          <ion-title>{title}</ion-title>
          <ion-buttons slot="end">
            {toolbar}
            <ion-button onClick={toggleTheme} aria-label="Change appearance">
              <ion-icon name="moon-outline" slot="icon-only" />
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
        <div class="connection-note">
          <ion-note>{status}</ion-note>
        </div>
      </ion-header>
      <ion-content color="light">{children}</ion-content>
    </ion-tab>
  );
}
function App() {
  const {
    data,
    catalog,
    layout,
    offline,
    actionError,
    setActionError,
    busy,
    act,
    save,
  } = useDashboard();
  const [tab, setTab] = useState("battery"),
    [selectedCell, setSelectedCell] = useState<number | null>(null),
    [editKey, setEditKey] = useState<string | null>(null),
    [rangeMin, setRangeMin] = useState(""),
    [rangeMax, setRangeMax] = useState(""),
    [rangeAuto, setRangeAuto] = useState(true),
    [formError, setFormError] = useState(""),
    [chooseOpen, setChooseOpen] = useState(false),
    [deviceDark, setDeviceDark] = useState(
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
  const tabs = useRef<HTMLIonTabsElement>(null);
  const dark =
    layout.theme === "night" || (layout.theme === "auto" && deviceDark);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const changed = (event: MediaQueryListEvent) =>
      setDeviceDark(event.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("ion-palette-dark", dark);
  }, [dark]);
  const replay = data?.mode === "replay",
    demo = data?.replay?.source === "demonstration";
  const status = sourceStatus(data, offline);
  const theme = () => save({ ...layout, theme: dark ? "day" : "night" });
  const navigate = (name: string) => {
    tabs.current?.select(name);
  };
  const signals = data?.signals || {},
    cells = data?.cellGroups || [],
    fresh = cells.filter((c) => c.quality === "fresh" && c.value !== null),
    cell = cells.find((c) => c.index === selectedCell);
  const spread =
    data?.cellSpreadMv === null || data?.cellSpreadMv === undefined
      ? "—"
      : data.cellSpreadMv.toFixed(1) + " mV";
  function openRange(key: string) {
    const definition = catalog.find((c) => c.key === key);
    if (!definition) return;
    const range = layout.ranges[key];
    setRangeAuto(!range);
    setRangeMin(
      String(
        convert(
          range?.minimum ?? definition.minimum,
          definition.unit,
          layout.units,
        ),
      ),
    );
    setRangeMax(
      String(
        convert(
          range?.maximum ?? definition.maximum,
          definition.unit,
          layout.units,
        ),
      ),
    );
    setFormError("");
    setEditKey(key);
  }
  async function saveRange() {
    const definition = catalog.find((c) => c.key === editKey);
    if (!definition) return;
    const ranges = { ...layout.ranges };
    if (rangeAuto) delete ranges[definition.key];
    else {
      const lo = Number(rangeMin),
        hi = Number(rangeMax);
      if (
        rangeMin.trim() === "" ||
        rangeMax.trim() === "" ||
        !Number.isFinite(lo) ||
        !Number.isFinite(hi) ||
        lo >= hi
      ) {
        setFormError("Minimum must be less than maximum.");
        return;
      }
      ranges[definition.key] = {
        minimum: toCanonical(lo, definition.unit, layout.units),
        maximum: toCanonical(hi, definition.unit, layout.units),
      };
    }
    if (await save({ ...layout, ranges })) setEditKey(null);
  }
  const common = { status, toggleTheme: theme };
  const rangeUnit = displayUnit(
    catalog.find((d) => d.key === editKey)?.unit || "",
    layout.units,
  );
  return (
    <ion-app>
      <ion-text color="dark" id="chart-text" hidden />
      <ion-note color="primary" id="chart-primary" hidden />
      <ion-note color="medium" id="chart-muted" hidden />
      <ion-note color="light" id="chart-track" hidden />
      <ion-note color="tertiary" id="chart-accent" hidden />
      {(actionError || data?.replay?.error) && (
        <div class="message" role="alert">
          {actionError || data?.replay?.error}
          {actionError && (
            <ion-button
              fill="clear"
              size="small"
              onClick={() => setActionError("")}
            >
              Dismiss
            </ion-button>
          )}
        </div>
      )}
      <ion-tabs
        ref={tabs}
        onionTabsDidChange={(event) => setTab(event.detail.tab)}
      >
        <Page name="battery" title="Battery" {...common}>
          <ion-grid fixed>
            <ion-row>
              <ion-col size="12" size-md="6">
                <ion-list-header>
                  <ion-label>Charge</ion-label>
                </ion-list-header>
                <ion-list inset>
                  <Row
                    label="State of charge"
                    reading={signals.displayedChargePercent}
                    units={layout.units}
                    icon="battery-half-outline"
                  />
                  {signals.displayedChargePercent?.quality === "fresh" && (
                    <ion-item lines="none">
                      <ion-progress-bar
                        color="success"
                        value={
                          (signals.displayedChargePercent.value ?? 0) / 100
                        }
                      />
                    </ion-item>
                  )}
                  <Row
                    label="Remaining energy"
                    reading={signals.remainingEnergyKwh}
                    units={layout.units}
                  />
                  <Row
                    label="Full pack energy"
                    reading={signals.fullPackEnergyKwh}
                    units={layout.units}
                  />
                </ion-list>
                <ion-list-header>
                  <ion-label>Electrical</ion-label>
                </ion-list-header>
                <ion-list inset>
                  <Row
                    label="Pack voltage"
                    reading={signals.voltageV}
                    units={layout.units}
                  />
                  <Row
                    label="Pack current"
                    reading={signals.currentA}
                    units={layout.units}
                  />
                </ion-list>
              </ion-col>
              <ion-col size="12" size-md="6">
                <ion-list-header>
                  <ion-label>Temperature</ion-label>
                </ion-list-header>
                <ion-list inset>
                  <Row
                    label="Lowest"
                    reading={signals.minimumTemperatureC}
                    units={layout.units}
                    icon="thermometer-outline"
                  />
                  <Row
                    label="Highest"
                    reading={signals.maximumTemperatureC}
                    units={layout.units}
                  />
                </ion-list>
                <ion-list-header>
                  <ion-label>Cell groups</ion-label>
                </ion-list-header>
                <ion-list inset>
                  <ion-item button detail onClick={() => navigate("cells")}>
                    <ion-icon
                      slot="start"
                      name="grid-outline"
                      color="primary"
                    />
                    <ion-label>
                      <h2>Voltage balance</h2>
                      <p>
                        {data?.freshCellCount || 0} / {cells.length || "—"}{" "}
                        groups fresh
                      </p>
                    </ion-label>
                    <ion-note slot="end" color="dark">
                      {spread}
                    </ion-note>
                  </ion-item>
                  <ion-item
                    button
                    detail
                    onClick={() => navigate("instruments")}
                  >
                    <ion-icon
                      slot="start"
                      name="speedometer-outline"
                      color="primary"
                    />
                    <ion-label>Dials and history</ion-label>
                  </ion-item>
                </ion-list>
                <ion-list-header>
                  <ion-label>Charging</ion-label>
                </ion-list-header>
                <ion-list inset>
                  <Row
                    label="Charging power"
                    reading={signals.chargingPowerKw}
                    units={layout.units}
                  />
                  <Row
                    label="Charge limit"
                    reading={signals.chargeLimitPercent}
                    units={layout.units}
                  />
                </ion-list>
              </ion-col>
            </ion-row>
          </ion-grid>
        </Page>
        <Page
          name="instruments"
          title="Instruments"
          {...common}
          toolbar={
            <ion-button
              onClick={() => setChooseOpen(true)}
              aria-label="Choose instruments"
            >
              <ion-icon slot="icon-only" name="add-outline" />
            </ion-button>
          }
        >
          <ion-toolbar>
            <ion-segment
              value={layout.presentation}
              onionChange={(event) =>
                save({
                  ...layout,
                  presentation: event.detail.value as Layout["presentation"],
                })
              }
            >
              <ion-segment-button value="dials">
                <ion-label>Dials</ion-label>
              </ion-segment-button>
              <ion-segment-button value="readings">
                <ion-label>Readings</ion-label>
              </ion-segment-button>
              <ion-segment-button value="history">
                <ion-label>History</ion-label>
              </ion-segment-button>
            </ion-segment>
          </ion-toolbar>
          {!layout.instruments.length && (
            <div class="ion-padding">
              <p>Choose the signals you want to watch.</p>
              <ion-button onClick={() => setChooseOpen(true)}>
                Choose instruments
              </ion-button>
            </div>
          )}
          <ion-grid fixed>
            <ion-row>
              {layout.instruments.map((key) => {
                const definition = catalog.find((c) => c.key === key),
                  reading = signals[key],
                  valid =
                    reading?.value !== null &&
                    reading?.value !== undefined &&
                    reading.quality !== "invalid",
                  range = layout.ranges[key] || {
                    minimum: definition?.minimum ?? 0,
                    maximum: definition?.maximum ?? 100,
                  };
                return (
                  <ion-col
                    size="12"
                    size-sm="6"
                    size-md={layout.presentation === "history" ? "6" : "4"}
                    key={key}
                  >
                    <ion-card>
                      <ion-card-header>
                        <div class="instrument-heading">
                          <ion-card-title>
                            {definition?.label || key}
                          </ion-card-title>
                          <ion-button
                            fill="clear"
                            size="small"
                            onClick={() => openRange(key)}
                            aria-label={
                              "Configure " + (definition?.label || key)
                            }
                          >
                            <ion-icon name="options-outline" slot="icon-only" />
                          </ion-button>
                        </div>
                      </ion-card-header>
                      <ion-card-content>
                        {layout.presentation === "dials" &&
                        valid &&
                        tab === "instruments" ? (
                          <Suspense
                            fallback={<ion-note>Loading dial…</ion-note>}
                          >
                            <Dial
                              reading={reading}
                              range={range}
                              units={layout.units}
                              dark={dark}
                              label={definition?.label || key}
                            />
                          </Suspense>
                        ) : (
                          <div
                            class={
                              "reading " + (reading?.quality || "unavailable")
                            }
                          >
                            {display(reading, layout.units)}
                          </div>
                        )}
                        {layout.presentation === "history" &&
                          tab === "instruments" && (
                            <Suspense
                              fallback={<ion-note>Loading history…</ion-note>}
                            >
                              <History
                                reading={reading}
                                units={layout.units}
                                dark={dark}
                                label={definition?.label || key}
                                staleAfter={definition?.stale_after}
                              />
                            </Suspense>
                          )}
                        {readingStatus(reading) && (
                          <p class="quality">{readingStatus(reading)}</p>
                        )}
                      </ion-card-content>
                    </ion-card>
                  </ion-col>
                );
              })}
            </ion-row>
          </ion-grid>
        </Page>
        <Page name="cells" title="Cell groups" {...common}>
          <ion-list-header>
            <ion-label>Voltage balance</ion-label>
          </ion-list-header>
          <ion-list inset>
            <ion-item>
              <ion-label>Spread across all groups</ion-label>
              <ion-note slot="end" color="dark">
                {spread}
              </ion-note>
            </ion-item>
            <ion-item>
              <ion-label>Fresh groups</ion-label>
              <ion-note slot="end" color="dark">
                {data?.freshCellCount || 0} / {cells.length || "—"}
              </ion-note>
            </ion-item>
            {fresh.length > 0 && (
              <>
                <ion-item>
                  <ion-label>Lowest fresh group</ion-label>
                  <ion-note slot="end" color="dark">
                    {Math.min(...fresh.map((c) => c.value!)).toFixed(4)} V
                  </ion-note>
                </ion-item>
                <ion-item>
                  <ion-label>Highest fresh group</ion-label>
                  <ion-note slot="end" color="dark">
                    {Math.max(...fresh.map((c) => c.value!)).toFixed(4)} V
                  </ion-note>
                </ion-item>
              </>
            )}
          </ion-list>
          {fresh.length > 0 && tab === "cells" && (
            <ion-card>
              <ion-card-content>
                <Suspense fallback={<ion-note>Loading cell chart…</ion-note>}>
                  <CellChart
                    cells={cells}
                    selected={selectedCell}
                    onSelect={setSelectedCell}
                    dark={dark}
                  />
                </Suspense>
              </ion-card-content>
            </ion-card>
          )}
          {cell && (
            <ion-list inset>
              <ion-item>
                <ion-label>
                  <h2>Group {cell.index}</h2>
                  {readingStatus(cell) && <p>{readingStatus(cell)}</p>}
                </ion-label>
                <ion-note slot="end" color="dark">
                  {display(cell, "metric", 4)}
                </ion-note>
              </ion-item>
            </ion-list>
          )}
          <ion-list-header>
            <ion-label>All measured groups</ion-label>
          </ion-list-header>
          <ion-list inset class="cell-list">
            {cells.map((c) => (
              <ion-item
                button
                color={selectedCell === c.index ? "primary" : undefined}
                key={c.index}
                onClick={() => setSelectedCell(c.index)}
              >
                <ion-label>
                  Group {c.index}
                  {readingStatus(c) && <p>{readingStatus(c)}</p>}
                  {selectedCell === c.index &&
                    c.minimum !== null &&
                    c.maximum !== null && (
                      <p>
                        Observed {c.minimum.toFixed(4)}–{c.maximum.toFixed(4)} V
                      </p>
                    )}
                </ion-label>
                <ion-note
                  slot="end"
                  color={c.quality === "fresh" ? "dark" : "medium"}
                >
                  {display(c, "metric", 4)}
                </ion-note>
              </ion-item>
            ))}
          </ion-list>
        </Page>
        <Page name="sessions" title="Sessions" {...common}>
          <ion-list-header>
            <ion-label>Recording</ion-label>
          </ion-list-header>
          <ion-list inset>
            <ion-item>
              <ion-label>
                <h2>
                  {data?.recording.activeId
                    ? "Recording live telemetry"
                    : "Record a drive or charge"}
                </h2>
              </ion-label>
              <ion-button
                slot="end"
                disabled={busy || (!data?.recording.activeId && demo)}
                onClick={() =>
                  act(
                    data?.recording.activeId
                      ? "recordings/stop"
                      : "recordings/start",
                  )
                }
              >
                {data?.recording.activeId ? "Stop" : "Record"}
              </ion-button>
            </ion-item>
          </ion-list>
          {data?.recording.error && (
            <p class="ion-padding-horizontal" role="alert">
              {data.recording.error}
            </p>
          )}
          {replay && !demo && (
            <ion-list inset>
              <ion-item>
                <ion-label>Replay {data?.replay?.state}</ion-label>
                <ion-button
                  slot="end"
                  disabled={busy}
                  onClick={() => act("replay", "POST", { session_id: null })}
                >
                  Return to live
                </ion-button>
              </ion-item>
            </ion-list>
          )}
          <ion-list-header>
            <ion-label>Saved sessions</ion-label>
          </ion-list-header>
          <ion-list inset>
            {data?.recording.sessions.map((s) => (
              <ion-item key={s.id}>
                <ion-label>
                  <h2>{new Date(s.modifiedAt * 1000).toLocaleString()}</h2>
                  <p>
                    {(s.sizeBytes / 1024).toFixed(0)} KB
                    {s.id === data.recording.activeId ? " · recording" : ""}
                  </p>
                </ion-label>
                <ion-button
                  fill="clear"
                  href={"/api/recordings/" + s.id}
                  download=""
                >
                  Export
                </ion-button>
                <ion-button
                  fill="clear"
                  disabled={busy || s.id === data.recording.activeId}
                  onClick={() =>
                    act("replay", "POST", { session_id: s.id, rate: 1 })
                  }
                >
                  Replay
                </ion-button>
                <ion-button
                  fill="clear"
                  color="danger"
                  disabled={busy || s.id === data.recording.activeId}
                  onClick={() => {
                    if (
                      confirm(
                        "Remove this saved session? Export it first if you want to keep it.",
                      )
                    )
                      act("recordings/" + s.id, "DELETE");
                  }}
                >
                  Remove
                </ion-button>
              </ion-item>
            ))}
          </ion-list>
          {!data?.recording.sessions.length && (
            <p class="ion-padding">No recordings</p>
          )}
        </Page>
        <Page name="settings" title="Settings" {...common}>
          <ion-list-header>
            <ion-label>Display</ion-label>
          </ion-list-header>
          <ion-list inset>
            <ion-item>
              <ion-select
                label="Appearance"
                value={layout.theme}
                interface="popover"
                onionChange={(e) => save({ ...layout, theme: e.detail.value })}
              >
                <ion-select-option value="auto">System</ion-select-option>
                <ion-select-option value="day">Day</ion-select-option>
                <ion-select-option value="night">Night</ion-select-option>
              </ion-select>
            </ion-item>
            <ion-item>
              <ion-select
                label="Units"
                value={layout.units}
                interface="popover"
                onionChange={(e) => save({ ...layout, units: e.detail.value })}
              >
                <ion-select-option value="metric">Metric</ion-select-option>
                <ion-select-option value="imperial">US</ion-select-option>
              </ion-select>
            </ion-item>
            <ion-item button detail onClick={() => setChooseOpen(true)}>
              <ion-label>Choose instruments</ion-label>
            </ion-item>
          </ion-list>
        </Page>
        <ion-tab-bar slot="bottom">
          {[
            ["battery", "Battery", "battery-half-outline"],
            ["instruments", "Instruments", "speedometer-outline"],
            ["cells", "Cells", "grid-outline"],
            ["sessions", "Sessions", "document-text-outline"],
            ["settings", "Settings", "settings-outline"],
          ].map(([key, label, icon]) => (
            <ion-tab-button tab={key}>
              <ion-icon name={icon} />
              <ion-label>{label}</ion-label>
            </ion-tab-button>
          ))}
        </ion-tab-bar>
      </ion-tabs>
      <ion-modal
        isOpen={chooseOpen}
        onionModalDidDismiss={() => setChooseOpen(false)}
      >
        <ion-header>
          <ion-toolbar>
            <ion-title>Instruments</ion-title>
            <ion-buttons slot="end">
              <ion-button onClick={() => setChooseOpen(false)}>Done</ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content color="light">
          <ion-list inset>
            {catalog.map((d) => (
              <ion-item key={d.key}>
                <ion-checkbox
                  disabled={busy}
                  checked={layout.instruments.includes(d.key)}
                  onionChange={(e) =>
                    save({
                      ...layout,
                      instruments: e.detail.checked
                        ? [...layout.instruments, d.key]
                        : layout.instruments.filter((key) => key !== d.key),
                    })
                  }
                >
                  {d.label}
                </ion-checkbox>
              </ion-item>
            ))}
          </ion-list>
        </ion-content>
      </ion-modal>
      <ion-modal
        isOpen={editKey !== null}
        onionModalDidDismiss={() => setEditKey(null)}
      >
        <ion-header>
          <ion-toolbar>
            <ion-title>
              {catalog.find((d) => d.key === editKey)?.label || "Dial limits"}
            </ion-title>
            <ion-buttons slot="end">
              <ion-button onClick={() => setEditKey(null)}>Cancel</ion-button>
              <ion-button disabled={busy} onClick={saveRange}>
                Save
              </ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content color="light">
          <ion-list inset>
            <ion-item>
              <ion-toggle
                checked={rangeAuto}
                onionChange={(e) => setRangeAuto(e.detail.checked)}
              >
                Use default dial range
              </ion-toggle>
            </ion-item>
            {!rangeAuto && (
              <>
                <ion-item>
                  <ion-input
                    label={`Minimum (${rangeUnit})`}
                    type="number"
                    value={rangeMin}
                    onionInput={(e) => setRangeMin(e.detail.value || "")}
                  />
                </ion-item>
                <ion-item>
                  <ion-input
                    label={`Maximum (${rangeUnit})`}
                    type="number"
                    value={rangeMax}
                    onionInput={(e) => setRangeMax(e.detail.value || "")}
                  />
                </ion-item>
              </>
            )}
          </ion-list>
          {formError && (
            <p class="ion-padding" role="alert">
              {formError}
            </p>
          )}
        </ion-content>
      </ion-modal>
    </ion-app>
  );
}
render(<App />, document.getElementById("app")!);

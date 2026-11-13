import { render } from "preact";
import { BatteryHistory } from "./battery-history";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { initialize } from "@ionic/core/components";
import { addIcons } from "ionicons";
import {
  batteryHalfOutline,
  gridOutline,
  settingsOutline,
  moonOutline,
  documentTextOutline,
  speedometerOutline,
  optionsOutline,
  flashOutline,
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
  type Snapshot,
} from "./types";
import { Metric, Page } from "./dashboard";
import { SessionAnalysis } from "./session-analysis";
import "./style.css";
initialize({ mode: "ios", animated: false });
addIcons({
  batteryHalfOutline,
  gridOutline,
  settingsOutline,
  moonOutline,
  documentTextOutline,
  speedometerOutline,
  optionsOutline,
  flashOutline,
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
  const [tab, setTab] = useState("instruments"),
    [batteryHistory, setBatteryHistory] = useState(false),
    [editing, setEditing] = useState(false),
    [selectedCell, setSelectedCell] = useState<number | null>(1),
    [editKey, setEditKey] = useState<string | null>(null),
    [rangeMin, setRangeMin] = useState(""),
    [rangeMax, setRangeMax] = useState(""),
    [rangeAuto, setRangeAuto] = useState(true),
    [formError, setFormError] = useState(""),
    [chooseOpen, setChooseOpen] = useState(false),
    [deviceDark, setDeviceDark] = useState(
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
  const historyKey = layout.historyInstrument;
  const displayedInstruments = layout.instruments.filter((key) =>
    catalog.some((definition) => definition.key === key),
  );
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
    document.documentElement.dataset.theme = dark ? "night" : "day";
  }, [dark]);
  const replay = data?.mode === "replay",
    demo = data?.replay?.source === "demonstration";
  const status = sourceStatus(data, offline);
  const theme = () => save({ ...layout, theme: dark ? "day" : "night" });
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
  const historyDefinition = catalog.find((d) => d.key === historyKey);
  const instrumentLabel = (key: string) =>
    catalog.find((definition) => definition.key === key)?.label || "Instrument";
  function closeEditing() {
    setEditing(false);
    setChooseOpen(false);
    setEditKey(null);
  }
  function instrument(key: string, dial = false) {
    const definition = catalog.find((d) => d.key === key),
      reading = signals[key];
    const label = instrumentLabel(key);
    return (
      <section
        class={`instrument ${reading?.quality || "unavailable"}`}
        key={key}
      >
        <div class="instrument-heading">
          <h2>{label}</h2>
          {editing && (
            <ion-button
              fill="clear"
              onClick={() => openRange(key)}
              aria-label={`Configure ${label}`}
            >
              <ion-icon name="options-outline" slot="icon-only" />
            </ion-button>
          )}
        </div>
        {dial ? (
          <Suspense fallback={<div class="chart-loading">Loading dial…</div>}>
            <Dial
              reading={reading}
              unit={definition?.unit || ""}
              range={
                layout.ranges[key] || {
                  minimum: definition?.minimum ?? 0,
                  maximum: definition?.maximum ?? 100,
                }
              }
              units={layout.units}
              dark={dark}
              label={label}
            />
          </Suspense>
        ) : (
          <div class="reading">{display(reading, layout.units)}</div>
        )}
        <div class="quality">{readingStatus(reading)}</div>
        {layout.presentation === "history" && (
          <Suspense fallback={<p>Loading history…</p>}>
            <History
              reading={reading}
              units={layout.units}
              dark={dark}
              label={label}
              staleAfter={definition?.stale_after}
            />
          </Suspense>
        )}
      </section>
    );
  }
  const charge = signals.displayedChargePercent;
  const showCharge = charge?.quality === "fresh" && charge.value !== null;
  return (
    <ion-app>
      <span id="chart-text" hidden />
      <span id="chart-primary" hidden />
      <span id="chart-muted" hidden />
      <span id="chart-track" hidden />
      <span id="chart-accent" hidden />
      {(actionError || data?.replay?.error) && (
        <div class="message" role="alert">
          {actionError || data?.replay?.error}
          {actionError && (
            <ion-button fill="clear" onClick={() => setActionError("")}>
              Dismiss
            </ion-button>
          )}
        </div>
      )}
      <ion-tabs
        onionTabsDidChange={(event) => {
          setTab(event.detail.tab);
          closeEditing();
        }}
      >
        <Page
          name="instruments"
          title="Overview"
          {...common}
          toolbar={
            <ion-button
              class="edit-toggle"
              fill="clear"
              onClick={() => {
                if (editing) closeEditing();
                else setEditing(true);
              }}
            >
              {editing ? "Done" : "Edit"}
            </ion-button>
          }
        >
          <main class="overview">
            {!catalog.length && <p role="status">Loading instruments…</p>}
            <div class="charge-context">
              <div class="charge-level">
                <ion-icon name="battery-half-outline" aria-hidden="true" />
                <span>Charge</span>
                <strong>{display(charge, layout.units)}</strong>
                {readingStatus(charge) && (
                  <small>{readingStatus(charge)}</small>
                )}
              </div>
              {editing && (
                <div class="instrument-tools">
                  {layout.instruments.length > 0 && (
                    <ion-button
                      fill="clear"
                      onClick={() => setChooseOpen(true)}
                    >
                      Choose instruments
                    </ion-button>
                  )}
                  <label class="compact-select">
                    <span class="sr-only">Instrument display</span>
                    <select
                      aria-label="Instrument display"
                      value={layout.presentation}
                      disabled={busy}
                      onChange={(e) =>
                        save({
                          ...layout,
                          presentation: e.currentTarget
                            .value as Layout["presentation"],
                        })
                      }
                    >
                      <option value="dials">Dials</option>
                      <option value="readings">Readings</option>
                      <option value="history">History</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
            {!layout.instruments.length && (
              <div class="empty">
                <p>Add an instrument.</p>
                <ion-button onClick={() => setChooseOpen(true)}>
                  Choose instruments
                </ion-button>
              </div>
            )}
            {tab === "instruments" &&
              (layout.presentation === "dials" ? (
                <>
                  <div class="cluster">
                    {displayedInstruments
                      .slice(0, 2)
                      .map((key) => instrument(key, true))}
                  </div>
                  {!!displayedInstruments.slice(2).length && (
                    <div class="metric-strip selected-metrics">
                      {displayedInstruments.slice(2).map((key) => (
                        <Metric
                          key={key}
                          label={instrumentLabel(key)}
                          reading={signals[key]}
                          units={layout.units}
                        >
                          {editing && (
                            <ion-button
                              fill="clear"
                              onClick={() => openRange(key)}
                              aria-label={`Configure ${instrumentLabel(key)}`}
                            >
                              <ion-icon
                                name="options-outline"
                                slot="icon-only"
                              />
                            </ion-button>
                          )}
                        </Metric>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div class="instrument-grid">
                  {displayedInstruments.map((key) => instrument(key))}
                </div>
              ))}
            {layout.presentation !== "history" && (
              <section class="history-panel">
                <div class="section-heading">
                  <h2>
                    {historyDefinition
                      ? `${historyDefinition.label} history`
                      : "Recent history"}
                  </h2>
                  {!editing && historyDefinition && (
                    <small>
                      {displayUnit(historyDefinition.unit, layout.units)}
                      {historyKey === "currentA" &&
                      (data?.currentDirection ?? "unqualified") ===
                        "unqualified"
                        ? " · direction unverified"
                        : ""}
                    </small>
                  )}
                  {editing && (
                    <label class="compact-select">
                      <span class="sr-only">History instrument</span>
                      <select
                        aria-label="History instrument"
                        value={historyKey}
                        disabled={busy}
                        onChange={(e) =>
                          save({
                            ...layout,
                            historyInstrument: e.currentTarget.value,
                          })
                        }
                      >
                        {catalog.map((d) => (
                          <option value={d.key} key={d.key}>
                            {d.label} ({displayUnit(d.unit, layout.units)})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {tab === "instruments" && historyDefinition && (
                  <Suspense fallback={<p>Loading history…</p>}>
                    <History
                      reading={signals[historyKey]}
                      units={layout.units}
                      dark={dark}
                      label={instrumentLabel(historyKey)}
                      staleAfter={historyDefinition?.stale_after}
                      height={80}
                    />
                  </Suspense>
                )}
              </section>
            )}
          </main>
        </Page>
        <Page name="cells" title="Battery / Cells" {...common}>
          <main class="cells-page">
            <div class="screen-heading">
              <div>
                <h2>Cell voltage</h2>
                <p>
                  {data?.freshCellCount ?? 0} / {cells.length || "—"} groups
                  fresh
                </p>
              </div>
              <div class="cells-summary">
                <div>
                  <small>Spread · all groups</small>
                  <strong>{spread}</strong>
                </div>
                <div>
                  <small>Lowest / highest fresh</small>
                  <strong>
                    {fresh.length
                      ? `${Math.min(...fresh.map((c) => c.value!)).toFixed(3)} / ${Math.max(...fresh.map((c) => c.value!)).toFixed(3)} V`
                      : "—"}
                  </strong>
                </div>
              </div>
            </div>
            {tab === "cells" && (
              <Suspense fallback={<p>Loading cell chart…</p>}>
                <CellChart
                  cells={cells}
                  selected={selectedCell}
                  onSelect={setSelectedCell}
                  dark={dark}
                />
              </Suspense>
            )}
            <div class="cell-workbench">
              <div
                class="cell-grid"
                role="group"
                aria-label="Select cell group"
              >
                {cells.map((c) => (
                  <button
                    key={c.index}
                    class={`${c.index === selectedCell ? "selected " : ""}${c.quality}`}
                    aria-label={`Group ${c.index}: ${display(c, "metric", 4)}, ${readingStatus(c) || "Fresh"}`}
                    title={`Group ${c.index}: ${display(c, "metric", 4)}, ${readingStatus(c) || "Fresh"}`}
                    aria-pressed={c.index === selectedCell}
                    onClick={() => setSelectedCell(c.index)}
                  >
                    {String(c.index).padStart(2, "0")}
                  </button>
                ))}
              </div>
              <aside
                class={`cell-detail ${cell?.quality || "unavailable"}`}
                aria-live="polite"
              >
                <label class="group-choice">
                  Group{" "}
                  <select
                    aria-label="Selected cell group"
                    value={selectedCell || ""}
                    onChange={(e) =>
                      setSelectedCell(Number(e.currentTarget.value))
                    }
                  >
                    {cells.map((c) => (
                      <option value={c.index} key={c.index}>
                        {c.index}
                      </option>
                    ))}
                  </select>
                </label>
                <div class="selected-voltage">{display(cell, "metric", 4)}</div>
                <p class="quality">{readingStatus(cell) || "Fresh"}</p>
                <div class="detail-row">
                  <span>Observed low</span>
                  <strong>
                    {cell?.minimum == null
                      ? "—"
                      : cell.minimum.toFixed(4) + " V"}
                  </strong>
                </div>
                <div class="detail-row">
                  <span>Observed high</span>
                  <strong>
                    {cell?.maximum == null
                      ? "—"
                      : cell.maximum.toFixed(4) + " V"}
                  </strong>
                </div>
                <div class="stepper">
                  <button
                    aria-label="Previous cell group"
                    disabled={!cell || cells[0]?.index === cell.index}
                    onClick={() =>
                      setSelectedCell(
                        cells[
                          cells.findIndex((c) => c.index === selectedCell) - 1
                        ]?.index ?? null,
                      )
                    }
                  >
                    ‹
                  </button>
                  <button
                    aria-label="Next cell group"
                    disabled={
                      !cell || cells[cells.length - 1]?.index === cell.index
                    }
                    onClick={() =>
                      setSelectedCell(
                        cells[
                          cells.findIndex((c) => c.index === selectedCell) + 1
                        ]?.index ?? null,
                      )
                    }
                  >
                    ›
                  </button>
                </div>
              </aside>
            </div>
          </main>
        </Page>
        <Page name="charging" title="Charging" {...common}>
          <main class="charging-page">
            <ion-segment
              value={batteryHistory ? "history" : "now"}
              aria-label="Battery view"
              onionChange={(event: CustomEvent) =>
                setBatteryHistory(event.detail.value === "history")
              }
            >
              <ion-segment-button value="now">
                <ion-label>Now</ion-label>
              </ion-segment-button>
              <ion-segment-button value="history">
                <ion-label>History</ion-label>
              </ion-segment-button>
            </ion-segment>
            <div hidden={batteryHistory}>
              <div class="screen-heading">
                <div>
                  <h2>Battery charge</h2>
                </div>
                <div
                  class={`charging-level ${charge?.quality || "unavailable"}`}
                >
                  <strong>{display(charge, layout.units)}</strong>
                  <small>{readingStatus(charge) || "State of charge"}</small>
                </div>
              </div>
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
                    style={{
                      width: `${Math.max(0, Math.min(100, charge.value!))}%`,
                    }}
                  />
                )}
              </div>
              <div class="metric-strip charging-metrics">
                <Metric
                  label="Pack voltage"
                  reading={signals.voltageV}
                  units={layout.units}
                />
                <Metric
                  label="Pack current"
                  reading={signals.currentA}
                  units={layout.units}
                />
                <Metric
                  label="Remaining energy"
                  reading={signals.remainingEnergyKwh}
                  units={layout.units}
                />
                <Metric
                  label="Full pack energy"
                  reading={signals.fullPackEnergyKwh}
                  units={layout.units}
                />
              </div>
              <section class="history-panel">
                <div class="section-heading">
                  <h2>Pack current history</h2>
                  <small>
                    {(data?.currentDirection ?? "unqualified") === "unqualified"
                      ? "A · direction unverified"
                      : "A"}
                  </small>
                </div>
                {tab === "charging" && !batteryHistory && (
                  <Suspense fallback={<p>Loading history…</p>}>
                    <History
                      reading={signals.currentA}
                      units={layout.units}
                      dark={dark}
                      label="Pack current"
                      staleAfter={
                        catalog.find((d) => d.key === "currentA")?.stale_after
                      }
                      height={130}
                    />
                  </Suspense>
                )}
              </section>
              <div class="metric-strip charging-metrics">
                <Metric
                  label="Lowest temperature"
                  reading={signals.minimumTemperatureC}
                  units={layout.units}
                />
                <Metric
                  label="Highest temperature"
                  reading={signals.maximumTemperatureC}
                  units={layout.units}
                />
                <Metric
                  label="Charging power"
                  reading={signals.chargingPowerKw}
                  units={layout.units}
                />
                <Metric
                  label="Charge limit"
                  reading={signals.chargeLimitPercent}
                  units={layout.units}
                />
              </div>
            </div>
            <div hidden={!batteryHistory}>
              <BatteryHistory
                active={tab === "charging" && batteryHistory}
                units={layout.units}
                dark={dark}
              />
            </div>
          </main>
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
                    : data?.recording.automaticMode === "drives"
                      ? "Ready for your next drive"
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
          <SessionAnalysis
            sessions={data?.recording.sessions || []}
            activeId={data?.recording.activeId || null}
            units={layout.units}
          />
        </Page>
        <Page name="settings" title="Settings" {...common}>
          <main class="settings-page">
            <ion-list-header>
              <ion-label>Display</ion-label>
            </ion-list-header>
            <ion-list>
              <ion-item>
                <ion-select
                  label="Appearance"
                  value={layout.theme}
                  disabled={busy}
                  interface="popover"
                  onionChange={(e) =>
                    save({ ...layout, theme: e.detail.value })
                  }
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
                  disabled={busy}
                  interface="popover"
                  onionChange={(e) =>
                    save({ ...layout, units: e.detail.value })
                  }
                >
                  <ion-select-option value="metric">Metric</ion-select-option>
                  <ion-select-option value="imperial">US</ion-select-option>
                </ion-select>
              </ion-item>
            </ion-list>
            <ion-list-header>
              <ion-label>Connection</ion-label>
            </ion-list-header>
            <ion-list>
              <ion-item href="https://checkip.amazonaws.com/" target="_self" rel="noreferrer" detail>
                <ion-label>Open internet test page</ion-label>
              </ion-item>
            </ion-list>
          </main>
        </Page>
        <ion-tab-bar slot="bottom">
          {[
            ["instruments", "Overview", "speedometer-outline"],
            ["cells", "Cells", "grid-outline"],
            ["charging", "Charging", "flash-outline"],
            ["sessions", "Sessions", "document-text-outline"],
            ["settings", "Settings", "settings-outline"],
          ].map(([key, label, icon]) => (
            <ion-tab-button tab={key} key={key}>
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

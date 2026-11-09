import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import "./style.css";

type Reading = {
  value: number | null;
  quality: string;
  unit: string;
  ageSeconds: number | null;
  minimum: number | null;
  maximum: number | null;
  history: number[][];
};
type Session = { id: string; sizeBytes: number; modifiedAt: number };
type Snapshot = {
  mode: string;
  connection: { state: string; error?: string };
  signals: Record<string, Reading>;
  cellGroups: (Reading & { index: number })[];
  cellSpreadMv: number | null;
  freshCellCount: number;
  currentDirection: string;
  reloadRevision: string;
  recording: {
    activeId: string | null;
    error: string | null;
    sessions: Session[];
  };
  replay?: { state: string; source: string; error?: string };
};
type Definition = { key: string; label: string; unit: string; group: string };
type Layout = {
  theme: "auto" | "day" | "night";
  units: "metric" | "imperial";
  instruments: string[];
};
const initialLayout: Layout = {
  theme: "night",
  units: "metric",
  instruments: ["voltageV", "currentA", "displayedChargePercent"],
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .catch(() => ({ detail: "Request failed" }));
    throw new Error(
      typeof detail.detail === "string"
        ? detail.detail
        : "Please check your selection",
    );
  }
  return response.json();
}
function display(
  reading: Reading | undefined,
  units: string,
  decimals?: number,
) {
  if (!reading || reading.value === null || reading.quality === "invalid")
    return { value: "—", unit: reading?.unit || "" };
  let value = reading.value,
    unit = reading.unit;
  if (units === "imperial" && unit === "°C") {
    value = (value * 9) / 5 + 32;
    unit = "°F";
  }
  if (units === "imperial" && unit === "km/h") {
    value /= 1.609344;
    unit = "mph";
  }
  return { value: value.toFixed(decimals ?? (unit === "V" ? 2 : 1)), unit };
}
function Trace({
  reading,
  units,
}: {
  reading: Reading | undefined;
  units: string;
}) {
  const node = useRef<HTMLDivElement>(null),
    plot = useRef<uPlot | null>(null);
  useEffect(() => {
    if (!node.current) return;
    const chart = new uPlot(
      {
        width: node.current.clientWidth,
        height: 140,
        legend: { show: false },
        cursor: { show: false },
        series: [{}, { stroke: "#53b9e8", width: 2 }],
        axes: [
          { show: false },
          { stroke: "#8c97a5", grid: { stroke: "#263342" }, size: 45 },
        ],
        scales: { x: { time: true } },
      },
      [[], []],
      node.current,
    );
    plot.current = chart;
    const observer = new ResizeObserver(() => {
      if (node.current)
        chart.setSize({ width: node.current.clientWidth, height: 140 });
    });
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      chart.destroy();
      plot.current = null;
    };
  }, []);
  useEffect(() => {
    const points = reading?.history || [];
    plot.current?.setData([
      points.map((p) => p[0]),
      points.map((p) =>
        reading?.unit === "°C" && units === "imperial"
          ? (p[1] * 9) / 5 + 32
          : reading?.unit === "km/h" && units === "imperial"
            ? p[1] / 1.609344
            : p[1],
      ),
    ]);
  }, [reading, units]);
  return <div ref={node} aria-label="Recent signal history" />;
}
function App() {
  const [data, setData] = useState<Snapshot | null>(null),
    [catalog, setCatalog] = useState<Definition[]>([]),
    [layout, setLayout] = useState(initialLayout),
    [tab, setTab] = useState("Overview"),
    [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [selected, setSelected] = useState("voltageV"),
    [cell, setCell] = useState<number | null>(null),
    [pending, setPending] = useState(false);
  const revision = useRef<string | null>(null),
    timings = useRef<number[]>([]),
    updates = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    api<{ signals: Definition[] }>("catalog")
      .then((v) => setCatalog(v.signals))
      .catch((e) => setActionError(e.message));
    api<Layout>("layout")
      .then(setLayout)
      .catch((e) => setActionError(e.message));
    async function poll() {
      try {
        const started = performance.now(),
          next = await api<Snapshot>("snapshot");
        if (!mounted.current) return;
        if (revision.current && revision.current !== next.reloadRevision) {
          location.reload();
          return;
        }
        revision.current = next.reloadRevision;
        setData(next);
        setError("");
        updates.current++;
        timings.current = [
          ...timings.current.slice(-19),
          performance.now() - started,
        ];
        if (updates.current === 10 || updates.current % 120 === 0)
          api("browser-check", "POST", {
            browser: navigator.userAgent,
            updates: updates.current,
            requestTimesMs: timings.current,
            visibility: document.visibilityState,
            width: innerWidth,
            height: innerHeight,
          }).catch(() => {});
      } catch (e) {
        if (mounted.current)
          setError("Connection lost. Reconnecting automatically.");
      }
      if (mounted.current)
        timer = setTimeout(poll, document.hidden ? 2000 : 500);
    }
    poll();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = layout.theme;
  }, [layout.theme]);
  async function act(path: string, method = "POST", body?: unknown) {
    setPending(true);
    try {
      await api(path, method, body);
      setData(await api<Snapshot>("snapshot"));
      setActionError("");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function save(next: Layout) {
    try {
      await api("layout", "PUT", next);
      setLayout(next);
      setActionError("");
    } catch (e) {
      setActionError((e as Error).message);
    }
  }
  const replay = data?.mode === "replay",
    selectedCell = data?.cellGroups.find((c) => c.index === cell),
    state = error ? "disconnected" : data?.connection.state || "connecting";
  return (
    <>
      <header>
        <div>
          <strong>CAN dashboard</strong>
          <small>Development preview</small>
        </div>
        <span class={"status " + state}>
          {replay ? "Replay · " : ""}
          {state}
        </span>
      </header>
      {error && (
        <div class="alert" role="alert">
          {error}
        </div>
      )}
      {actionError && (
        <div class="alert" role="alert">
          {actionError}{" "}
          <button onClick={() => setActionError("")}>Dismiss</button>
        </div>
      )}
      {data?.replay?.error && (
        <div class="alert" role="alert">
          {data.replay.error}
        </div>
      )}
      <nav aria-label="Pages">
        {["Overview", "Cells", "Sessions", "Settings"].map((name) => (
          <button
            aria-current={tab === name ? "page" : undefined}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      <main>
        {tab === "Overview" && (
          <>
            <section class="instruments">
              {layout.instruments.map((key) => {
                const definition = catalog.find((d) => d.key === key),
                  reading = data?.signals[key],
                  formatted = display(reading, layout.units);
                return (
                  <button
                    class={
                      "instrument " +
                      (error ? "stale" : reading?.quality || "unavailable")
                    }
                    onClick={() => setSelected(key)}
                    aria-pressed={selected === key}
                  >
                    <span>{definition?.label || key}</span>
                    <strong>
                      {formatted.value}
                      <small>{formatted.unit}</small>
                    </strong>
                    <em>
                      {error ? "disconnected" : reading?.quality || "waiting"}
                    </em>
                  </button>
                );
              })}
            </section>
            <section class="panel">
              <h2>
                {catalog.find((d) => d.key === selected)?.label || selected}
              </h2>
              <Trace reading={data?.signals[selected]} units={layout.units} />
              <p>
                Recent 2 minutes.{" "}
                {data?.signals[selected]?.ageSeconds !== null &&
                data?.signals[selected]?.ageSeconds !== undefined
                  ? `Last sample ${data.signals[selected].ageSeconds!.toFixed(1)} seconds ago.`
                  : "Waiting for a compatible signal."}
              </p>
            </section>
            <p class="note">
              Pack current uses the CAN sign. Charge and discharge direction
              have not been verified.
            </p>
          </>
        )}
        {tab === "Cells" && (
          <>
            <section class="cell-summary">
              <div>
                <span>Cell group spread</span>
                <strong>
                  {data?.cellSpreadMv === null ||
                  data?.cellSpreadMv === undefined
                    ? "—"
                    : data.cellSpreadMv.toFixed(1)}
                  <small> mV</small>
                </strong>
              </div>
              <p>
                {data?.freshCellCount || 0} / {data?.cellGroups.length || 0}{" "}
                groups fresh
                <br />
                Spread requires every configured group.
              </p>
            </section>
            <div class="cells">
              {data?.cellGroups.map((c) => (
                <button
                  class={error ? "stale" : c.quality}
                  aria-pressed={cell === c.index}
                  onClick={() => setCell(c.index)}
                >
                  <span>{c.index}</span>
                  <strong>{display(c, "metric", 4).value}</strong>
                </button>
              ))}
            </div>
            <p>
              {selectedCell
                ? `Group ${selectedCell.index}: ${display(selectedCell, "metric", 4).value} V, ${selectedCell.quality}.`
                : "Tap a cell group to inspect it."}
            </p>
            <p class="note">
              A cell group is several cells measured together. This view does
              not determine the age or health of individual cells.
            </p>
          </>
        )}
        {tab === "Sessions" && (
          <>
            <section class="panel">
              <h2>Record a drive or charge</h2>
              <p>
                Selected telemetry only. Recording continues while you review a
                saved session. Files stay on this device until you remove them.
              </p>
              <button
                disabled={
                  pending ||
                  (!data?.recording.activeId &&
                    data?.replay?.source === "demonstration")
                }
                onClick={() =>
                  act(
                    data?.recording.activeId
                      ? "recordings/stop"
                      : "recordings/start",
                  )
                }
              >
                {data?.recording.activeId
                  ? "Stop recording"
                  : "Start recording"}
              </button>
              {data?.recording.activeId && (
                <span role="status"> Recording</span>
              )}
              {data?.recording.error && (
                <p role="alert">{data.recording.error}</p>
              )}
            </section>
            {data?.replay && data.replay.source !== "demonstration" && (
              <section class="panel">
                <p>Replay {data.replay.state}</p>
                <button
                  disabled={pending}
                  onClick={() => act("replay", "POST", { session_id: null })}
                >
                  Return to live data
                </button>
              </section>
            )}
            <section>
              <h2>Saved sessions</h2>
              {!data?.recording.sessions.length && (
                <p>
                  No sessions yet. Start recording when live CAN data is
                  connected.
                </p>
              )}
              {data?.recording.sessions.map((s) => (
                <article class="session">
                  <div>
                    <strong>
                      {new Date(s.modifiedAt * 1000).toLocaleString()}
                    </strong>
                    <small>
                      {(s.sizeBytes / 1024).toFixed(0)} KB{" "}
                      {s.id === data.recording.activeId ? "· recording" : ""}
                    </small>
                  </div>
                  <a href={"/api/recordings/" + s.id} download>
                    Export
                  </a>
                  <button
                    disabled={pending || s.id === data.recording.activeId}
                    onClick={() =>
                      act("replay", "POST", { session_id: s.id, rate: 1 })
                    }
                  >
                    Replay
                  </button>
                  <button
                    disabled={pending || s.id === data.recording.activeId}
                    onClick={() => {
                      if (
                        confirm(
                          "Remove this saved session from the device? Export it first if you want to keep it.",
                        )
                      )
                        act("recordings/" + s.id, "DELETE");
                    }}
                  >
                    Remove
                  </button>
                </article>
              ))}
            </section>
          </>
        )}
        {tab === "Settings" && (
          <section class="panel">
            <h2>Your dashboard</h2>
            <label>
              Appearance
              <select
                value={layout.theme}
                onChange={(e) =>
                  save({
                    ...layout,
                    theme: e.currentTarget.value as Layout["theme"],
                  })
                }
              >
                <option value="auto">System</option>
                <option value="day">Day</option>
                <option value="night">Night</option>
              </select>
            </label>
            <label>
              Units
              <select
                value={layout.units}
                onChange={(e) =>
                  save({
                    ...layout,
                    units: e.currentTarget.value as Layout["units"],
                  })
                }
              >
                <option value="metric">Metric</option>
                <option value="imperial">US</option>
              </select>
            </label>
            <h3>Instruments</h3>
            <div class="choices">
              {catalog.map((d) => (
                <label>
                  <input
                    type="checkbox"
                    checked={layout.instruments.includes(d.key)}
                    onChange={(e) =>
                      save({
                        ...layout,
                        instruments: e.currentTarget.checked
                          ? [...layout.instruments, d.key]
                          : layout.instruments.filter((k) => k !== d.key),
                      })
                    }
                  />
                  {d.label}
                </label>
              ))}
            </div>
            <p>Unavailable signals remain visible so missing data is clear.</p>
          </section>
        )}
      </main>
      <footer>
        {replay ? "Replay data" : "Live CAN receiver"} · Receive only
      </footer>
    </>
  );
}
render(<App />, document.getElementById("app")!);

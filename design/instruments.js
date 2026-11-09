"use strict";
const $ = (id) => document.getElementById(id);
const model = { fixture: null, seconds: 0, playing: false, group: 1, bank: 0, instrument: "voltageV", actions: new Map(), theme: "day" };
const instruments = {
    voltageV: { label: "Pack voltage", unit: "V", min: 300, max: 450, digits: 2 },
    displayedChargePercent: { label: "State of charge", unit: "%", min: 0, max: 100, digits: 1 },
    currentA: { label: "Pack current", unit: "A", min: -10, max: 10, digits: 1 },
};
const actionIcons = [
    '<path d="M6 12h36v21H6zM6 19h36M20 23h8M10 33v4m28-4v4"/>',
    '<path d="M18 9v30m12-30v30M15 16H9c-5 0-5 16 0 16h6m18-16h6c5 0 5 16 0 16h-6M21 19l-4 5 4 5m6-10 4 5-4 5"/>',
    '<path d="M13 8h22v32H13zM19 15h10v9H19zM23 28l-3 5h5l-2 4M35 15h5v19"/>',
];
function remember(key, value) { try { localStorage.setItem(key, value); } catch {} }
function recall(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function getQuality() {
    let state = "connected";
    const absent = new Set();
    for (const event of model.fixture.scenarios) {
        if (event.atSeconds > model.seconds) continue;
        if (event.signal) { absent.add(event.signal); continue; }
        state = event.state;
        if (state === "connected") absent.clear();
    }
    return { state, absent, recovered: model.seconds >= 25 && state === "connected" };
}
function getValue(key) {
    const quality = getQuality();
    if (quality.state === "disconnected" || quality.absent.has(key)) return null;
    const value = model.fixture.values[key];
    return Number.isFinite(value) ? value : null;
}
function format(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "—"; }
function validGroups() {
    if (getQuality().state === "disconnected") return [];
    return model.fixture.cellGroups.filter((group) => group.state === "valid" && Number.isFinite(group.voltageV));
}
function groupStats() {
    const groups = validGroups();
    if (!groups.length) return null;
    const voltages = groups.map((group) => group.voltageV);
    const min = Math.min(...voltages), max = Math.max(...voltages);
    return { min, max, mean: voltages.reduce((sum, value) => sum + value, 0) / voltages.length, spread: (max - min) * 1000 };
}
function renderDial() {
    const instrument = instruments[model.instrument];
    const value = getValue(model.instrument);
    $("dial-label").textContent = instrument.label;
    $("dial-value").textContent = format(value, instrument.digits);
    $("dial-unit").textContent = instrument.unit;
    $("scale-min").textContent = instrument.min;
    $("scale-max").textContent = `${instrument.max} ${instrument.unit}`;
    const quality = getQuality();
    $("dial-context").textContent = quality.state === "stale" ? "Last known · data stale" : quality.state === "disconnected" ? "Disconnected · no reading" : "Captured reading · replay only";
    const fraction = value === null ? 0 : Math.max(0, Math.min(1, (value - instrument.min) / (instrument.max - instrument.min)));
    $("dial-fill").setAttribute("stroke-dasharray", `${fraction * 100} 100`);
    const angle = (150 + fraction * 240) * Math.PI / 180;
    $("dial-dot").setAttribute("cx", String(150 + 116 * Math.cos(angle)));
    $("dial-dot").setAttribute("cy", String(119 + 116 * Math.sin(angle)));
    $("dial-dot").style.display = value === null ? "none" : "";
}
function renderReadouts() {
    $("current").textContent = format(getValue("currentA"));
    $("charge").textContent = format(getValue("displayedChargePercent"));
    const charge = getValue("displayedChargePercent");
    $("charge-fill").style.width = charge === null ? "0%" : `${Math.max(0, Math.min(100, charge))}%`;
    $("temperature").textContent = getValue("minimumTemperatureC") === null || getValue("maximumTemperatureC") === null ? "—" : `${format(getValue("minimumTemperatureC"))}–${format(getValue("maximumTemperatureC"))}`;
    $("energy").textContent = format(getValue("fullPackEnergyKwh"));
    const quality = getQuality();
    $("energy-state").textContent = quality.state === "disconnected" ? "Disconnected" : quality.absent.has("fullPackEnergyKwh") ? "Unavailable in replay" : quality.state === "stale" ? "Last known" : "From capture";
}
function renderCells() {
    const stats = groupStats();
    const quality = getQuality();
    $("overview-spread").textContent = format(stats?.spread);
    $("cell-spread").textContent = format(stats?.spread);
    $("cell-range").textContent = stats ? `${format(stats.min, 4)}–${format(stats.max, 4)} V` : "No readings";
    const points = validGroups().map((group, index) => `${index * 360 / 95},${38 - (group.voltageV - stats.min) / Math.max(stats.max - stats.min, .0001) * 32}`);
    $("cell-profile").innerHTML = points.length ? `<path d="M${points.join(" L")}"/>` : "";
    for (const group of model.fixture.cellGroups) {
        const button = $("cell-" + group.index);
        button.hidden = Math.floor((group.index - 1) / 48) !== model.bank;
        const available = stats && group.state === "valid" && Number.isFinite(group.voltageV);
        const relative = available ? (group.voltageV - stats.min) / Math.max(stats.max - stats.min, .0001) : 0;
        const color = available ? `color-mix(in srgb, var(--map-low), var(--map-high) ${Math.round(relative * 100)}%)` : "var(--track)";
        button.style.setProperty("--cell-color", color);
        button.style.color = available && relative > .65 && model.theme === "day" ? "#fff" : "var(--ink)";
        button.setAttribute("aria-pressed", String(group.index === model.group));
        if (group.index === model.group) button.style.color = "var(--ink)";
        button.setAttribute("aria-label", `Group ${group.index}: ${available ? format(group.voltageV, 4) + " volts" : "unavailable"}${quality.state === "stale" ? ", last known" : ""}`);
    }
    $("bank-first").setAttribute("aria-pressed", String(model.bank === 0));
    $("bank-second").setAttribute("aria-pressed", String(model.bank === 1));
    const group = model.fixture.cellGroups.find((item) => item.index === model.group);
    const available = stats && group?.state === "valid" && Number.isFinite(group.voltageV);
    $("group-label").textContent = `Group ${String(model.group).padStart(2, "0")}`;
    $("group-voltage").textContent = available ? format(group.voltageV, 4) : "—";
    $("group-deviation").textContent = available ? `${group.voltageV >= stats.mean ? "+" : ""}${format((group.voltageV - stats.mean) * 1000)} mV` : "—";
    $("group-min").textContent = available && Number.isFinite(group.minimumV) ? `${format(group.minimumV, 4)} V` : "—";
    $("group-max").textContent = available && Number.isFinite(group.maximumV) ? `${format(group.maximumV, 4)} V` : "—";
    $("group-quality").textContent = !available ? "Unavailable" : quality.state === "stale" ? "Last known" : "Captured";
}
function renderReplay() {
    const quality = getQuality();
    const labels = { connected: "Replay / captured data", stale: "Replay / stale data", disconnected: "Replay / disconnected" };
    $("quality").textContent = quality.recovered ? "Replay / recovered" : quality.absent.size && quality.state === "connected" ? "Replay / partial data" : labels[quality.state];
    $("quality").className = `quality${quality.state !== "connected" || quality.absent.size ? " warning" : ""}`;
    document.body.className = `data-${quality.state}`;
    $("replay-note").textContent = quality.state === "stale" ? "Last known values retained · scrub to 25s to recover" : quality.state === "disconnected" ? "Connection lost · scrub to 25s to reconnect" : quality.recovered ? "Connection recovered · capture restored" : quality.absent.size ? "Pack energy unavailable · other signals retained" : "Static capture · quality-state timeline";
    $("timeline").value = String(model.seconds);
    $("time").textContent = `00:${String(model.seconds).padStart(2, "0")}`;
    const event = [...model.fixture.scenarios].reverse().find((item) => model.seconds >= item.atSeconds);
    $("scenario").value = String(event?.atSeconds || 0);
    $("play").textContent = model.playing ? "Ⅱ" : "▶";
    $("play").setAttribute("aria-label", model.playing ? "Pause replay" : "Play replay");
}
function render() { if (!model.fixture) return; renderReplay(); renderDial(); renderReadouts(); renderCells(); }
function showView(name) {
    document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== name; });
    document.querySelectorAll(".nav-button").forEach((button) => {
        const active = button.dataset.view === name;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
}
function setTheme(theme) {
    model.theme = theme;
    document.documentElement.dataset.theme = theme;
    $("theme").textContent = theme === "day" ? "☾ Night" : "☼ Day";
    $("theme").setAttribute("aria-label", `Switch to ${theme === "day" ? "night" : "day"} theme`);
    remember("pack-theme", theme);
    render();
}
function renderActions() {
    const labels = { pending: "Pending…", confirmed: "Success · simulated", unconfirmed: "Unconfirmed · retry", idle: "Tap to simulate" };
    for (const [action, record] of model.actions) {
        record.button.querySelector("small").textContent = labels[record.state];
        record.button.disabled = record.state === "pending";
        record.button.setAttribute("aria-label", `${action}: ${labels[record.state]}`);
    }
}
function simulateAction(action) {
    const record = model.actions.get(action);
    clearTimeout(record.timer);
    record.state = "pending";
    const outcome = $("outcome").value;
    $("action-feedback").textContent = `${action}: pending simulation. No vehicle command sent.`;
    renderActions();
    if (outcome === "pending") return;
    record.timer = setTimeout(() => {
        record.state = outcome;
        $("action-feedback").textContent = outcome === "confirmed" ? `${action}: simulated success. No vehicle command sent.` : `${action}: result unconfirmed. Try again or reset the tile.`;
        renderActions();
    }, 1100);
}
function initialize(fixture) {
    model.fixture = fixture;
    for (const group of fixture.cellGroups) {
        const button = document.createElement("button");
        button.className = "cell-group";
        button.id = "cell-" + group.index;
        button.textContent = group.index;
        button.addEventListener("click", () => { model.group = group.index; renderCells(); });
        $("cell-grid").append(button);
    }
    fixture.controlDemo.actions.forEach((action, index) => {
        const button = document.createElement("button");
        button.className = "action-tile";
        button.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true">${actionIcons[index] || actionIcons[0]}</svg><strong></strong><small></small>`;
        button.querySelector("strong").textContent = action[0].toUpperCase() + action.slice(1);
        button.addEventListener("click", () => simulateAction(action));
        model.actions.set(action, { state: "idle", button, timer: null });
        $("action-tiles").append(button);
    });
    $("zero-sixty").textContent = format(fixture.performanceDemo.zeroTo60MphSeconds);
    $("quarter-mile").textContent = format(fixture.performanceDemo.quarterMileSeconds);
    $("peak-power").textContent = format(fixture.performanceDemo.peakBatteryPowerKw, 0);
    $("performance-note").textContent = fixture.performanceDemo.note + ". Times start at first movement; no rollout is subtracted.";
    model.instrument = recall("pack-instrument", "voltageV");
    if (!instruments[model.instrument]) model.instrument = "voltageV";
    renderActions();
    setTheme(recall("pack-theme", "day") === "night" ? "night" : "day");
}
document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("open-cells").addEventListener("click", () => showView("cells"));
$("theme").addEventListener("click", () => setTheme(model.theme === "day" ? "night" : "day"));
$("configure").addEventListener("click", () => {
    document.querySelectorAll("[data-instrument]").forEach((button) => button.classList.toggle("selected", button.dataset.instrument === model.instrument));
    $("instrument-dialog").showModal();
});
document.querySelectorAll("[data-instrument]").forEach((button) => button.addEventListener("click", () => {
    model.instrument = button.dataset.instrument;
    remember("pack-instrument", model.instrument);
    $("instrument-dialog").close();
    renderDial();
}));
$("scenario").addEventListener("change", (event) => { model.seconds = Number(event.target.value); model.playing = false; render(); });
$("timeline").addEventListener("input", (event) => { model.seconds = Number(event.target.value); model.playing = false; render(); });
$("play").addEventListener("click", () => { if (model.seconds >= 30) model.seconds = 0; model.playing = !model.playing; render(); });
$("restart").addEventListener("click", () => { model.seconds = 0; model.playing = false; render(); });
$("bank-first").addEventListener("click", () => { model.bank = 0; model.group = 1; renderCells(); });
$("bank-second").addEventListener("click", () => { model.bank = 1; model.group = 49; renderCells(); });
$("previous-group").addEventListener("click", () => { model.group = model.group === 1 ? model.fixture.cellGroups.length : model.group - 1; model.bank = Math.floor((model.group - 1) / 48); renderCells(); });
$("next-group").addEventListener("click", () => { model.group = model.group === model.fixture.cellGroups.length ? 1 : model.group + 1; model.bank = Math.floor((model.group - 1) / 48); renderCells(); });
$("replay-result").addEventListener("click", () => {
    $("performance-note").textContent = "Simulated result replayed. 0–60 mph and ¼ mile start at first movement; no rollout is subtracted. No measurement was taken.";
    $("replay-result").textContent = "Replay again";
});
$("reset-actions").addEventListener("click", () => {
    for (const record of model.actions.values()) { clearTimeout(record.timer); record.state = "idle"; }
    $("action-feedback").textContent = "Tiles reset. Choose an action to simulate.";
    renderActions();
});
setInterval(() => { if (!model.playing || !model.fixture) return; model.seconds += 1; if (model.seconds >= 30) model.playing = false; render(); }, 1000);
fetch("fixture.json").then((response) => { if (!response.ok) throw new Error(`Capture request failed (${response.status})`); return response.json(); }).then(initialize).catch((error) => {
    $("quality").textContent = "Capture unavailable";
    $("quality").className = "quality warning";
    $("load-error").hidden = false;
    $("load-error").textContent = `${error.message}. Serve this folder with a local HTTP server, then reload.`;
    document.querySelectorAll("button, select, input").forEach((control) => { control.disabled = true; });
});

import type { IncomingMessage, ServerResponse } from "node:http";

const LOCALE_STORAGE_KEY = "crawclaw.observation.locale";

function sendText(
  res: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
  headOnly: boolean,
) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.end(headOnly ? undefined : body);
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function resolveBootstrapLocale(value: unknown): "en" | "zh-CN" | undefined {
  return value === "en" || value === "zh-CN" ? value : undefined;
}

export function renderObservationWorkbenchHtml(
  params: {
    bootstrapLocale?: unknown;
  } = {},
): string {
  const bootstrap = {
    locale: resolveBootstrapLocale(params.bootstrapLocale),
    localeStorageKey: LOCALE_STORAGE_KEY,
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Observation Workbench</title>
    <link rel="stylesheet" href="/observations/styles.css" />
  </head>
  <body>
    <main id="app" class="workbench" aria-live="polite"></main>
    <script>window.__CRAWCLAW_OBSERVATION_BOOTSTRAP__ = ${escapeJsonForScript(bootstrap)};</script>
    <script type="module" src="/observations/app.js"></script>
  </body>
</html>`;
}

export function renderObservationWorkbenchCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f5f7fb;
  --panel: #ffffff;
  --panel-2: #f9fbfe;
  --text: #17202f;
  --muted: #667085;
  --border: #d8dee9;
  --accent: #116a75;
  --accent-soft: #d8f1f3;
  --danger: #b42318;
  --warning: #9a6700;
  --ok: #087443;
  --shadow: 0 12px 28px rgba(22, 34, 51, 0.08);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
}
button, input, select, textarea { font: inherit; }
button {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 10px;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
.workbench {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(360px, 1fr) minmax(300px, 380px);
  grid-template-rows: 56px minmax(0, 1fr);
}
.topbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 18px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand strong { font-size: 16px; }
.brand span { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-actions { display: flex; align-items: center; gap: 8px; }
.locale-toggle { display: inline-flex; gap: 4px; }
.locale-toggle button[aria-pressed="true"] { background: var(--accent); color: white; border-color: var(--accent); }
.pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--border);
  background: var(--panel);
}
.pane:last-child { border-right: 0; }
.run-list, .timeline-pane, .evidence-pane {
  display: flex;
  flex-direction: column;
}
.pane-head {
  padding: 14px;
  border-bottom: 1px solid var(--border);
  display: grid;
  gap: 10px;
}
.pane-title { font-weight: 700; }
.search-row { display: grid; grid-template-columns: 1fr 110px; gap: 8px; }
.search-row input, .search-row select {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  background: white;
}
.list, .timeline, .evidence-body {
  min-height: 0;
  overflow: auto;
  padding: 10px;
}
.run-item, .timeline-item {
  width: 100%;
  text-align: left;
  display: grid;
  gap: 6px;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  background: var(--panel);
}
.run-item[aria-selected="true"], .timeline-item[aria-selected="true"] {
  border-color: var(--accent);
  box-shadow: inset 3px 0 0 var(--accent);
}
.row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.between { justify-content: space-between; }
.mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.muted { color: var(--muted); }
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
  max-width: 100%;
}
.badge.running { color: var(--accent); background: var(--accent-soft); border-color: #9fd8dc; }
.badge.ok { color: var(--ok); background: #dff8eb; border-color: #a7e4c3; }
.badge.error, .badge.timeout { color: var(--danger); background: #fee4e2; border-color: #fecdca; }
.tabs {
  display: flex;
  gap: 6px;
  padding: 10px 10px 0;
  background: var(--panel);
  overflow-x: auto;
}
.tabs button { white-space: nowrap; }
.tabs button[aria-selected="true"] { background: var(--accent); color: white; border-color: var(--accent); }
.detail-tab {
  min-height: 0;
  overflow: auto;
  padding: 10px;
}
.kv {
  display: grid;
  grid-template-columns: minmax(95px, 140px) minmax(0, 1fr);
  gap: 7px 10px;
  align-items: baseline;
}
.kv dt { color: var(--muted); }
.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.json-block {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #111827;
  color: #f9fafb;
  border-radius: 8px;
  padding: 12px;
  line-height: 1.45;
}
.trace-map {
  width: 100%;
  min-height: 300px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.empty, .error-state {
  padding: 22px;
  color: var(--muted);
  text-align: center;
}
.error-state { color: var(--danger); }
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.metric {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
}
.metric strong { display: block; font-size: 18px; }
@media (max-width: 860px) {
  .workbench {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto;
  }
  .pane {
    min-height: 44vh;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .search-row { grid-template-columns: 1fr; }
  .evidence-pane { min-height: 55vh; }
}
`;
}

export function renderObservationWorkbenchJs(): string {
  return `
const bootstrap = window.__CRAWCLAW_OBSERVATION_BOOTSTRAP__ || {};
const localeKey = bootstrap.localeStorageKey || "${LOCALE_STORAGE_KEY}";
const text = {
  en: {
    subtitle: "Unified run, trace, sink, and evidence view",
    runs: "Runs",
    search: "Search runId / taskId / traceId",
    status: "Status",
    source: "Source",
    all: "All",
    timeline: "Timeline",
    traceMap: "Trace Map",
    ops: "Ops",
    raw: "Raw JSON",
    evidence: "Evidence",
    empty: "No observation runs match the current filters.",
    selectRun: "Select a run to inspect its timeline.",
    selectEvent: "Select a timeline event to inspect evidence.",
    errors: "Errors",
    events: "Events",
    sinks: "Sinks",
    coverage: "Coverage",
    refs: "Refs",
    metrics: "Metrics",
    observation: "ObservationContext",
    from: "From",
    to: "To",
    loadMore: "Load more",
    copy: "Copy",
    copied: "Copied",
    connectError: "Gateway connection failed. Check auth and reload.",
    token: "Gateway token",
    saveToken: "Save token",
    redacted: "[redacted]",
  },
  "zh-CN": {
    subtitle: "统一查看 run、trace、sink 和证据",
    runs: "运行",
    search: "搜索 runId / taskId / traceId",
    status: "状态",
    source: "来源",
    all: "全部",
    timeline: "时间线",
    traceMap: "Trace Map",
    ops: "运维",
    raw: "Raw JSON",
    evidence: "证据",
    empty: "当前筛选下没有 observation run。",
    selectRun: "选择一个 run 查看时间线。",
    selectEvent: "选择一个时间线事件查看证据。",
    errors: "错误",
    events: "事件",
    sinks: "Sink",
    coverage: "覆盖",
    refs: "Refs",
    metrics: "Metrics",
    observation: "ObservationContext",
    from: "开始",
    to: "结束",
    loadMore: "加载更多",
    copy: "复制",
    copied: "已复制",
    connectError: "Gateway 连接失败。请检查认证后刷新。",
    token: "Gateway token",
    saveToken: "保存 token",
    redacted: "[已隐藏]",
  },
};
const state = {
  locale: resolveLocale(),
  rpcSeq: 1,
  ws: null,
  pending: new Map(),
  runs: [],
  selectedRun: null,
  detail: null,
  selectedEventId: null,
  activeTab: "timeline",
  query: "",
  status: "",
  source: "",
  from: "",
  to: "",
  nextCursor: "",
  error: "",
  copied: "",
};
const statuses = ["", "running", "ok", "error", "timeout", "archived", "unknown"];
const sources = ["", "lifecycle", "diagnostic", "action", "archive", "trajectory", "log", "otel"];
const sensitiveKeys = new Set([
  "prompt",
  "transcript",
  "message",
  "messages",
  "content",
  "body",
  "result",
  "toolResult",
  "tool result",
  "args",
  "input",
  "output",
]);

function t(key) {
  return (text[state.locale] || text.en)[key] || text.en[key] || key;
}
function resolveLocale() {
  const stored = localStorage.getItem(localeKey);
  if (stored === "en" || stored === "zh-CN") return stored;
  if (bootstrap.locale === "en" || bootstrap.locale === "zh-CN") return bootstrap.locale;
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
function setLocale(locale) {
  state.locale = locale;
  localStorage.setItem(localeKey, locale);
  document.documentElement.lang = locale;
  render();
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}
function fmtTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(state.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function shortId(value) {
  const raw = String(value || "");
  return raw.length > 18 ? raw.slice(0, 8) + "..." + raw.slice(-6) : raw;
}
function redact(value, depth = 0) {
  if (depth > 8) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (sensitiveKeys.has(key) || sensitiveKeys.has(normalized) || normalized.includes("transcript")) {
      out[key] = t("redacted");
    } else if (typeof item === "string" && item.length > 600) {
      out[key] = item.slice(0, 220) + "... [" + item.length + " chars]";
    } else {
      out[key] = redact(item, depth + 1);
    }
  }
  return out;
}
function copyValue(value, label) {
  navigator.clipboard?.writeText(String(value || "")).then(() => {
    state.copied = label;
    render();
    setTimeout(() => { state.copied = ""; render(); }, 1200);
  });
}
function gatewayToken() {
  return localStorage.getItem("crawclaw.gateway.token") || "";
}
function connect() {
  return new Promise((resolve, reject) => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) return resolve(state.ws);
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => reject(new Error("connect timeout")), 8000);
    ws.onmessage = (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame.type === "event" && frame.event === "connect.challenge") {
        ws.send(JSON.stringify({
          type: "req",
          id: "connect-" + Date.now(),
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "observation-workbench", version: "1", platform: "web", mode: "operator" },
            role: "operator",
            scopes: ["operator.read"],
            caps: [],
            commands: [],
            auth: gatewayToken() ? { token: gatewayToken(), password: gatewayToken() } : {},
            locale: state.locale,
            userAgent: navigator.userAgent,
          },
        }));
        return;
      }
      if (frame.type === "res" && String(frame.id).startsWith("connect-")) {
        clearTimeout(timeout);
        if (!frame.ok) {
          reject(new Error(frame.error?.message || "connect failed"));
          return;
        }
        state.ws = ws;
        ws.onmessage = handleFrame;
        ws.onclose = () => { state.ws = null; };
        resolve(ws);
      }
    };
    ws.onerror = () => reject(new Error("websocket error"));
  });
}
function handleFrame(event) {
  let frame;
  try { frame = JSON.parse(event.data); } catch { return; }
  if (frame.type !== "res") return;
  const pending = state.pending.get(frame.id);
  if (!pending) return;
  state.pending.delete(frame.id);
  frame.ok ? pending.resolve(frame.payload) : pending.reject(new Error(frame.error?.message || "RPC failed"));
}
async function rpc(method, params) {
  const ws = await connect();
  const id = "obs-" + state.rpcSeq++;
  const promise = new Promise((resolve, reject) => state.pending.set(id, { resolve, reject }));
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return promise;
}
async function loadRuns() {
  return loadRunPage(false);
}
async function loadMoreRuns() {
  return loadRunPage(true);
}
function timeInputMs(value) {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}
async function loadRunPage(append) {
  try {
    state.error = "";
    const result = await rpc("agent.observations.list", {
      query: state.query || undefined,
      status: state.status || undefined,
      source: state.source || undefined,
      from: timeInputMs(state.from),
      to: timeInputMs(state.to),
      limit: 50,
      cursor: append ? state.nextCursor || undefined : undefined,
    });
    const items = result.items || [];
    state.runs = append ? dedupeRuns([...state.runs, ...items]) : items;
    state.nextCursor = result.nextCursor || "";
    if (!append && !state.selectedRun && state.runs[0]) selectRun(state.runs[0]);
    render();
  } catch (error) {
    state.error = String(error.message || error);
    render();
  }
}
function dedupeRuns(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.traceId || item.runId || item.taskId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
async function selectRun(run) {
  state.selectedRun = run;
  state.selectedEventId = null;
  render();
  const params = run.runId ? { runId: run.runId } : run.taskId ? { taskId: run.taskId } : { traceId: run.traceId };
  try {
    state.detail = await rpc("agent.inspect", params);
  } catch (error) {
    state.error = String(error.message || error);
  }
  render();
}
function selectedEvent() {
  const timeline = state.detail?.timeline || [];
  return timeline.find((event) => event.eventId === state.selectedEventId) || timeline[0] || null;
}
function render() {
  document.documentElement.lang = state.locale;
  const app = document.getElementById("app");
  app.innerHTML = [
    renderTopbar(),
    renderRuns(),
    renderMiddle(),
    renderEvidence(),
  ].join("");
  bindEvents();
}
function renderTopbar() {
  return '<header class="topbar"><div class="brand"><strong>Observation Workbench</strong><span>' +
    escapeHtml(t("subtitle")) + '</span></div><div class="top-actions">' +
    '<div class="locale-toggle"><button data-locale="zh-CN" aria-pressed="' + (state.locale === "zh-CN") + '">中文</button><button data-locale="en" aria-pressed="' + (state.locale === "en") + '">EN</button></div>' +
    (state.copied ? '<span class="badge ok">' + escapeHtml(t("copied")) + '</span>' : '') +
    '</div></header>';
}
function renderRuns() {
  const items = state.runs.map((run) => {
    const selected = state.selectedRun?.traceId === run.traceId;
    return '<button class="run-item" data-run="' + escapeHtml(run.traceId) + '" aria-selected="' + selected + '">' +
      '<div class="row between"><strong class="truncate">' + escapeHtml(run.runId || run.taskId || run.traceId) + '</strong><span class="badge ' + escapeHtml(run.status) + '">' + escapeHtml(run.status) + '</span></div>' +
      '<div class="mono muted truncate">traceId ' + escapeHtml(shortId(run.traceId)) + '</div>' +
      '<div class="row muted"><span>' + escapeHtml(run.agentId || "-") + '</span><span>' + escapeHtml(String(run.eventCount)) + ' ' + escapeHtml(t("events")) + '</span><span>' + escapeHtml(String(run.errorCount)) + ' ' + escapeHtml(t("errors")) + '</span></div>' +
      '<div class="muted truncate">' + escapeHtml(run.summary) + '</div>' +
    '</button>';
  }).join("");
  return '<section class="pane run-list"><div class="pane-head"><div class="pane-title">' + escapeHtml(t("runs")) + '</div>' +
    '<div class="search-row"><input id="query" value="' + escapeHtml(state.query) + '" placeholder="' + escapeHtml(t("search")) + '" />' + renderSelect("status", statuses, state.status) + '</div>' +
    '<div class="search-row">' + renderSelect("source", sources, state.source) + '<button id="refresh">Refresh</button></div>' +
    '<div class="search-row"><input id="from" type="datetime-local" value="' + escapeHtml(state.from) + '" aria-label="' + escapeHtml(t("from")) + '" /><input id="to" type="datetime-local" value="' + escapeHtml(state.to) + '" aria-label="' + escapeHtml(t("to")) + '" /></div>' +
    '</div><div class="list">' + (state.error ? '<div class="error-state">' + escapeHtml(t("connectError")) + '<br />' + renderTokenInput() + '</div>' : items || '<div class="empty">' + escapeHtml(t("empty")) + '</div>') + (state.nextCursor ? '<button id="load-more" class="run-item">' + escapeHtml(t("loadMore")) + '</button>' : '') + '</div></section>';
}
function renderTokenInput() {
  return '<input id="gateway-token" type="password" placeholder="' + escapeHtml(t("token")) + '" /><button id="save-token">' + escapeHtml(t("saveToken")) + '</button>';
}
function renderSelect(id, values, selected) {
  return '<select id="' + id + '">' + values.map((value) => '<option value="' + escapeHtml(value) + '"' + (value === selected ? " selected" : "") + '>' + escapeHtml(value || t("all")) + '</option>').join("") + '</select>';
}
function renderMiddle() {
  return '<section class="pane timeline-pane">' + renderTabs() + renderActiveTab() + '</section>';
}
function renderTabs() {
  return '<nav class="tabs">' + [
    ["timeline", t("timeline")],
    ["trace", t("traceMap")],
    ["ops", t("ops")],
    ["raw", t("raw")],
  ].map(([id, label]) => '<button data-tab="' + id + '" aria-selected="' + (state.activeTab === id) + '">' + escapeHtml(label) + '</button>').join("") + '</nav>';
}
function renderActiveTab() {
  if (!state.detail) return '<div class="detail-tab empty">' + escapeHtml(t("selectRun")) + '</div>';
  if (state.activeTab === "trace") return renderTraceMap();
  if (state.activeTab === "ops") return renderOps();
  if (state.activeTab === "raw") return '<div class="detail-tab"><button data-copy-json="1">' + escapeHtml(t("copy")) + '</button><pre class="json-block">' + escapeHtml(JSON.stringify(redact(state.detail), null, 2)) + '</pre></div>';
  const items = (state.detail.timeline || []).map((event) => '<button class="timeline-item" data-event="' + escapeHtml(event.eventId) + '" aria-selected="' + (selectedEvent()?.eventId === event.eventId) + '">' +
    '<div class="row between"><strong class="truncate">' + escapeHtml(event.type || event.phase) + '</strong><span class="badge">' + escapeHtml(event.source || "-") + '</span></div>' +
    '<div class="muted">' + escapeHtml(fmtTime(event.createdAt)) + ' ' + escapeHtml(event.status || "") + '</div>' +
    '<div class="truncate">' + escapeHtml(event.summary || "") + '</div>' +
    '<div class="mono muted truncate">spanId ' + escapeHtml(shortId(event.spanId || event.observation?.trace?.spanId || "")) + '</div>' +
  '</button>').join("");
  return '<div class="timeline">' + (items || '<div class="empty">' + escapeHtml(t("empty")) + '</div>') + '</div>';
}
function renderTraceMap() {
  const events = state.detail?.timeline || [];
  const spans = [];
  const seen = new Set();
  for (const event of events) {
    const spanId = event.spanId || event.observation?.trace?.spanId;
    if (!spanId || seen.has(spanId)) continue;
    seen.add(spanId);
    spans.push({ spanId, parentSpanId: event.parentSpanId || event.observation?.trace?.parentSpanId, label: event.type || event.phase || spanId });
  }
  const nodes = spans.map((span, index) => {
    const y = 36 + index * 54;
    return '<g data-event="' + escapeHtml(span.spanId) + '"><rect x="24" y="' + y + '" width="240" height="34" rx="7" fill="#fff" stroke="#116a75"></rect><text x="36" y="' + (y + 22) + '" font-size="12">' + escapeHtml(shortId(span.label)) + '</text></g>';
  }).join("");
  const edges = spans.map((span, index) => span.parentSpanId ? '<path d="M 264 ' + (53 + index * 54) + ' C 300 ' + (53 + index * 54) + ', 300 ' + Math.max(53, 53 + (index - 1) * 54) + ', 330 ' + Math.max(53, 53 + (index - 1) * 54) + '" stroke="#98a2b3" fill="none" />' : '').join("");
  return '<div class="detail-tab"><svg class="trace-map" viewBox="0 0 620 ' + Math.max(320, spans.length * 60 + 60) + '">' + edges + nodes + '</svg></div>';
}
function renderOps() {
  const run = state.selectedRun || {};
  const sources = run.sources || [];
  return '<div class="detail-tab"><div class="metric-grid">' +
    '<div class="metric"><span>' + escapeHtml(t("events")) + '</span><strong>' + escapeHtml(run.eventCount || 0) + '</strong></div>' +
    '<div class="metric"><span>' + escapeHtml(t("errors")) + '</span><strong>' + escapeHtml(run.errorCount || 0) + '</strong></div>' +
    '<div class="metric"><span>' + escapeHtml(t("sinks")) + '</span><strong>' + escapeHtml(sources.length) + '</strong></div>' +
    '<div class="metric"><span>' + escapeHtml(t("coverage")) + '</span><strong>' + escapeHtml(sources.join(", ") || "-") + '</strong></div>' +
  '</div></div>';
}
function renderEvidence() {
  const event = selectedEvent();
  if (!event) return '<aside class="pane evidence-pane"><div class="pane-head"><div class="pane-title">' + escapeHtml(t("evidence")) + '</div></div><div class="evidence-body empty">' + escapeHtml(t("selectEvent")) + '</div></aside>';
  const observation = event.observation || state.detail?.runContext?.observation || {};
  return '<aside class="pane evidence-pane"><div class="pane-head"><div class="pane-title">' + escapeHtml(t("evidence")) + '</div></div><div class="evidence-body">' +
    renderKv(t("observation"), observation) +
    renderKv(t("refs"), event.refs || {}) +
    renderKv(t("metrics"), event.metrics || {}) +
  '</div></aside>';
}
function renderKv(title, obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return '<h3>' + escapeHtml(title) + '</h3><div class="muted">-</div>';
  return '<h3>' + escapeHtml(title) + '</h3><dl class="kv">' + entries.map(([key, value]) =>
    '<dt>' + escapeHtml(key) + '</dt><dd class="mono">' + escapeHtml(typeof value === "object" ? JSON.stringify(value) : value) + '</dd>'
  ).join("") + '</dl>';
}
function bindEvents() {
  document.querySelectorAll("[data-locale]").forEach((button) => button.onclick = () => setLocale(button.dataset.locale));
  document.querySelector("#query")?.addEventListener("change", (event) => { state.query = event.target.value; loadRuns(); });
  document.querySelector("#status")?.addEventListener("change", (event) => { state.status = event.target.value; loadRuns(); });
  document.querySelector("#source")?.addEventListener("change", (event) => { state.source = event.target.value; loadRuns(); });
  document.querySelector("#from")?.addEventListener("change", (event) => { state.from = event.target.value; loadRuns(); });
  document.querySelector("#to")?.addEventListener("change", (event) => { state.to = event.target.value; loadRuns(); });
  document.querySelector("#refresh")?.addEventListener("click", loadRuns);
  document.querySelector("#load-more")?.addEventListener("click", loadMoreRuns);
  document.querySelector("#save-token")?.addEventListener("click", () => {
    const input = document.querySelector("#gateway-token");
    localStorage.setItem("crawclaw.gateway.token", input?.value || "");
    state.error = "";
    state.ws?.close();
    state.ws = null;
    loadRuns();
  });
  document.querySelectorAll("[data-run]").forEach((button) => button.onclick = () => {
    const run = state.runs.find((item) => item.traceId === button.dataset.run);
    if (run) selectRun(run);
  });
  document.querySelectorAll("[data-tab]").forEach((button) => button.onclick = () => { state.activeTab = button.dataset.tab; render(); });
  document.querySelectorAll("[data-event]").forEach((button) => button.onclick = () => { state.selectedEventId = button.dataset.event; render(); });
  document.querySelector("[data-copy-json]")?.addEventListener("click", () => copyValue(JSON.stringify(redact(state.detail), null, 2), "json"));
}
render();
loadRuns();
setInterval(loadRuns, 10000);
setInterval(() => {
  if (state.selectedRun?.status === "running") {
    selectRun(state.selectedRun);
  }
}, 2000);
`;
}

export function handleObservationWorkbenchHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestPath: string;
  bootstrapLocale?: unknown;
}): boolean {
  if (
    params.requestPath !== "/observations" &&
    params.requestPath !== "/observations/" &&
    params.requestPath !== "/observations/app.js" &&
    params.requestPath !== "/observations/styles.css"
  ) {
    return false;
  }
  const method = (params.req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    params.res.statusCode = 405;
    params.res.setHeader("Allow", "GET, HEAD");
    params.res.setHeader("Content-Type", "text/plain; charset=utf-8");
    params.res.end("Method Not Allowed");
    return true;
  }
  const headOnly = method === "HEAD";
  if (params.requestPath.endsWith("/app.js")) {
    sendText(
      params.res,
      200,
      "application/javascript; charset=utf-8",
      renderObservationWorkbenchJs(),
      headOnly,
    );
    return true;
  }
  if (params.requestPath.endsWith("/styles.css")) {
    sendText(params.res, 200, "text/css; charset=utf-8", renderObservationWorkbenchCss(), headOnly);
    return true;
  }
  sendText(
    params.res,
    200,
    "text/html; charset=utf-8",
    renderObservationWorkbenchHtml({ bootstrapLocale: params.bootstrapLocale }),
    headOnly,
  );
  return true;
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { CrawClawConfig } from "../config/config.js";
import {
  applyImprovementProposal,
  getImprovementProposalDetail,
  ImprovementCenterError,
  listImprovementProposals,
  reviewImprovementProposal,
  rollbackImprovementProposal,
  runImprovementScan,
  summarizeImprovementMetrics,
  verifyImprovementProposal,
} from "../improvement/center.js";
import {
  buildImprovementDetailView,
  buildImprovementListViewItem,
  mapImprovementCenterError,
} from "../improvement/view-model.js";
import { readJsonBody } from "./hooks.js";

const LOCALE_STORAGE_KEY = "crawclaw.improvement.locale";
const IMPROVEMENT_API_PREFIX = "/improvements/api";
const IMPROVEMENT_BODY_LIMIT_BYTES = 32 * 1024;
const IMPROVEMENT_STATUS_VALUES = [
  "draft",
  "policy_blocked",
  "pending_review",
  "approved",
  "applying",
  "verifying",
  "applied",
  "rejected",
  "failed",
  "superseded",
  "rolled_back",
] as const;
const IMPROVEMENT_KIND_VALUES = ["skill", "workflow", "code"] as const;
const reviewRequestSchema = z.object({
  approved: z.boolean(),
  reviewer: z.string().trim().min(1).max(120).optional(),
  comments: z.string().trim().max(2_000).optional(),
});

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

function sendJson(res: ServerResponse, statusCode: number, body: unknown, headOnly: boolean) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(headOnly ? undefined : JSON.stringify(body));
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function resolveBootstrapLocale(value: unknown): "en" | "zh-CN" | undefined {
  return value === "en" || value === "zh-CN" ? value : undefined;
}

export function isImprovementCenterRequestPath(requestPath: string): boolean {
  return (
    requestPath === "/improvements" ||
    requestPath === "/improvements/" ||
    requestPath === "/improvements/app.js" ||
    requestPath === "/improvements/styles.css" ||
    requestPath === IMPROVEMENT_API_PREFIX ||
    requestPath.startsWith(`${IMPROVEMENT_API_PREFIX}/`)
  );
}

type ImprovementApiRoute =
  | { kind: "list" }
  | { kind: "metrics" }
  | { kind: "run" }
  | { kind: "detail"; proposalId: string }
  | { kind: "review"; proposalId: string }
  | { kind: "apply"; proposalId: string }
  | { kind: "verify"; proposalId: string }
  | { kind: "rollback"; proposalId: string };

function normalizeApiPath(requestPath: string): string {
  if (requestPath === IMPROVEMENT_API_PREFIX) {
    return requestPath;
  }
  return requestPath.replace(/\/+$/, "");
}

function decodePathSegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.trim() ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function resolveImprovementApiRoute(requestPath: string): ImprovementApiRoute | undefined {
  const normalized = normalizeApiPath(requestPath);
  if (normalized === `${IMPROVEMENT_API_PREFIX}/proposals`) {
    return { kind: "list" };
  }
  if (normalized === `${IMPROVEMENT_API_PREFIX}/metrics`) {
    return { kind: "metrics" };
  }
  if (normalized === `${IMPROVEMENT_API_PREFIX}/run`) {
    return { kind: "run" };
  }
  const match = normalized.match(
    /^\/improvements\/api\/proposals\/([^/]+)(?:\/(review|apply|verify|rollback))?$/,
  );
  if (!match) {
    return undefined;
  }
  const proposalId = decodePathSegment(match[1]);
  if (!proposalId) {
    return undefined;
  }
  const action = match[2];
  if (!action) {
    return { kind: "detail", proposalId };
  }
  if (action === "review") {
    return { kind: "review", proposalId };
  }
  if (action === "apply") {
    return { kind: "apply", proposalId };
  }
  if (action === "verify") {
    return { kind: "verify", proposalId };
  }
  return { kind: "rollback", proposalId };
}

function readCsvSearchParams(searchParams: URLSearchParams, key: string): string[] {
  return searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseListFilters(req: IncomingMessage): {
  statuses?: Array<(typeof IMPROVEMENT_STATUS_VALUES)[number]>;
  kinds?: Array<(typeof IMPROVEMENT_KIND_VALUES)[number]>;
  limit?: number;
} {
  const url = new URL(req.url ?? "/", "http://localhost");
  const statuses = readCsvSearchParams(url.searchParams, "status").filter((value) =>
    (IMPROVEMENT_STATUS_VALUES as readonly string[]).includes(value),
  ) as Array<(typeof IMPROVEMENT_STATUS_VALUES)[number]>;
  const kinds = readCsvSearchParams(url.searchParams, "kind").filter((value) =>
    (IMPROVEMENT_KIND_VALUES as readonly string[]).includes(value),
  ) as Array<(typeof IMPROVEMENT_KIND_VALUES)[number]>;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  return {
    ...(statuses.length > 0 ? { statuses } : {}),
    ...(kinds.length > 0 ? { kinds } : {}),
    ...(Number.isFinite(limit) ? { limit } : {}),
  };
}

function resolveImprovementErrorStatus(error: ImprovementCenterError): number {
  switch (error.code) {
    case "not_found":
      return 404;
    case "policy_blocked":
    case "review_required":
    case "apply_not_supported":
    case "rollback_not_supported":
    case "verification_failed":
      return 409;
  }
  return 500;
}

async function sendImprovementProposalDetail(params: {
  res: ServerResponse;
  headOnly: boolean;
  workspaceDir: string;
  proposalId: string;
}) {
  const detail = await getImprovementProposalDetail(
    { workspaceDir: params.workspaceDir },
    params.proposalId,
  );
  sendJson(
    params.res,
    200,
    {
      workspaceDir: params.workspaceDir,
      proposal: buildImprovementDetailView(detail),
    },
    params.headOnly,
  );
}

export function renderImprovementCenterHtml(
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
    <title>Improvement Center</title>
    <link rel="stylesheet" href="/improvements/styles.css" />
  </head>
  <body>
    <main id="app" class="improvement-center" aria-live="polite"></main>
    <script>window.__CRAWCLAW_IMPROVEMENT_BOOTSTRAP__ = ${escapeJsonForScript(bootstrap)};</script>
    <script type="module" src="/improvements/app.js"></script>
  </body>
</html>`;
}

export function renderImprovementCenterCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --panel-soft: #f8fafc;
  --text: #182230;
  --muted: #667085;
  --border: #d7dde7;
  --accent: #0f766e;
  --accent-soft: #d9f3ef;
  --danger: #b42318;
  --warning: #9a6700;
  --ok: #087443;
  --code: #111827;
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
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  padding: 7px 10px;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
button:disabled {
  color: #98a2b3;
  cursor: not-allowed;
  background: #f2f4f7;
}
.improvement-center {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
  grid-template-rows: 58px minmax(0, 1fr);
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
.brand span {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.locale-toggle { display: inline-flex; gap: 4px; }
.locale-toggle button[aria-pressed="true"] {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--panel);
}
.inbox {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}
.detail {
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
.filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.filters select {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  background: #fff;
}
.list, .detail-body {
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
.proposal-row {
  width: 100%;
  text-align: left;
  display: grid;
  gap: 7px;
  border-radius: 8px;
  padding: 11px;
  margin-bottom: 8px;
  background: var(--panel);
}
.proposal-row[aria-selected="true"] {
  border-color: var(--accent);
  box-shadow: inset 3px 0 0 var(--accent);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.between { justify-content: space-between; }
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.muted { color: var(--muted); }
.mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-soft);
  color: var(--muted);
  font-size: 12px;
  max-width: 100%;
}
.badge.low, .badge.applied, .badge.approved { color: var(--ok); background: #dff8eb; border-color: #a7e4c3; }
.badge.medium, .badge.pending { color: var(--warning); background: #fff4d8; border-color: #f8dc8c; }
.badge.high, .badge.failed, .badge.blocked { color: var(--danger); background: #fee4e2; border-color: #fecdca; }
.section {
  display: grid;
  gap: 9px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.section:first-child { padding-top: 0; }
.section h2 {
  margin: 0;
  font-size: 16px;
  letter-spacing: 0;
}
.section p { margin: 0; line-height: 1.5; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.confirm-box {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-soft);
  display: grid;
  gap: 10px;
}
.action-help {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}
.list-lines {
  margin: 0;
  padding-left: 18px;
  line-height: 1.55;
}
.kv {
  display: grid;
  grid-template-columns: minmax(110px, 160px) minmax(0, 1fr);
  gap: 7px 10px;
}
.kv dt { color: var(--muted); }
.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.code-block {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--code);
  color: #f9fafb;
  border-radius: 8px;
  padding: 12px;
  line-height: 1.45;
  max-height: 360px;
  overflow: auto;
}
.empty, .error-state {
  padding: 24px;
  color: var(--muted);
  text-align: center;
  line-height: 1.5;
}
.token-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  margin-top: 10px;
}
.token-row input {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
}
@media (max-width: 860px) {
  .improvement-center {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto minmax(0, 1fr);
  }
  .topbar {
    align-items: flex-start;
    flex-direction: column;
    padding: 12px;
  }
  .top-actions { justify-content: flex-start; }
  .inbox {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    max-height: 46vh;
  }
}
`;
}

export function renderImprovementCenterJs(): string {
  return `
const bootstrap = window.__CRAWCLAW_IMPROVEMENT_BOOTSTRAP__ || {};
const localeKey = bootstrap.localeStorageKey || "${LOCALE_STORAGE_KEY}";
const text = {
  en: {
    subtitle: "Review reusable work before CrawClaw changes anything",
    runScan: "Run scan",
    refresh: "Refresh",
    inbox: "Inbox",
    detail: "Proposal detail",
    noProposals: "No improvement proposals yet. Run a scan to find repeated, validated work that could become a Skill or Workflow.",
    selectProposal: "Select a proposal to review what CrawClaw noticed.",
    status: "Status",
    kind: "Kind",
    all: "All",
    updated: "Updated",
    evidence: "Evidence",
    summary: "Summary",
    why: "What CrawClaw noticed",
    safety: "Safety check",
    change: "What will change",
    verification: "Verification plan",
    rollback: "Rollback plan",
    patch: "Patch preview",
    technical: "Technical details",
    actions: "Actions",
    approve: "Approve",
    reject: "Reject",
    apply: "Apply",
    verify: "Verify",
    rollbackAction: "Rollback",
    approveHelp: "Approve records human approval. It does not apply the change yet.",
    rejectHelp: "Reject closes the proposal without changing files.",
    applyHelp: "Apply writes the approved Skill or Workflow change.",
    verifyHelp: "Verify runs the proposal checks.",
    rollbackHelp: "Rollback restores the recorded application artifact.",
    confirmApply: "Apply this approved proposal now?",
    confirmRollback: "Rollback this applied proposal now?",
    confirmReject: "Reject this proposal without changing files?",
    confirmContinue: "Continue",
    confirmCancel: "Cancel",
    connectError: "Gateway connection failed. Check auth and reload.",
    token: "Gateway token",
    saveToken: "Save token",
    metrics: "Metrics",
  },
  "zh-CN": {
    subtitle: "先看懂、审批，再让 CrawClaw 改动",
    runScan: "运行扫描",
    refresh: "刷新",
    inbox: "收件箱",
    detail: "提案详情",
    noProposals: "还没有改进提案。可以运行一次扫描，查找已经验证过、可复用的重复工作。",
    selectProposal: "选择一个提案，查看 CrawClaw 发现了什么。",
    status: "状态",
    kind: "类型",
    all: "全部",
    updated: "更新",
    evidence: "证据",
    summary: "摘要",
    why: "CrawClaw 发现了什么",
    safety: "安全检查",
    change: "会改变什么",
    verification: "验证计划",
    rollback: "回滚计划",
    patch: "改动预览",
    technical: "技术细节",
    actions: "操作",
    approve: "批准",
    reject: "拒绝",
    apply: "应用",
    verify: "验证",
    rollbackAction: "回滚",
    approveHelp: "批准只记录人工审批，还不会应用改动。",
    rejectHelp: "拒绝会关闭提案，不会改文件。",
    applyHelp: "应用会写入已批准的 Skill 或 Workflow 改动。",
    verifyHelp: "验证会运行提案检查。",
    rollbackHelp: "回滚会恢复已记录的应用产物。",
    confirmApply: "现在应用这个已批准的提案吗？",
    confirmRollback: "现在回滚这个已应用的提案吗？",
    confirmReject: "拒绝这个提案且不改动文件吗？",
    confirmContinue: "继续",
    confirmCancel: "取消",
    connectError: "Gateway 连接失败。请检查认证后刷新。",
    token: "Gateway token",
    saveToken: "保存 token",
    metrics: "指标",
  },
};
const state = {
  locale: resolveLocale(),
  proposals: [],
  selectedId: "",
  detail: null,
  metrics: null,
  statusFilter: "",
  kindFilter: "",
  workspaceDir: "",
  error: "",
  busy: "",
  confirmAction: "",
};
const statuses = ["", "pending_review", "approved", "policy_blocked", "failed", "applied", "rolled_back", "rejected", "draft", "superseded"];
const kinds = ["", "skill", "workflow", "code"];
const actionLabels = {
  approve: "approve",
  reject: "reject",
  apply: "apply",
  verify: "verify",
  rollback: "rollbackAction",
};
const actionHelp = {
  approve: "approveHelp",
  reject: "rejectHelp",
  apply: "applyHelp",
  verify: "verifyHelp",
  rollback: "rollbackHelp",
};
const actionMethods = {
  apply: "improvement.apply",
  verify: "improvement.verify",
  rollback: "improvement.rollback",
};
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
  return new Date(value).toLocaleString(state.locale, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function gatewayToken() {
  return localStorage.getItem("crawclaw.gateway.token") || "";
}
function saveGatewayToken() {
  const input = document.querySelector("[data-token-input]");
  localStorage.setItem("crawclaw.gateway.token", input?.value || "");
  state.error = "";
  loadInbox();
}
function apiHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = gatewayToken();
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}
async function api(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: apiHeaders(init.headers || {}),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const errorBody = payload && typeof payload === "object" ? payload.error || payload : {};
    const error = new Error(errorBody.details || errorBody.message || String(payload || "Request failed"));
    error.payload = payload;
    throw error;
  }
  return payload;
}
async function postJson(path, body = {}) {
  return await api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function loadInbox() {
  state.busy = "load";
  state.error = "";
  render();
  try {
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (state.statusFilter) params.set("status", state.statusFilter);
    if (state.kindFilter) params.set("kind", state.kindFilter);
    const [list, metrics] = await Promise.all([
      api("/improvements/api/proposals?" + params.toString()),
      api("/improvements/api/metrics"),
    ]);
    state.workspaceDir = list.workspaceDir || "";
    state.proposals = list.proposals || [];
    state.metrics = metrics.metrics || null;
    if (!state.selectedId && state.proposals.length) state.selectedId = state.proposals[0].id;
    if (state.selectedId) await loadDetail(state.selectedId, false);
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}
async function loadDetail(id, doRender = true) {
  state.selectedId = id;
  state.confirmAction = "";
  if (doRender) render();
  try {
    const result = await api("/improvements/api/proposals/" + encodeURIComponent(id));
    state.workspaceDir = result.workspaceDir || state.workspaceDir;
    state.detail = result.proposal;
  } catch (error) {
    state.error = error.message || String(error);
  }
}
async function runScan() {
  state.busy = "scan";
  state.confirmAction = "";
  render();
  try {
    const result = await postJson("/improvements/api/run");
    if (result.proposalId) {
      state.selectedId = result.proposalId;
    }
    await loadInbox();
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}
async function act(action) {
  if (!state.detail) return;
  const requiresConfirm = action === "apply" || action === "rollback" || action === "reject";
  if (requiresConfirm && state.confirmAction !== action) {
    state.confirmAction = action;
    render();
    return;
  }
  state.busy = action;
  state.confirmAction = "";
  render();
  try {
    let result;
    if (action === "approve") {
      result = await postJson(
        "/improvements/api/proposals/" + encodeURIComponent(state.detail.id) + "/review",
        { approved: true, reviewer: "browser-ui" },
      );
    } else if (action === "reject") {
      result = await postJson(
        "/improvements/api/proposals/" + encodeURIComponent(state.detail.id) + "/review",
        { approved: false, reviewer: "browser-ui" },
      );
    } else {
      result = await postJson(
        "/improvements/api/proposals/" +
          encodeURIComponent(state.detail.id) +
          "/" +
          action,
      );
    }
    state.detail = result.proposal;
    state.selectedId = result.proposal.id;
    await loadInbox();
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.busy = "";
    render();
  }
}
function cancelConfirmAction() {
  state.confirmAction = "";
  render();
}
function badgeClass(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("low") || raw.includes("applied") || raw.includes("approved")) return "low";
  if (raw.includes("medium") || raw.includes("review")) return "medium";
  if (raw.includes("high") || raw.includes("blocked") || raw.includes("failed")) return "high";
  return "";
}
function renderTokenInput() {
  return '<div class="token-row"><input data-token-input type="password" autocomplete="off" placeholder="' + escapeHtml(t("token")) + '" value="' + escapeHtml(gatewayToken()) + '" /><button data-save-token>' + escapeHtml(t("saveToken")) + '</button></div>';
}
function renderInbox() {
  const rows = state.proposals.map((item) => {
    const selected = item.id === state.selectedId;
    return '<button class="proposal-row" data-proposal="' + escapeHtml(item.id) + '" aria-selected="' + selected + '">' +
      '<div class="row between"><strong class="truncate">' + escapeHtml(item.title) + '</strong><span class="muted">' + escapeHtml(fmtTime(item.updatedAt)) + '</span></div>' +
      '<div class="row"><span class="badge">' + escapeHtml(item.kindLabel) + '</span><span class="badge ' + badgeClass(item.statusLabel) + '">' + escapeHtml(item.statusLabel) + '</span><span class="badge ' + badgeClass(item.riskLabel) + '">' + escapeHtml(item.riskLabel) + '</span></div>' +
      '<div class="muted truncate">' + escapeHtml(item.signalSummary) + '</div>' +
    '</button>';
  }).join("");
  const empty = '<div class="empty">' + escapeHtml(t("noProposals")) + '</div>';
  return '<section class="pane inbox"><div class="pane-head"><div class="row between"><span class="pane-title">' + escapeHtml(t("inbox")) + '</span><button data-refresh>' + escapeHtml(t("refresh")) + '</button></div>' +
    '<div class="filters"><select data-status-filter>' + statuses.map((status) => '<option value="' + status + '"' + (state.statusFilter === status ? " selected" : "") + '>' + escapeHtml(status || t("status") + ": " + t("all")) + '</option>').join("") + '</select>' +
    '<select data-kind-filter>' + kinds.map((kind) => '<option value="' + kind + '"' + (state.kindFilter === kind ? " selected" : "") + '>' + escapeHtml(kind || t("kind") + ": " + t("all")) + '</option>').join("") + '</select></div></div>' +
    '<div class="list">' + (state.error ? '<div class="error-state">' + escapeHtml(t("connectError")) + '<br />' + escapeHtml(state.error) + renderTokenInput() + '</div>' : rows || empty) + '</div></section>';
}
function renderList(title, items) {
  const values = items?.length ? items : ["-"];
  return '<section class="section"><h2>' + escapeHtml(title) + '</h2><ul class="list-lines">' + values.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul></section>';
}
function renderEvidence(items) {
  return '<section class="section"><h2>' + escapeHtml(t("evidence")) + '</h2><dl class="kv">' + (items || []).map((item) => '<dt>' + escapeHtml(item.label) + '</dt><dd>' + escapeHtml(item.value) + '</dd>').join("") + '</dl></section>';
}
function renderActions(detail) {
  const available = new Set(detail.availableActions || []);
  const disabled = new Map((detail.disabledActions || []).map((item) => [item.action, item.reason]));
  const allActions = ["approve", "reject", "apply", "verify", "rollback"];
  const buttons = allActions.map((action) => {
    const isAvailable = available.has(action);
    const reason = disabled.get(action);
    return '<div><button data-action="' + action + '"' + (isAvailable ? "" : " disabled") + '>' + escapeHtml(t(actionLabels[action])) + '</button>' +
      '<div class="action-help">' + escapeHtml(isAvailable ? t(actionHelp[action]) : reason || "") + '</div></div>';
  }).join("");
  const confirmMessage = state.confirmAction === "apply"
    ? t("confirmApply")
    : state.confirmAction === "rollback"
      ? t("confirmRollback")
      : state.confirmAction === "reject"
        ? t("confirmReject")
        : "";
  const confirmBox = confirmMessage
    ? '<div class="confirm-box"><div class="action-help">' + escapeHtml(confirmMessage) + '</div><div class="actions"><button data-confirm-action="' + escapeHtml(state.confirmAction) + '">' + escapeHtml(t("confirmContinue")) + '</button><button data-confirm-cancel>' + escapeHtml(t("confirmCancel")) + '</button></div></div>'
    : "";
  return '<section class="section"><h2>' + escapeHtml(t("actions")) + '</h2><div class="actions">' + buttons + '</div>' + confirmBox + '</section>';
}
function renderDetail() {
  const detail = state.detail;
  if (!detail) {
    return '<section class="pane detail"><div class="detail-body"><div class="empty">' + escapeHtml(t("selectProposal")) + '</div></div></section>';
  }
  return '<section class="pane detail"><div class="pane-head"><div class="row between"><span class="pane-title">' + escapeHtml(t("detail")) + '</span><span class="mono muted">' + escapeHtml(detail.id) + '</span></div>' +
    '<div class="row"><span class="badge">' + escapeHtml(detail.kindLabel) + '</span><span class="badge ' + badgeClass(detail.statusLabel) + '">' + escapeHtml(detail.statusLabel) + '</span><span class="badge ' + badgeClass(detail.riskLabel) + '">' + escapeHtml(detail.riskLabel) + '</span><span class="badge">' + escapeHtml(detail.confidenceLabel) + '</span></div></div>' +
    '<div class="detail-body">' +
    '<section class="section"><h2>' + escapeHtml(t("summary")) + '</h2><p>' + escapeHtml(detail.plainSummary) + '</p></section>' +
    '<section class="section"><h2>' + escapeHtml(t("why")) + '</h2><p>' + escapeHtml(detail.primaryReason) + '</p></section>' +
    '<section class="section"><h2>' + escapeHtml(t("safety")) + '</h2><p>' + escapeHtml(detail.safetySummary) + '</p></section>' +
    '<section class="section"><h2>' + escapeHtml(t("change")) + '</h2><p>' + escapeHtml(detail.changeSummary) + '</p></section>' +
    renderActions(detail) +
    renderEvidence(detail.evidenceItems) +
    renderList(t("verification"), detail.verificationPlan) +
    renderList(t("rollback"), detail.rollbackPlan) +
    '<section class="section"><h2>' + escapeHtml(t("patch")) + '</h2><p>' + escapeHtml(detail.patchPreview?.title || "") + '</p><pre class="code-block">' + escapeHtml((detail.patchPreview?.lines || []).join("\\n")) + '</pre></section>' +
    '<section class="section"><h2>' + escapeHtml(t("technical")) + '</h2><pre class="code-block">' + escapeHtml(JSON.stringify(detail.technicalDetails || {}, null, 2)) + '</pre></section>' +
    '</div></section>';
}
function render() {
  const app = document.getElementById("app");
  const total = state.metrics?.total ?? state.proposals.length;
  app.innerHTML = '<header class="topbar"><div class="brand"><strong>Improvement Center</strong><span>' + escapeHtml(t("subtitle")) + (state.workspaceDir ? " · " + escapeHtml(state.workspaceDir) : "") + '</span></div>' +
    '<div class="top-actions"><span class="badge">' + escapeHtml(t("metrics")) + ': ' + escapeHtml(total) + '</span><button data-run-scan' + (state.busy ? " disabled" : "") + '>' + escapeHtml(t("runScan")) + '</button><div class="locale-toggle"><button data-locale="en" aria-pressed="' + (state.locale === "en") + '">EN</button><button data-locale="zh-CN" aria-pressed="' + (state.locale === "zh-CN") + '">中文</button></div></div></header>' +
    renderInbox() + renderDetail();
  document.documentElement.lang = state.locale;
  document.querySelector("[data-run-scan]")?.addEventListener("click", runScan);
  document.querySelector("[data-refresh]")?.addEventListener("click", loadInbox);
  document.querySelector("[data-save-token]")?.addEventListener("click", saveGatewayToken);
  document.querySelector("[data-status-filter]")?.addEventListener("change", (event) => { state.statusFilter = event.target.value; state.selectedId = ""; state.detail = null; loadInbox(); });
  document.querySelector("[data-kind-filter]")?.addEventListener("change", (event) => { state.kindFilter = event.target.value; state.selectedId = ""; state.detail = null; loadInbox(); });
  document.querySelectorAll("[data-proposal]").forEach((button) => button.addEventListener("click", () => loadDetail(button.dataset.proposal)));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => act(button.dataset.action)));
  document.querySelectorAll("[data-confirm-action]").forEach((button) => button.addEventListener("click", () => act(button.dataset.confirmAction)));
  document.querySelectorAll("[data-confirm-cancel]").forEach((button) => button.addEventListener("click", cancelConfirmAction));
  document.querySelectorAll("[data-locale]").forEach((button) => button.addEventListener("click", () => setLocale(button.dataset.locale)));
}
render();
loadInbox();
`;
}

async function handleImprovementCenterApiRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestPath: string;
  workspaceDir: string;
  config?: CrawClawConfig;
}): Promise<boolean> {
  const route = resolveImprovementApiRoute(params.requestPath);
  if (!route) {
    sendJson(params.res, 404, { error: { message: "Not Found" } }, false);
    return true;
  }

  const method = (params.req.method ?? "GET").toUpperCase();
  const headOnly = method === "HEAD";

  const sendMethodNotAllowed = (allow: string) => {
    params.res.statusCode = 405;
    params.res.setHeader("Allow", allow);
    params.res.setHeader("Content-Type", "text/plain; charset=utf-8");
    params.res.end("Method Not Allowed");
  };

  try {
    switch (route.kind) {
      case "list": {
        if (method !== "GET" && method !== "HEAD") {
          sendMethodNotAllowed("GET, HEAD");
          return true;
        }
        const proposals = await listImprovementProposals(
          { workspaceDir: params.workspaceDir },
          parseListFilters(params.req),
        );
        sendJson(
          params.res,
          200,
          {
            workspaceDir: params.workspaceDir,
            proposals: proposals.map((proposal) => buildImprovementListViewItem(proposal)),
          },
          headOnly,
        );
        return true;
      }
      case "metrics": {
        if (method !== "GET" && method !== "HEAD") {
          sendMethodNotAllowed("GET, HEAD");
          return true;
        }
        const metrics = await summarizeImprovementMetrics({ workspaceDir: params.workspaceDir });
        sendJson(params.res, 200, { workspaceDir: params.workspaceDir, metrics }, headOnly);
        return true;
      }
      case "detail": {
        if (method !== "GET" && method !== "HEAD") {
          sendMethodNotAllowed("GET, HEAD");
          return true;
        }
        await sendImprovementProposalDetail({
          res: params.res,
          headOnly,
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
        });
        return true;
      }
      case "run": {
        if (method !== "POST") {
          sendMethodNotAllowed("POST");
          return true;
        }
        const result = await runImprovementScan({
          workspaceDir: params.workspaceDir,
          config: params.config,
        });
        sendJson(
          params.res,
          200,
          {
            workspaceDir: params.workspaceDir,
            run: result.run,
            proposalId: result.proposal?.id,
          },
          false,
        );
        return true;
      }
      case "review": {
        if (method !== "POST") {
          sendMethodNotAllowed("POST");
          return true;
        }
        const body = await readJsonBody(params.req, IMPROVEMENT_BODY_LIMIT_BYTES);
        if (!body.ok) {
          sendJson(params.res, 400, { error: { message: body.error } }, false);
          return true;
        }
        const parsed = reviewRequestSchema.safeParse(body.value);
        if (!parsed.success) {
          sendJson(
            params.res,
            400,
            { error: { message: parsed.error.issues.map((issue) => issue.message).join("; ") } },
            false,
          );
          return true;
        }
        await reviewImprovementProposal({
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
          approved: parsed.data.approved,
          reviewer: parsed.data.reviewer ?? "browser-ui",
          comments: parsed.data.comments,
        });
        await sendImprovementProposalDetail({
          res: params.res,
          headOnly: false,
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
        });
        return true;
      }
      case "apply": {
        if (method !== "POST") {
          sendMethodNotAllowed("POST");
          return true;
        }
        await applyImprovementProposal({
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
          config: params.config,
        });
        await sendImprovementProposalDetail({
          res: params.res,
          headOnly: false,
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
        });
        return true;
      }
      case "verify": {
        if (method !== "POST") {
          sendMethodNotAllowed("POST");
          return true;
        }
        await verifyImprovementProposal({
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
          config: params.config,
        });
        await sendImprovementProposalDetail({
          res: params.res,
          headOnly: false,
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
        });
        return true;
      }
      case "rollback": {
        if (method !== "POST") {
          sendMethodNotAllowed("POST");
          return true;
        }
        await rollbackImprovementProposal({
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
        });
        await sendImprovementProposalDetail({
          res: params.res,
          headOnly: false,
          workspaceDir: params.workspaceDir,
          proposalId: route.proposalId,
        });
        return true;
      }
    }
    return true;
  } catch (error) {
    if (error instanceof ImprovementCenterError) {
      const userError = mapImprovementCenterError(error.code);
      sendJson(
        params.res,
        resolveImprovementErrorStatus(error),
        {
          error: {
            code: error.code,
            title: userError.title,
            message: userError.message,
            details: error.message,
          },
        },
        false,
      );
      return true;
    }
    sendJson(
      params.res,
      500,
      {
        error: {
          code: "internal_error",
          message: error instanceof Error ? error.message : "Internal Server Error",
        },
      },
      false,
    );
    return true;
  }
}

export async function handleImprovementCenterHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestPath: string;
  bootstrapLocale?: unknown;
  workspaceDir?: string;
  config?: CrawClawConfig;
}): Promise<boolean> {
  if (!isImprovementCenterRequestPath(params.requestPath)) {
    return false;
  }
  if (
    params.requestPath === IMPROVEMENT_API_PREFIX ||
    params.requestPath.startsWith(`${IMPROVEMENT_API_PREFIX}/`)
  ) {
    return await handleImprovementCenterApiRequest({
      req: params.req,
      res: params.res,
      requestPath: params.requestPath,
      workspaceDir: params.workspaceDir ?? process.cwd(),
      config: params.config,
    });
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
      renderImprovementCenterJs(),
      headOnly,
    );
    return true;
  }
  if (params.requestPath.endsWith("/styles.css")) {
    sendText(params.res, 200, "text/css; charset=utf-8", renderImprovementCenterCss(), headOnly);
    return true;
  }
  sendText(
    params.res,
    200,
    "text/html; charset=utf-8",
    renderImprovementCenterHtml({ bootstrapLocale: params.bootstrapLocale }),
    headOnly,
  );
  return true;
}

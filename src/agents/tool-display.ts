import { redactToolDetail } from "../logging/redact.js";
import { shortenHomeInString } from "../utils.js";
import {
  defaultTitle,
  formatToolDetailText,
  formatDetailKey,
  normalizeToolName,
  resolveToolVerbAndDetailForArgs,
  type ToolDisplaySpec as ToolDisplaySpecBase,
} from "./tool-display-common.js";
import TOOL_DISPLAY_OVERRIDES_JSON from "./tool-display-overrides.json" with { type: "json" };
import SHARED_TOOL_DISPLAY_JSON from "./tool-display-shared.json" with { type: "json" };

type ToolDisplaySpec = ToolDisplaySpecBase & {
  emoji?: string;
};

type ToolDisplayConfig = {
  version?: number;
  fallback?: ToolDisplaySpec;
  tools?: Record<string, ToolDisplaySpec>;
};

export type ToolDisplay = {
  name: string;
  emoji: string;
  title: string;
  label: string;
  verb?: string;
  detail?: string;
  known: boolean;
};

export type ToolExecutionDisplayMode = "off" | "summary" | "verbose" | "full";
export type ToolExecutionDisplayPhase = "start" | "update" | "end" | "error" | "waiting";

type ExecutionPhrase = {
  start: string;
  end: string;
  error: string;
  detailSeparator?: "space" | "colon";
};

const SHARED_TOOL_DISPLAY_CONFIG = SHARED_TOOL_DISPLAY_JSON as ToolDisplayConfig;
const TOOL_DISPLAY_OVERRIDES = TOOL_DISPLAY_OVERRIDES_JSON as ToolDisplayConfig;
const FALLBACK = TOOL_DISPLAY_OVERRIDES.fallback ??
  SHARED_TOOL_DISPLAY_CONFIG.fallback ?? { emoji: "🧩" };
const TOOL_MAP = Object.assign({}, SHARED_TOOL_DISPLAY_CONFIG.tools, TOOL_DISPLAY_OVERRIDES.tools);
const TOOL_EXECUTION_PHRASES: Record<string, ExecutionPhrase> = {
  bash: { start: "Running", end: "Ran", error: "Run" },
  exec: { start: "Running", end: "Ran", error: "Run" },
  read: { start: "Reading", end: "Read", error: "Read" },
  write: { start: "Writing", end: "Wrote", error: "Write" },
  edit: { start: "Editing", end: "Edited", error: "Edit" },
  attach: { start: "Attaching", end: "Attached", error: "Attach" },
  web_search: { start: "Searching", end: "Searched", error: "Search" },
  web_fetch: { start: "Fetching", end: "Fetched", error: "Fetch" },
  sessions_list: {
    start: "Listing sessions",
    end: "Listed sessions",
    error: "List sessions",
    detailSeparator: "colon",
  },
  sessions_history: {
    start: "Reading session history",
    end: "Read session history",
    error: "Read session history",
    detailSeparator: "colon",
  },
  sessions_send: {
    start: "Sending session message",
    end: "Sent session message",
    error: "Send session message",
    detailSeparator: "colon",
  },
  sessions_spawn: {
    start: "Starting sub-agent",
    end: "Started sub-agent",
    error: "Start sub-agent",
    detailSeparator: "colon",
  },
};
const VERB_EXECUTION_PHRASES: Record<string, ExecutionPhrase> = {
  add: { start: "Adding", end: "Added", error: "Add" },
  approve: { start: "Approving", end: "Approved", error: "Approve" },
  close: { start: "Closing", end: "Closed", error: "Close" },
  delete: { start: "Deleting", end: "Deleted", error: "Delete" },
  edit: { start: "Editing", end: "Edited", error: "Edit" },
  fetch: { start: "Fetching", end: "Fetched", error: "Fetch" },
  list: { start: "Listing", end: "Listed", error: "List" },
  navigate: { start: "Navigating", end: "Navigated", error: "Navigate" },
  notify: { start: "Notifying", end: "Notified", error: "Notify" },
  open: { start: "Opening", end: "Opened", error: "Open" },
  poll: { start: "Creating poll", end: "Created poll", error: "Create poll" },
  react: { start: "Reacting", end: "Reacted", error: "React" },
  read: { start: "Reading", end: "Read", error: "Read" },
  remove: { start: "Removing", end: "Removed", error: "Remove" },
  restart: { start: "Restarting", end: "Restarted", error: "Restart" },
  run: { start: "Running", end: "Ran", error: "Run" },
  search: { start: "Searching", end: "Searched", error: "Search" },
  send: { start: "Sending", end: "Sent", error: "Send" },
  status: { start: "Checking status", end: "Checked status", error: "Check status" },
  update: { start: "Updating", end: "Updated", error: "Update" },
  wait: { start: "Waiting", end: "Waited", error: "Wait" },
  write: { start: "Writing", end: "Wrote", error: "Write" },
};
const DETAIL_LABEL_OVERRIDES: Record<string, string> = {
  agentId: "agent",
  sessionKey: "session",
  targetId: "target",
  targetUrl: "url",
  nodeId: "node",
  requestId: "request",
  messageId: "message",
  threadId: "thread",
  channelId: "channel",
  guildId: "guild",
  userId: "user",
  runTimeoutSeconds: "timeout",
  timeoutSeconds: "timeout",
  includeTools: "tools",
  pollQuestion: "poll",
  maxChars: "max chars",
};
const MAX_DETAIL_ENTRIES = 8;

export function resolveToolDisplay(params: {
  name?: string;
  args?: unknown;
  meta?: string;
}): ToolDisplay {
  const name = normalizeToolName(params.name);
  const key = name.toLowerCase();
  const spec = TOOL_MAP[key];
  const emoji = spec?.emoji ?? FALLBACK.emoji ?? "🧩";
  const title = spec?.title ?? defaultTitle(name);
  const label = spec?.label ?? title;
  let { verb, detail } = resolveToolVerbAndDetailForArgs({
    toolKey: key,
    args: params.args,
    meta: params.meta,
    spec,
    fallbackDetailKeys: FALLBACK.detailKeys,
    detailMode: "summary",
    detailMaxEntries: MAX_DETAIL_ENTRIES,
    detailFormatKey: (raw) => formatDetailKey(raw, DETAIL_LABEL_OVERRIDES),
  });

  if (detail) {
    detail = shortenHomeInString(detail);
  }

  return {
    name,
    emoji,
    title,
    label,
    verb,
    detail,
    known: Boolean(spec),
  };
}

export function formatToolDetail(display: ToolDisplay): string | undefined {
  const detailRaw = display.detail ? redactToolDetail(display.detail) : undefined;
  return formatToolDetailText(detailRaw);
}

export function formatToolSummary(display: ToolDisplay): string {
  const detail = formatToolDetail(display);
  return detail
    ? `${display.emoji} ${display.label}: ${detail}`
    : `${display.emoji} ${display.label}`;
}

function normalizePhase(params: {
  phase: ToolExecutionDisplayPhase;
  status?: string;
}): ToolExecutionDisplayPhase {
  const status = params.status?.trim().toLowerCase();
  if (status === "failed" || status === "error") {
    return "error";
  }
  if (status === "completed" || status === "done" || status === "succeeded") {
    return "end";
  }
  if (status === "waiting" || status === "blocked" || status === "waiting_input") {
    return "waiting";
  }
  return params.phase;
}

function resolveExecutionPhrase(display: ToolDisplay): ExecutionPhrase | undefined {
  const key = display.name.toLowerCase();
  const byTool = TOOL_EXECUTION_PHRASES[key];
  if (byTool) {
    return byTool;
  }
  const verb = display.verb?.trim().toLowerCase();
  return verb ? VERB_EXECUTION_PHRASES[verb] : undefined;
}

function joinExecutionDetail(
  phrase: string,
  detail: string | undefined,
  separator: "space" | "colon" = "space",
): string {
  if (!detail) {
    return phrase;
  }
  return separator === "colon" ? `${phrase}: ${detail}` : `${phrase} ${detail}`;
}

function buildFallbackExecutionText(params: {
  label: string;
  detail?: string;
  phase: ToolExecutionDisplayPhase;
}): string {
  if (params.phase === "error") {
    return params.detail ? `${params.label} failed: ${params.detail}` : `${params.label} failed`;
  }
  return params.detail ? `${params.label}: ${params.detail}` : params.label;
}

export function buildToolExecutionDisplayText(params: {
  toolName?: string;
  args?: unknown;
  meta?: string;
  phase: ToolExecutionDisplayPhase;
  mode: ToolExecutionDisplayMode;
  status?: string;
}): string | undefined {
  if (params.mode === "off") {
    return undefined;
  }
  const display = resolveToolDisplay({
    name: params.toolName,
    args: params.args,
    meta: params.meta,
  });
  const detail = formatToolDetail(display);
  const phase = normalizePhase({ phase: params.phase, status: params.status });
  const phrase = resolveExecutionPhrase(display);

  if (!display.known || !phrase) {
    return buildFallbackExecutionText({
      label: display.title,
      detail,
      phase,
    });
  }

  if (phase === "error") {
    return detail ? `${phrase.error} failed: ${detail}` : `${phrase.error} failed`;
  }
  if (phase === "end") {
    return joinExecutionDetail(phrase.end, detail, phrase.detailSeparator);
  }
  return joinExecutionDetail(phrase.start, detail, phrase.detailSeparator);
}

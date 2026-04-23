import { stripLeadingInboundMetadata } from "../auto-reply/reply/strip-inbound-meta.js";
import { formatTuiOnOff, formatTuiStateLabel, translateTuiText } from "../cli/i18n/tui.js";
import { formatTimeAgo, formatRelativeTimestamp } from "../infra/format-time/format-relative.ts";
import { formatRawAssistantErrorForUi } from "../shared/assistant-error-format.js";
import { stripAnsi } from "../terminal/ansi.js";
import { formatTokenCount } from "../utils/usage-format.js";
import type { GatewayStatusSummary } from "./tui-types.js";

const REPLACEMENT_CHAR_RE = /\uFFFD/g;
const MAX_TOKEN_CHARS = 32;
const LONG_TOKEN_RE = /\S{33,}/g;
const LONG_TOKEN_TEST_RE = /\S{33,}/;
const BINARY_LINE_REPLACEMENT_THRESHOLD = 12;
const URL_PREFIX_RE = /^(https?:\/\/|file:\/\/)/i;
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const FILE_LIKE_RE = /^[a-zA-Z0-9._-]+$/;
const EDGE_PUNCTUATION_RE = /^[`"'([{<]+|[`"')\]}>.,:;!?]+$/g;
const TOKENISH_MIN_LENGTH = 24;
const RTL_SCRIPT_RE = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const BIDI_CONTROL_RE = /[\u202a-\u202e\u2066-\u2069]/;
const RTL_ISOLATE_START = "\u2067";
const RTL_ISOLATE_END = "\u2069";

function hasControlChars(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    const isAsciiControl = code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    const isC1Control = code >= 0x7f && code <= 0x9f;
    if (isAsciiControl || isC1Control) {
      return true;
    }
  }
  return false;
}

function stripControlChars(text: string): string {
  if (!hasControlChars(text)) {
    return text;
  }
  let sanitized = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    const isAsciiControl = code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    const isC1Control = code >= 0x7f && code <= 0x9f;
    if (!isAsciiControl && !isC1Control) {
      sanitized += char;
    }
  }
  return sanitized;
}

function chunkToken(token: string, maxChars: number): string[] {
  if (token.length <= maxChars) {
    return [token];
  }
  const chunks: string[] = [];
  for (let i = 0; i < token.length; i += maxChars) {
    chunks.push(token.slice(i, i + maxChars));
  }
  return chunks;
}

function isCopySensitiveToken(token: string): boolean {
  const coreToken = token.replace(EDGE_PUNCTUATION_RE, "");
  const candidate = coreToken || token;

  if (URL_PREFIX_RE.test(token)) {
    return true;
  }
  if (
    token.startsWith("/") ||
    token.startsWith("~/") ||
    token.startsWith("./") ||
    token.startsWith("../")
  ) {
    return true;
  }
  if (WINDOWS_DRIVE_RE.test(token) || token.startsWith("\\\\")) {
    return true;
  }
  if (token.includes("/") || token.includes("\\")) {
    return true;
  }
  if (token.includes("_") && FILE_LIKE_RE.test(token)) {
    return true;
  }

  // Preserve long credential-like tokens (hex/base62/etc.) to avoid introducing
  // visible spaces that users may copy back into secrets.
  if (candidate.length >= TOKENISH_MIN_LENGTH && /[a-z]/i.test(candidate) && /\d/.test(candidate)) {
    return true;
  }
  return false;
}

function normalizeLongTokenForDisplay(token: string): string {
  // Preserve copy-sensitive tokens exactly (paths/urls/file-like names).
  if (isCopySensitiveToken(token)) {
    return token;
  }
  return chunkToken(token, MAX_TOKEN_CHARS).join(" ");
}

function redactBinaryLikeLine(line: string): string {
  const replacementCount = (line.match(REPLACEMENT_CHAR_RE) || []).length;
  if (
    replacementCount >= BINARY_LINE_REPLACEMENT_THRESHOLD &&
    replacementCount * 2 >= line.length
  ) {
    return "[binary data omitted]";
  }
  return line;
}

function isolateRtlLine(line: string): string {
  if (!RTL_SCRIPT_RE.test(line) || BIDI_CONTROL_RE.test(line)) {
    return line;
  }
  return `${RTL_ISOLATE_START}${line}${RTL_ISOLATE_END}`;
}

function applyRtlIsolation(text: string): string {
  if (!RTL_SCRIPT_RE.test(text)) {
    return text;
  }
  return text
    .split("\n")
    .map((line) => isolateRtlLine(line))
    .join("\n");
}

export function sanitizeRenderableText(text: string): string {
  if (!text) {
    return text;
  }

  const hasAnsi = text.includes("\u001b");
  const hasReplacementChars = text.includes("\uFFFD");
  const hasLongTokens = LONG_TOKEN_TEST_RE.test(text);
  const hasControls = hasControlChars(text);
  if (!hasAnsi && !hasReplacementChars && !hasLongTokens && !hasControls) {
    return applyRtlIsolation(text);
  }

  const withoutAnsi = hasAnsi ? stripAnsi(text) : text;
  const withoutControlChars = hasControls ? stripControlChars(withoutAnsi) : withoutAnsi;
  const redacted = hasReplacementChars
    ? withoutControlChars
        .split("\n")
        .map((line) => redactBinaryLikeLine(line))
        .join("\n")
    : withoutControlChars;
  const tokenSafe = LONG_TOKEN_TEST_RE.test(redacted)
    ? redacted.replace(LONG_TOKEN_RE, normalizeLongTokenForDisplay)
    : redacted;
  return applyRtlIsolation(tokenSafe);
}

export function resolveFinalAssistantText(params: {
  finalText?: string | null;
  streamedText?: string | null;
  errorMessage?: string | null;
}) {
  const finalText = params.finalText ?? "";
  if (finalText.trim()) {
    return finalText;
  }
  const streamedText = params.streamedText ?? "";
  if (streamedText.trim()) {
    return streamedText;
  }
  const errorMessage = params.errorMessage ?? "";
  if (errorMessage.trim()) {
    return formatRawAssistantErrorForUi(errorMessage);
  }
  return translateTuiText("tui.message.noOutput");
}

export function composeThinkingAndContent(params: {
  thinkingText?: string;
  contentText?: string;
  showThinking?: boolean;
}) {
  const thinkingText = params.thinkingText?.trim() ?? "";
  const contentText = params.contentText?.trim() ?? "";
  const parts: string[] = [];

  if (params.showThinking && thinkingText) {
    parts.push(`[thinking]\n${thinkingText}`);
  }
  if (contentText) {
    parts.push(contentText);
  }

  return parts.join("\n\n").trim();
}

function asMessageRecord(message: unknown): Record<string, unknown> | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  return message as Record<string, unknown>;
}

function resolveMessageRecord(
  message: unknown,
): { record: Record<string, unknown>; content: unknown } | undefined {
  const record = asMessageRecord(message);
  if (!record) {
    return undefined;
  }
  return { record, content: record.content };
}

function formatAssistantErrorFromRecord(record: Record<string, unknown>): string {
  const stopReason = typeof record.stopReason === "string" ? record.stopReason : "";
  if (stopReason !== "error") {
    return "";
  }
  const errorMessage = typeof record.errorMessage === "string" ? record.errorMessage : "";
  return formatRawAssistantErrorForUi(errorMessage);
}

function collectSanitizedBlockStrings(params: {
  content: unknown;
  blockType: "text" | "thinking";
  valueKey: "text" | "thinking";
}): string[] {
  if (!Array.isArray(params.content)) {
    return [];
  }
  const parts: string[] = [];
  for (const block of params.content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const rec = block as Record<string, unknown>;
    if (rec.type === params.blockType && typeof rec[params.valueKey] === "string") {
      parts.push(sanitizeRenderableText(rec[params.valueKey] as string));
    }
  }
  return parts;
}

/**
 * Extract ONLY thinking blocks from message content.
 * Model-agnostic: returns empty string if no thinking blocks exist.
 */
export function extractThinkingFromMessage(message: unknown): string {
  const resolved = resolveMessageRecord(message);
  if (!resolved) {
    return "";
  }
  const { content } = resolved;
  if (typeof content === "string") {
    return "";
  }
  const parts = collectSanitizedBlockStrings({
    content,
    blockType: "thinking",
    valueKey: "thinking",
  });
  return parts.join("\n").trim();
}

/**
 * Extract ONLY text content blocks from message (excludes thinking).
 * Model-agnostic: works for any model with text content blocks.
 */
export function extractContentFromMessage(message: unknown): string {
  const resolved = resolveMessageRecord(message);
  if (!resolved) {
    return "";
  }
  const { record, content } = resolved;

  if (typeof content === "string") {
    return sanitizeRenderableText(content).trim();
  }

  const parts = collectSanitizedBlockStrings({
    content,
    blockType: "text",
    valueKey: "text",
  });
  if (parts.length > 0) {
    return parts.join("\n").trim();
  }
  return formatAssistantErrorFromRecord(record);
}

function extractTextBlocks(content: unknown, opts?: { includeThinking?: boolean }): string {
  if (typeof content === "string") {
    return sanitizeRenderableText(content).trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const textParts = collectSanitizedBlockStrings({
    content,
    blockType: "text",
    valueKey: "text",
  });
  const thinkingParts =
    opts?.includeThinking === true
      ? collectSanitizedBlockStrings({
          content,
          blockType: "thinking",
          valueKey: "thinking",
        })
      : [];

  return composeThinkingAndContent({
    thinkingText: thinkingParts.join("\n").trim(),
    contentText: textParts.join("\n").trim(),
    showThinking: opts?.includeThinking ?? false,
  });
}

export function extractTextFromMessage(
  message: unknown,
  opts?: { includeThinking?: boolean },
): string {
  const record = asMessageRecord(message);
  if (!record) {
    return "";
  }
  const text = extractTextBlocks(record.content, opts);
  if (text) {
    if (record.role === "user") {
      return stripLeadingInboundMetadata(text);
    }
    return text;
  }

  const errorText = formatAssistantErrorFromRecord(record);
  if (!errorText) {
    return "";
  }
  return errorText;
}

export function isCommandMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  return (message as Record<string, unknown>).command === true;
}

export function formatTokens(total?: number | null, context?: number | null) {
  if (total == null && context == null) {
    return `${translateTuiText("tui.common.tokens")} ?`;
  }
  const totalLabel = total == null ? "?" : formatTokenCount(total);
  if (context == null) {
    return `${translateTuiText("tui.common.tokens")} ${totalLabel}`;
  }
  const pct =
    typeof total === "number" && context > 0
      ? Math.min(999, Math.round((total / context) * 100))
      : null;
  return `${translateTuiText("tui.common.tokens")} ${totalLabel}/${formatTokenCount(context)}${pct !== null ? ` (${pct}%)` : ""}`;
}

export function formatTuiFooterLine(params: {
  agentLabel: string;
  sessionLabel: string;
  model?: string;
  modelProvider?: string;
  totalTokens?: number | null;
  contextTokens?: number | null;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  deliverEnabled: boolean;
  hint?: string;
}) {
  const modelLabel = params.model
    ? params.modelProvider
      ? `${params.modelProvider}/${params.model}`
      : params.model
    : translateTuiText("tui.common.unknown");
  const think = params.thinkingLevel ?? "off";
  const verbose = params.verboseLevel ?? "off";
  const reasoning = params.reasoningLevel ?? "off";
  const reasoningLabel =
    reasoning === "on"
      ? translateTuiText("tui.common.reasoning")
      : reasoning === "stream"
        ? `${translateTuiText("tui.common.reasoning")}:stream`
        : null;
  const footerParts = [
    `${translateTuiText("tui.common.agent")} ${params.agentLabel}`,
    `${translateTuiText("tui.common.session")} ${params.sessionLabel}`,
    modelLabel,
    think !== "off" ? `${translateTuiText("tui.common.think")} ${think}` : null,
    params.fastMode === true ? translateTuiText("tui.common.fast") : null,
    verbose !== "off" ? `${translateTuiText("tui.common.verbose")} ${verbose}` : null,
    reasoningLabel,
    `${translateTuiText("tui.common.deliver")} ${formatTuiOnOff(params.deliverEnabled)}`,
    formatTokens(params.totalTokens ?? null, params.contextTokens ?? null),
    params.hint?.trim() || null,
  ].filter(Boolean);
  return footerParts.join(" | ");
}

type DeliveryRouteInput = {
  lastChannel?: string | null;
  lastTo?: string | null;
  lastAccountId?: string | null;
  lastThreadId?: string | number | null;
  sendPolicy?: string | null;
};

function trimOptional(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function formatDeliveryRoute(params: DeliveryRouteInput): string | null {
  const channel = trimOptional(params.lastChannel);
  const target = trimOptional(params.lastTo);
  const account = trimOptional(params.lastAccountId);
  const thread = trimOptional(params.lastThreadId);
  const route = channel && target ? `${channel}:${target}` : (channel ?? target);
  const extras = [
    account ? translateTuiText("tui.route.account", { account }) : null,
    thread ? translateTuiText("tui.route.thread", { thread }) : null,
  ].filter(Boolean);
  const routeLabel = route ? `${translateTuiText("tui.common.deliver")} ${route}` : null;
  const suffix =
    extras.length > 0
      ? translateTuiText("tui.route.extrasWithPrefix", {
          extras: extras.join(translateTuiText("tui.route.extraSeparator")),
        })
      : "";
  if (params.sendPolicy === "deny") {
    return routeLabel ? `${routeLabel}${suffix}` : translateTuiText("tui.common.sendDeny");
  }
  return routeLabel ? `${routeLabel}${suffix}` : null;
}

type SessionPickerDescriptionInput = DeliveryRouteInput & {
  updatedAt?: number | null;
  modelProvider?: string | null;
  model?: string | null;
  totalTokens?: number | null;
  contextTokens?: number | null;
  remainingTokens?: number | null;
  percentUsed?: number | null;
  fastMode?: boolean;
  verboseLevel?: string | null;
  thinkingLevel?: string | null;
  reasoningLevel?: string | null;
  status?: string | null;
  lastMessagePreview?: string | null;
};

export function formatSessionPickerDescription(session: SessionPickerDescriptionInput): string {
  const timePart =
    typeof session.updatedAt === "number"
      ? formatRelativeTimestamp(session.updatedAt, { dateFallback: true, fallback: "" })
      : "";
  const model =
    session.modelProvider && session.model
      ? `${session.modelProvider}/${session.model}`
      : (session.model ?? "");
  const tokens =
    typeof session.totalTokens === "number" || typeof session.contextTokens === "number"
      ? formatContextUsageLine({
          total: session.totalTokens ?? null,
          context: session.contextTokens ?? null,
          remaining: session.remainingTokens ?? null,
          percent: session.percentUsed ?? null,
        })
      : "";
  const flags = [
    session.status && session.status !== "done" ? session.status : null,
    session.fastMode === true ? translateTuiText("tui.common.fast") : null,
    session.verboseLevel && session.verboseLevel !== "off"
      ? `${translateTuiText("tui.common.verbose")} ${session.verboseLevel}`
      : null,
    session.thinkingLevel && session.thinkingLevel !== "off"
      ? `${translateTuiText("tui.common.think")} ${session.thinkingLevel}`
      : null,
    session.reasoningLevel && session.reasoningLevel !== "off"
      ? `${translateTuiText("tui.common.reasoning")} ${session.reasoningLevel}`
      : null,
    session.sendPolicy === "deny" ? translateTuiText("tui.common.sendDeny") : null,
  ].filter(Boolean);
  const route = formatDeliveryRoute(session);
  const preview = session.lastMessagePreview?.replace(/\s+/g, " ").trim() ?? "";
  return [timePart, model, tokens, ...flags, route, preview].filter(Boolean).join(" | ");
}

export function formatStatusOverlayLines(params: {
  connectionStatus: string;
  activityStatus: string;
  activeRunId?: string | null;
  agentLabel: string;
  sessionLabel: string;
  modelProvider?: string | null;
  model?: string | null;
  totalTokens?: number | null;
  contextTokens?: number | null;
  deliverEnabled: boolean;
  deliveryRoute?: string | null;
  lastError?: string | null;
  summary?: GatewayStatusSummary | null;
}): string[] {
  const lines: string[] = [translateTuiText("tui.status.gatewayStatus")];
  const model =
    params.modelProvider && params.model
      ? `${params.modelProvider}/${params.model}`
      : (params.model ?? translateTuiText("tui.common.unknown"));
  lines.push(
    translateTuiText("tui.status.gateway", {
      connection: formatTuiStatusText(params.connectionStatus),
      activity: formatTuiStatusText(params.activityStatus),
    }),
  );
  lines.push(
    translateTuiText("tui.status.run", {
      run: params.activeRunId?.trim() || translateTuiText("tui.common.none"),
    }),
  );
  lines.push(translateTuiText("tui.status.agent", { agent: params.agentLabel }));
  lines.push(translateTuiText("tui.status.session", { session: params.sessionLabel }));
  lines.push(translateTuiText("tui.status.model", { model }));
  lines.push(
    translateTuiText("tui.status.tokens", {
      tokens: formatTokens(params.totalTokens ?? null, params.contextTokens ?? null),
    }),
  );
  lines.push(
    translateTuiText("tui.status.deliver", { value: formatTuiOnOff(params.deliverEnabled) }),
  );
  lines.push(
    translateTuiText("tui.status.route", {
      route: params.deliveryRoute?.trim() || translateTuiText("tui.common.none"),
    }),
  );

  if (params.summary?.runtimeVersion) {
    lines.push(translateTuiText("tui.status.version", { version: params.summary.runtimeVersion }));
  }

  const link = params.summary?.linkChannel;
  if (link) {
    const label = link.label ?? translateTuiText("tui.status.linkChannel");
    const authAge =
      link.linked === true && typeof link.authAgeMs === "number"
        ? ` (${translateTuiText("tui.status.lastRefreshed", { age: formatTimeAgo(link.authAgeMs) })})`
        : "";
    lines.push(
      `${label}: ${link.linked === true ? translateTuiText("tui.common.linked") : translateTuiText("tui.common.notLinked")}${authAge}`,
    );
  } else {
    lines.push(translateTuiText("tui.status.linkChannelUnknown"));
  }

  if (/pairing required/i.test(params.activityStatus)) {
    lines.push(
      translateTuiText("tui.status.pairingAuth", {
        value: formatTuiStatusText(params.activityStatus),
      }),
    );
  }

  if (params.lastError?.trim()) {
    lines.push(
      translateTuiText("tui.status.lastError", {
        error: sanitizeRenderableText(params.lastError.trim()),
      }),
    );
  }

  const queued = Array.isArray(params.summary?.queuedSystemEvents)
    ? params.summary.queuedSystemEvents
    : [];
  if (queued.length > 0) {
    lines.push(
      translateTuiText("tui.status.queuedSystemEvents", {
        count: queued.length,
        preview: queued.slice(0, 3).join(" | "),
      }),
    );
  }

  const recent = Array.isArray(params.summary?.sessions?.recent)
    ? params.summary.sessions.recent
    : [];
  if (recent.length > 0) {
    lines.push(translateTuiText("tui.status.recentSessions"));
    for (const entry of recent.slice(0, 6)) {
      const modelLabel = entry.model ?? translateTuiText("tui.common.unknown");
      const usage = formatContextUsageLine({
        total: entry.totalTokens ?? null,
        context: entry.contextTokens ?? null,
        remaining: entry.remainingTokens ?? null,
        percent: entry.percentUsed ?? null,
      });
      const flags = entry.flags?.length
        ? ` | ${translateTuiText("tui.status.flags", { flags: entry.flags.join(", ") })}`
        : "";
      lines.push(
        `- ${entry.key}${entry.kind ? ` [${entry.kind}]` : ""} | ${translateTuiText("tui.common.model")} ${modelLabel} | ${usage}${flags}`,
      );
    }
  }

  return lines;
}

export function formatContextUsageLine(params: {
  total?: number | null;
  context?: number | null;
  remaining?: number | null;
  percent?: number | null;
}) {
  const totalLabel = typeof params.total === "number" ? formatTokenCount(params.total) : "?";
  const ctxLabel = typeof params.context === "number" ? formatTokenCount(params.context) : "?";
  const pct =
    typeof params.percent === "number"
      ? Math.min(999, Math.round(params.percent))
      : typeof params.total === "number" && typeof params.context === "number" && params.context > 0
        ? Math.min(999, Math.round((params.total / params.context) * 100))
        : null;
  const remainingLabel =
    typeof params.remaining === "number"
      ? `${formatTokenCount(params.remaining)} ${translateTuiText("tui.common.remaining")}`
      : null;
  const pctLabel = pct !== null ? `${pct}%` : null;
  const extra = [remainingLabel, pctLabel].filter(Boolean).join(", ");
  return `${translateTuiText("tui.common.tokens")} ${totalLabel}/${ctxLabel}${extra ? ` (${extra})` : ""}`;
}

export function formatTuiStatusText(text: string): string {
  return text
    .split(/(\s+\|\s+| • |: )/)
    .map((part) => {
      if (part === " | " || part === " • " || part === ": ") {
        return part;
      }
      return formatTuiStateLabel(part);
    })
    .join("");
}

export function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

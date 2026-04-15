import { loadConfig } from "../../config/config.js";
import { normalizeHttpWebhookUrl } from "../../cron/webhook-url.js";
import type { CronDelivery, CronMessageChannel } from "../../cron/types.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { extractTextFromChatContent } from "../../shared/chat-content.js";
import { truncateUtf16Safe } from "../../utils.js";
import type { GatewayCallOptions } from "./gateway.js";
import type { CronGatewayCaller } from "./cron-gateway.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-helpers.js";

const REMINDER_CONTEXT_MESSAGES_MAX = 10;
const REMINDER_CONTEXT_PER_MESSAGE_MAX = 220;
const REMINDER_CONTEXT_TOTAL_MAX = 700;
const REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n";

type ChatMessage = {
  role?: unknown;
  content?: unknown;
};

function stripExistingContext(text: string) {
  const index = text.indexOf(REMINDER_CONTEXT_MARKER);
  if (index === -1) {
    return text;
  }
  return text.slice(0, index).trim();
}

function truncateText(input: string, maxLen: number) {
  if (input.length <= maxLen) {
    return input;
  }
  const truncated = truncateUtf16Safe(input, Math.max(0, maxLen - 3)).trimEnd();
  return `${truncated}...`;
}

function extractMessageText(message: ChatMessage): { role: string; text: string } | null {
  const role = typeof message.role === "string" ? message.role : "";
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  const text = extractTextFromChatContent(message.content);
  return text ? { role, text } : null;
}

async function buildReminderContextLines(params: {
  agentSessionKey?: string;
  gatewayOpts: GatewayCallOptions;
  contextMessages: number;
  callGatewayTool: CronGatewayCaller;
}) {
  const maxMessages = Math.min(
    REMINDER_CONTEXT_MESSAGES_MAX,
    Math.max(0, Math.floor(params.contextMessages)),
  );
  if (maxMessages <= 0) {
    return [];
  }
  const sessionKey = params.agentSessionKey?.trim();
  if (!sessionKey) {
    return [];
  }
  const cfg = loadConfig();
  const { mainKey, alias } = resolveMainSessionAlias(cfg);
  const resolvedKey = resolveInternalSessionKey({ key: sessionKey, alias, mainKey });
  try {
    const res = await params.callGatewayTool<{ messages: Array<unknown> }>(
      "chat.history",
      params.gatewayOpts,
      {
        sessionKey: resolvedKey,
        limit: maxMessages,
      },
    );
    const messages = Array.isArray(res?.messages) ? res.messages : [];
    const parsed = messages
      .map((msg) => extractMessageText(msg as ChatMessage))
      .filter((msg): msg is { role: string; text: string } => Boolean(msg));
    const recent = parsed.slice(-maxMessages);
    if (recent.length === 0) {
      return [];
    }
    const lines: string[] = [];
    let total = 0;
    for (const entry of recent) {
      const label = entry.role === "user" ? "User" : "Assistant";
      const text = truncateText(entry.text, REMINDER_CONTEXT_PER_MESSAGE_MAX);
      const line = `- ${label}: ${text}`;
      total += line.length;
      if (total > REMINDER_CONTEXT_TOTAL_MAX) {
        break;
      }
      lines.push(line);
    }
    return lines;
  } catch {
    return [];
  }
}

function stripThreadSuffixFromSessionKey(sessionKey: string): string {
  const normalized = sessionKey.toLowerCase();
  const idx = normalized.lastIndexOf(":thread:");
  if (idx <= 0) {
    return sessionKey;
  }
  const parent = sessionKey.slice(0, idx).trim();
  return parent ? parent : sessionKey;
}

export function inferDeliveryFromSessionKey(agentSessionKey?: string): CronDelivery | null {
  const rawSessionKey = agentSessionKey?.trim();
  if (!rawSessionKey) {
    return null;
  }
  const parsed = parseAgentSessionKey(stripThreadSuffixFromSessionKey(rawSessionKey));
  if (!parsed || !parsed.rest) {
    return null;
  }
  const parts = parsed.rest.split(":").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const head = parts[0]?.trim().toLowerCase();
  if (!head || head === "main" || head === "subagent" || head === "acp") {
    return null;
  }

  const markerIndex = parts.findIndex(
    (part) => part === "direct" || part === "dm" || part === "group" || part === "channel",
  );
  if (markerIndex === -1) {
    return null;
  }
  const peerId = parts
    .slice(markerIndex + 1)
    .join(":")
    .trim();
  if (!peerId) {
    return null;
  }

  let channel: CronMessageChannel | undefined;
  if (markerIndex >= 1) {
    channel = parts[0]?.trim().toLowerCase() as CronMessageChannel;
  }

  const delivery: CronDelivery = { mode: "announce", to: peerId };
  if (channel) {
    delivery.channel = channel;
  }
  return delivery;
}

export function normalizeAgentTurnCronDelivery(params: {
  deliveryValue: unknown;
  agentSessionKey?: string;
}): CronDelivery | Record<string, unknown> | null | undefined {
  const delivery =
    params.deliveryValue && typeof params.deliveryValue === "object"
      ? (params.deliveryValue as Record<string, unknown>)
      : undefined;
  const modeRaw = typeof delivery?.mode === "string" ? delivery.mode : "";
  const mode = modeRaw.trim().toLowerCase();
  if (mode === "webhook") {
    const webhookUrl = normalizeHttpWebhookUrl(delivery?.to);
    if (!webhookUrl) {
      throw new Error('delivery.mode="webhook" requires delivery.to to be a valid http(s) URL');
    }
    if (delivery) {
      delivery.to = webhookUrl;
    }
    return delivery;
  }

  const hasTarget =
    (typeof delivery?.channel === "string" && delivery.channel.trim()) ||
    (typeof delivery?.to === "string" && delivery.to.trim());
  const shouldInfer =
    (params.deliveryValue == null || delivery) && (mode === "" || mode === "announce") && !hasTarget;
  if (!shouldInfer) {
    return delivery;
  }
  const inferred = inferDeliveryFromSessionKey(params.agentSessionKey);
  if (!inferred) {
    return delivery;
  }
  return {
    ...delivery,
    ...inferred,
  } satisfies CronDelivery;
}

export async function appendReminderContextToPayload(params: {
  payload: { text: string };
  agentSessionKey?: string;
  gatewayOpts: GatewayCallOptions;
  contextMessages: number;
  callGatewayTool: CronGatewayCaller;
}): Promise<void> {
  if (!params.payload.text.trim()) {
    return;
  }
  const contextLines = await buildReminderContextLines({
    agentSessionKey: params.agentSessionKey,
    gatewayOpts: params.gatewayOpts,
    contextMessages: params.contextMessages,
    callGatewayTool: params.callGatewayTool,
  });
  if (contextLines.length === 0) {
    return;
  }
  const baseText = stripExistingContext(params.payload.text);
  params.payload.text = `${baseText}${REMINDER_CONTEXT_MARKER}${contextLines.join("\n")}`;
}

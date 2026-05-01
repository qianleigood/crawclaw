import type {
  QueryContextSection,
  QueryContextSectionSchema,
  QueryContextSectionType,
} from "../../agents/query-context/types.js";
import { cleanPrompt } from "../util/prompt.ts";

export type DurableRecallSource = "sync" | "sync_error";

export function resolveMemoryMessageChannel(
  runtimeContext: Record<string, unknown> | null | undefined,
): string | undefined {
  const messageChannel =
    typeof runtimeContext?.messageChannel === "string" ? runtimeContext.messageChannel.trim() : "";
  if (messageChannel) {
    return messageChannel;
  }
  const messageProvider =
    typeof runtimeContext?.messageProvider === "string"
      ? runtimeContext.messageProvider.trim()
      : "";
  return messageProvider || undefined;
}

export function resolveMemoryRecallHitReason(params: {
  selectedDurableCount: number;
  selectedExperienceCount: number;
  selectedTotalCount: number;
  durableRecallSource: DurableRecallSource;
}): string {
  if (params.selectedDurableCount > 0) {
    return `durable_selected:${params.durableRecallSource}`;
  }
  if (params.selectedExperienceCount > 0) {
    return "experience_selected";
  }
  if (params.durableRecallSource === "sync_error") {
    return `durable_unavailable:${params.durableRecallSource}`;
  }
  return "no_recall_items";
}

export function resolveMemoryRecallEvictionReason(params: {
  omittedDurableCount: number;
  omittedExperienceCount: number;
}): string | undefined {
  if (params.omittedDurableCount > 0 && params.omittedExperienceCount > 0) {
    return "token_budget:durable_and_experience";
  }
  if (params.omittedDurableCount > 0) {
    return "token_budget:durable";
  }
  if (params.omittedExperienceCount > 0) {
    return "token_budget:experience";
  }
  return undefined;
}

export function createMemorySystemContextSection(params: {
  id: string;
  text: string;
  estimatedTokens?: number;
  sectionType?: QueryContextSectionType;
  schema?: QueryContextSectionSchema;
  metadata?: Record<string, unknown>;
}): QueryContextSection | null {
  const text = params.text.trim();
  if (!text) {
    return null;
  }
  return {
    id: params.id,
    role: "system_context",
    sectionType: params.sectionType ?? "other",
    ...(params.schema ? { schema: params.schema } : {}),
    content: text,
    source: "memory-context",
    cacheable: true,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function getMessageRole(message: unknown): string {
  if (typeof message !== "object" || !message) {
    return "unknown";
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" && role.trim() ? role : "unknown";
}

export function resolvePromptContext(params: { prompt?: string; messages?: unknown[] }): {
  prompt?: string;
  recentMessages?: string[];
} {
  const promptCandidates = [
    typeof params.prompt === "string" ? params.prompt : "",
    Array.isArray(params.messages)
      ? (params.messages
          .slice()
          .toReversed()
          .map((message) => {
            const content =
              typeof message === "object" && message && "content" in message
                ? (message as { content?: unknown }).content
                : undefined;
            return typeof content === "string" ? content : "";
          })
          .find((value) => Boolean(cleanPrompt(value))) ?? "")
      : "",
  ];
  const prompt = promptCandidates
    .map((value) => cleanPrompt(value))
    .find((value) => Boolean(value));
  if (!prompt) {
    return {};
  }

  const recentMessages = Array.isArray(params.messages)
    ? params.messages
        .slice(-6)
        .map((message) => {
          const content =
            typeof message === "object" && message && "content" in message
              ? (message as { content?: unknown }).content
              : undefined;
          return typeof content === "string" ? cleanPrompt(content) : "";
        })
        .filter((value) => value && value !== prompt)
        .slice(-3)
    : undefined;

  return { prompt, recentMessages };
}

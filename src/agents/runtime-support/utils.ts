import type { ReasoningLevel, ThinkLevel } from "../../auto-reply/thinking.js";
import type { ThinkingLevel } from "../agent-types.js";

export function mapThinkingLevel(level?: ThinkLevel): ThinkingLevel {
  // CrawClaw's Rust agent runtime supports "xhigh" for selected models.
  if (!level) {
    return "off";
  }
  // "adaptive" maps to "medium" for the transport layer. Providers that
  // support adaptive reasoning can still translate it to their native shape.
  if (level === "adaptive") {
    return "medium";
  }
  return level;
}

export function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

export type { ReasoningLevel, ThinkLevel };

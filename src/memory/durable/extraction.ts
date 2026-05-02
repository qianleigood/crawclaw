import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { MEMORY_FILE_MUTATING_TOOL_ALLOWLIST } from "../special-agent-toollists.js";

const MEMORY_FILE_MUTATING_TOOL_NAMES = new Set<string>(MEMORY_FILE_MUTATING_TOOL_ALLOWLIST);

export function hasDurableMemoryWriteInMessages(messages: AgentMessage[]): boolean {
  return messages.some((message) => {
    if ((message as { role?: unknown }).role !== "toolResult") {
      return false;
    }
    const toolName =
      typeof (message as { toolName?: unknown }).toolName === "string"
        ? String((message as { toolName?: unknown }).toolName).trim()
        : "";
    return (
      MEMORY_FILE_MUTATING_TOOL_NAMES.has(toolName) &&
      (message as { isError?: unknown }).isError !== true
    );
  });
}

export function classifyAfterTurnDurableSkipReason(
  messages: AgentMessage[],
): "durable_write" | null {
  if (hasDurableMemoryWriteInMessages(messages)) {
    return "durable_write";
  }
  return null;
}

export function shouldSkipAfterTurnDurableExtraction(messages: AgentMessage[]): boolean {
  return classifyAfterTurnDurableSkipReason(messages) !== null;
}

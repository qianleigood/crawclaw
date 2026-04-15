import type { AgentMessage } from "@mariozechner/pi-agent-core";

function extractTextBlocks(content: unknown): string[] {
  if (typeof content === "string") {
    return content.trim() ? [content.trim()] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .map((item) => {
      if (typeof item === "string") {return item.trim();}
      if (!item || typeof item !== "object") {return "";}
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter(Boolean);
}

function extractMessageText(message: AgentMessage): string {
  const record = message as unknown as Record<string, unknown>;
  const directContent = extractTextBlocks(record.content).join("\n");
  if (directContent) {
    return directContent;
  }
  const toolOutput = typeof record.toolOutput === "string" ? record.toolOutput.trim() : "";
  return toolOutput;
}

export function hasDurableMemoryWriteInMessages(messages: AgentMessage[]): boolean {
  return messages.some((message) => {
    if ((message as { role?: unknown }).role !== "toolResult") {
      return false;
    }
    const toolName = typeof (message as { toolName?: unknown }).toolName === "string"
      ? String((message as { toolName?: unknown }).toolName).trim()
      : "";
    return toolName === "memory_manifest_read"
      || toolName === "memory_note_read"
      || toolName === "memory_note_write"
      || toolName === "memory_note_edit"
      || toolName === "memory_note_delete";
  });
}

export function classifyAfterTurnDurableSkipReason(
  messages: AgentMessage[],
) : "durable_write" | null {
  if (hasDurableMemoryWriteInMessages(messages)) {
    return "durable_write";
  }
  return null;
}

export function shouldSkipAfterTurnDurableExtraction(messages: AgentMessage[]): boolean {
  return classifyAfterTurnDurableSkipReason(messages) !== null;
}

export function collectRecentDurableConversation(
  messages: AgentMessage[],
  limit: number,
): Array<{ role: "user" | "assistant"; text: string }> {
  return messages
    .filter((message): message is AgentMessage & { role: "user" | "assistant" } => {
      const role = (message as { role?: unknown }).role;
      return role === "user" || role === "assistant";
    })
    .map((message) => ({
      role: message.role,
      text: extractMessageText(message).trim(),
    }))
    .filter((entry) => entry.text.length > 0)
    .slice(-Math.max(1, limit));
}

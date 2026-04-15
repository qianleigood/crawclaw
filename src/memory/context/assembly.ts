import { estimateTokenCount } from "../recall/token-estimate.ts";

export function joinPromptSections(
  sections: Array<{ text: string; estimatedTokens: number } | null | undefined>,
) {
  const filtered = sections.filter(
    (section): section is { text: string; estimatedTokens: number } => Boolean(section?.text),
  );
  return {
    text: filtered.map((section) => section.text).join("\n\n"),
    estimatedTokens: filtered.reduce((sum, section) => sum + section.estimatedTokens, 0),
  };
}

export function extractMessageTextForTokenEstimate(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => extractMessageTextForTokenEstimate(entry))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  const fragments: string[] = [];
  if (typeof record.role === "string") {
    fragments.push(record.role);
  }
  if (typeof record.text === "string") {
    fragments.push(record.text);
  }
  if (typeof record.thinking === "string") {
    fragments.push(record.thinking);
  }
  if (typeof record.errorMessage === "string") {
    fragments.push(record.errorMessage);
  }
  if (typeof record.name === "string") {
    fragments.push(record.name);
  }
  if ("content" in record) {
    fragments.push(extractMessageTextForTokenEstimate(record.content));
  }
  if ("input" in record) {
    fragments.push(extractMessageTextForTokenEstimate(record.input));
  }
  if ("result" in record) {
    fragments.push(extractMessageTextForTokenEstimate(record.result));
  }
  if ("data" in record) {
    fragments.push(extractMessageTextForTokenEstimate(record.data));
  }
  return fragments.filter(Boolean).join("\n");
}

export function estimateConversationMessageTokens(messages: unknown[]): number {
  return messages.reduce<number>((sum, message) => {
    const text = extractMessageTextForTokenEstimate(message);
    if (!text) {
      return sum;
    }
    return sum + estimateTokenCount(text);
  }, 0);
}

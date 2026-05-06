type EmbeddedPayload = {
  text?: string;
  isError?: boolean;
  isReasoning?: boolean;
};

export function extractAssistantTextFromPayloads(
  payloads: readonly EmbeddedPayload[] = [],
): string {
  return payloads
    .filter((payload) => !payload.isReasoning)
    .map((payload) => payload.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n")
    .trim();
}

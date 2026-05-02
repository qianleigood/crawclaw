import { createHash } from "node:crypto";

export const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

export function normalizeOpenAIPromptCacheKey(value: string): string {
  if (value.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) {
    return value;
  }
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 40);
  const safePrefix = value
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/[:._-]+$/g, "")
    .slice(0, 20)
    .replace(/[:._-]+$/g, "");
  const candidate = safePrefix ? `${safePrefix}:${hash}` : `cache:${hash}`;
  return candidate.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH ? candidate : `cache:${hash}`;
}

export function patchOpenAIResponsesPromptCachePayload(params: {
  payloadObj: Record<string, unknown>;
  cacheRetention?: unknown;
  preservePromptCacheKey?: boolean;
}): void {
  if (params.cacheRetention === "none") {
    delete params.payloadObj.prompt_cache_retention;
    if (!params.preservePromptCacheKey) {
      delete params.payloadObj.prompt_cache_key;
      return;
    }
    const existing = params.payloadObj.prompt_cache_key;
    if (typeof existing === "string") {
      params.payloadObj.prompt_cache_key = normalizeOpenAIPromptCacheKey(existing.trim());
    }
    return;
  }

  const existing = params.payloadObj.prompt_cache_key;
  if (typeof existing !== "string") {
    return;
  }
  const trimmed = existing.trim();
  if (!trimmed) {
    delete params.payloadObj.prompt_cache_key;
    return;
  }
  params.payloadObj.prompt_cache_key = normalizeOpenAIPromptCacheKey(trimmed);
}

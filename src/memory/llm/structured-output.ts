export type StructuredValidator<T> = (value: unknown) => T;
export type StructuredFallback<T> = (raw: string, error: unknown) => T;

export interface StructuredAttemptTrace {
  attempt: number;
  ok: boolean;
  error?: string;
  rawPreview: string;
}

export interface StructuredCallResult<T> {
  value: T;
  raw: string;
  trace: StructuredAttemptTrace[];
}

export interface StructuredCallOptions<T> {
  system: string;
  user: string;
  formatHint?: string;
  retries?: number;
  validator: StructuredValidator<T>;
  fallback?: StructuredFallback<T>;
}

export type StructuredCompleteFn = (system: string, user: string) => Promise<string>;

export function stripThinkingBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export function unwrapJsonFence(raw: string): string {
  return stripThinkingBlocks(raw)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export function extractJsonPayload(raw: string): string {
  const cleaned = unwrapJsonFence(raw);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return cleaned.slice(firstBracket, lastBracket + 1);
  }
  return cleaned;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function callStructuredOutput<T>(
  complete: StructuredCompleteFn,
  options: StructuredCallOptions<T>,
): Promise<StructuredCallResult<T>> {
  const retries = Math.max(0, options.retries ?? 1);
  const attempts: StructuredAttemptTrace[] = [];
  let lastRaw = "";
  let lastError: unknown;
  let repairUser = options.user;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const system = [options.system.trim(), options.formatHint?.trim()].filter(Boolean).join("\n\n");
    const raw = await complete(system, repairUser);
    lastRaw = raw;
    try {
      const parsed = JSON.parse(extractJsonPayload(raw));
      const value = options.validator(parsed);
      attempts.push({ attempt: attempt + 1, ok: true, rawPreview: raw.slice(0, 240) });
      return { value, raw, trace: attempts };
    } catch (error) {
      lastError = error;
      attempts.push({
        attempt: attempt + 1,
        ok: false,
        error: toErrorMessage(error),
        rawPreview: raw.slice(0, 240),
      });
      repairUser = `${options.user}\n\n<FORMAT_REPAIR>\n上一次输出未通过 JSON schema 校验。请仅输出合法 JSON，不要解释，不要 markdown fence。\n原始输出：\n${raw.slice(0, 2000)}\n</FORMAT_REPAIR>`;
    }
  }

  if (options.fallback) {
    return {
      value: options.fallback(lastRaw, lastError),
      raw: lastRaw,
      trace: attempts,
    };
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(lastError == null ? "structured output failed" : JSON.stringify(lastError));
}

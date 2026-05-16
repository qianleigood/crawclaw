import { complete, type Api, type Context, type Model } from "@mariozechner/pi-ai";
import { extractAssistantText } from "../agent-output-utils.js";
import type { SkillDiscoveryReranker } from "./discovery.js";

type SkillDiscoveryRerankerAuthStorage = {
  getApiKey(provider: string): Promise<string | undefined>;
};

type StructuredCompleteFn = (system: string, user: string) => Promise<string>;

type StructuredFallback<T> = (raw: string, error: unknown) => T;

function stripThinkingBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJsonPayload(raw: string): string {
  const cleaned = stripThinkingBlocks(raw)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
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

async function callStructuredOutput<T>(
  completeFn: StructuredCompleteFn,
  options: {
    system: string;
    user: string;
    formatHint?: string;
    retries?: number;
    validator: (value: unknown) => T;
    fallback?: StructuredFallback<T>;
  },
): Promise<{ value: T }> {
  const retries = Math.max(0, options.retries ?? 1);
  let lastRaw = "";
  let lastError: unknown;
  let repairUser = options.user;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const system = [options.system.trim(), options.formatHint?.trim()].filter(Boolean).join("\n\n");
    const raw = await completeFn(system, repairUser);
    lastRaw = raw;
    try {
      return { value: options.validator(JSON.parse(extractJsonPayload(raw))) };
    } catch (error) {
      lastError = error;
      repairUser = `${options.user}\n\n<FORMAT_REPAIR>\n上一次输出未通过 JSON schema 校验。请仅输出合法 JSON，不要解释，不要 markdown fence。\n原始输出：\n${raw.slice(0, 2000)}\n</FORMAT_REPAIR>`;
    }
  }

  if (options.fallback) {
    return { value: options.fallback(lastRaw, lastError) };
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(lastError == null ? "structured output failed" : JSON.stringify(lastError));
}

function clampConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(Math.max(0, Math.min(1, value)).toFixed(3))
    : undefined;
}

function buildContext(system: string, user: string): Context {
  return {
    systemPrompt: system,
    messages: [
      {
        role: "user",
        content: user,
        timestamp: Date.now(),
      },
    ],
  };
}

function validateSkillRerankResult(value: unknown): {
  skillNames: string[];
  reason?: string;
  confidence?: number;
} {
  if (!value || typeof value !== "object") {
    throw new Error("skill rerank result must be an object");
  }
  const record = value as Record<string, unknown>;
  const skillNames = Array.isArray(record.skillNames)
    ? record.skillNames
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .filter((item, index, list) => list.indexOf(item) === index)
    : [];
  return {
    skillNames,
    reason:
      typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : undefined,
    confidence: clampConfidence(record.confidence),
  };
}

export function createModelSkillDiscoveryReranker(params: {
  model: Model<Api>;
  authStorage: SkillDiscoveryRerankerAuthStorage;
  maxTokens?: number;
}): SkillDiscoveryReranker {
  return async (request) => {
    const candidateNames = new Set(request.candidates.map((candidate) => candidate.name));
    const structured = await callStructuredOutput(
      async (system, user) => {
        const apiKey = await params.authStorage.getApiKey(params.model.provider);
        const message = await complete(params.model, buildContext(system, user), {
          apiKey,
          maxTokens: params.maxTokens ?? 512,
        });
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          throw new Error(message.errorMessage?.trim() || "skill discovery rerank failed");
        }
        return extractAssistantText(message).trim();
      },
      {
        system: [
          "You select CrawClaw skills for a coding agent.",
          "Only choose from the provided candidate skills.",
          `Return at most ${request.limit} skill names.`,
          "Prefer skills whose descriptions clearly match the user's actual task intent, including multilingual or paraphrased intent.",
          "If no skill clearly applies, return an empty list.",
        ].join("\n"),
        user: [
          `Current task:\n${request.taskDescription}`,
          "Candidate skills:",
          ...request.candidates.map((candidate) =>
            `- ${candidate.name}: ${candidate.description ?? ""}`.trim(),
          ),
        ].join("\n\n"),
        formatHint:
          'Output JSON only with shape {"skillNames":["..."],"reason":"...","confidence":0.0}.',
        retries: 1,
        validator: (value: unknown) => {
          const result = validateSkillRerankResult(value);
          return {
            ...result,
            skillNames: result.skillNames
              .filter((name) => candidateNames.has(name))
              .slice(0, request.limit),
          };
        },
        fallback: () => ({ skillNames: [] }),
      },
    );
    return structured.value;
  };
}

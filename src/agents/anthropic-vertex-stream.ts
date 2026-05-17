import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { streamAnthropic, type AnthropicOptions, type Model } from "@mariozechner/pi-ai";
import { ANTHROPIC_VERTEX_DEFAULT_REGION } from "../generated/providers/runtime-constants.generated.js";
import type { StreamFn } from "./agent-types.js";
import { resolveProviderEndpoint } from "./provider-attribution.js";

type AnthropicVertexEffort = NonNullable<AnthropicOptions["effort"]>;
const ANTHROPIC_VERTEX_REGION_RE = /^[a-z0-9-]+$/;
const GCLOUD_DEFAULT_ADC_PATH = join(
  homedir(),
  ".config",
  "gcloud",
  "application_default_credentials.json",
);

type AdcProjectFile = {
  project_id?: unknown;
  quota_project_id?: unknown;
};

function normalizeOptionalEnvValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveAnthropicVertexRegion(env: NodeJS.ProcessEnv = process.env): string {
  const region =
    normalizeOptionalEnvValue(env.GOOGLE_CLOUD_LOCATION) ||
    normalizeOptionalEnvValue(env.CLOUD_ML_REGION);

  return region && ANTHROPIC_VERTEX_REGION_RE.test(region)
    ? region
    : ANTHROPIC_VERTEX_DEFAULT_REGION;
}

export function resolveAnthropicVertexRegionFromBaseUrl(baseUrl?: string): string | undefined {
  const endpoint = resolveProviderEndpoint(baseUrl);
  return endpoint.endpointClass === "google-vertex" ? endpoint.googleVertexRegion : undefined;
}

export function resolveAnthropicVertexClientRegion(params?: {
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return (
    resolveAnthropicVertexRegionFromBaseUrl(params?.baseUrl) ||
    resolveAnthropicVertexRegion(params?.env)
  );
}

function resolveAnthropicVertexDefaultAdcPath(env: NodeJS.ProcessEnv = process.env): string {
  return platform() === "win32"
    ? join(
        env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "gcloud",
        "application_default_credentials.json",
      )
    : GCLOUD_DEFAULT_ADC_PATH;
}

function resolveAnthropicVertexAdcCredentialsPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicitCredentialsPath = normalizeOptionalEnvValue(env.GOOGLE_APPLICATION_CREDENTIALS);
  if (explicitCredentialsPath) {
    return existsSync(explicitCredentialsPath) ? explicitCredentialsPath : undefined;
  }

  const defaultAdcPath = resolveAnthropicVertexDefaultAdcPath(env);
  return existsSync(defaultAdcPath) ? defaultAdcPath : undefined;
}

function resolveAnthropicVertexProjectIdFromAdc(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const credentialsPath = resolveAnthropicVertexAdcCredentialsPath(env);
  if (!credentialsPath) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(credentialsPath, "utf8")) as AdcProjectFile;
    return (
      normalizeOptionalEnvValue(parsed.project_id) ||
      normalizeOptionalEnvValue(parsed.quota_project_id)
    );
  } catch {
    return undefined;
  }
}

export function resolveAnthropicVertexProjectId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    normalizeOptionalEnvValue(env.ANTHROPIC_VERTEX_PROJECT_ID) ||
    normalizeOptionalEnvValue(env.GOOGLE_CLOUD_PROJECT) ||
    normalizeOptionalEnvValue(env.GOOGLE_CLOUD_PROJECT_ID) ||
    resolveAnthropicVertexProjectIdFromAdc(env)
  );
}

function resolveAnthropicVertexMaxTokens(params: {
  modelMaxTokens: number | undefined;
  requestedMaxTokens: number | undefined;
}): number | undefined {
  const modelMax =
    typeof params.modelMaxTokens === "number" &&
    Number.isFinite(params.modelMaxTokens) &&
    params.modelMaxTokens > 0
      ? Math.floor(params.modelMaxTokens)
      : undefined;
  const requested =
    typeof params.requestedMaxTokens === "number" &&
    Number.isFinite(params.requestedMaxTokens) &&
    params.requestedMaxTokens > 0
      ? Math.floor(params.requestedMaxTokens)
      : undefined;

  if (modelMax !== undefined && requested !== undefined) {
    return Math.min(requested, modelMax);
  }
  return requested ?? modelMax;
}

/**
 * Create a StreamFn that routes through pi-ai's `streamAnthropic` with an
 * injected `AnthropicVertex` client.  All streaming, message conversion, and
 * event handling is handled by pi-ai — we only supply the GCP-authenticated
 * client and map SimpleStreamOptions → AnthropicOptions.
 */
export function createAnthropicVertexStreamFn(
  projectId: string | undefined,
  region: string,
  baseURL?: string,
): StreamFn {
  const client = new AnthropicVertex({
    region,
    ...(baseURL ? { baseURL } : {}),
    ...(projectId ? { projectId } : {}),
  });

  return (model, context, options) => {
    const maxTokens = resolveAnthropicVertexMaxTokens({
      modelMaxTokens: model.maxTokens,
      requestedMaxTokens: options?.maxTokens,
    });
    const opts: AnthropicOptions = {
      client: client as unknown as AnthropicOptions["client"],
      temperature: options?.temperature,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      signal: options?.signal,
      cacheRetention: options?.cacheRetention,
      sessionId: options?.sessionId,
      headers: options?.headers,
      onPayload: options?.onPayload,
      maxRetryDelayMs: options?.maxRetryDelayMs,
      metadata: options?.metadata,
    };

    if (options?.reasoning) {
      const isAdaptive =
        model.id.includes("opus-4-6") ||
        model.id.includes("opus-4.6") ||
        model.id.includes("sonnet-4-6") ||
        model.id.includes("sonnet-4.6");

      if (isAdaptive) {
        opts.thinkingEnabled = true;
        const effortMap: Record<string, AnthropicVertexEffort> = {
          minimal: "low",
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: model.id.includes("opus-4-6") || model.id.includes("opus-4.6") ? "max" : "high",
        };
        opts.effort = effortMap[options.reasoning] ?? "high";
      } else {
        opts.thinkingEnabled = true;
        const budgets = options.thinkingBudgets;
        opts.thinkingBudgetTokens =
          (budgets && options.reasoning in budgets
            ? budgets[options.reasoning as keyof typeof budgets]
            : undefined) ?? 10000;
      }
    } else {
      opts.thinkingEnabled = false;
    }

    return streamAnthropic(model as Model<"anthropic-messages">, context, opts);
  };
}

function resolveAnthropicVertexSdkBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (!normalizedPath || normalizedPath === "") {
      url.pathname = "/v1";
      return url.toString().replace(/\/$/, "");
    }
    if (!normalizedPath.endsWith("/v1")) {
      url.pathname = `${normalizedPath}/v1`;
      return url.toString().replace(/\/$/, "");
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

export function createAnthropicVertexStreamFnForModel(
  model: { baseUrl?: string },
  env: NodeJS.ProcessEnv = process.env,
): StreamFn {
  return createAnthropicVertexStreamFn(
    resolveAnthropicVertexProjectId(env),
    resolveAnthropicVertexClientRegion({
      baseUrl: model.baseUrl,
      env,
    }),
    resolveAnthropicVertexSdkBaseUrl(model.baseUrl),
  );
}

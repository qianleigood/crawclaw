import { createContextArchiveService } from "../../agents/context-archive/service.js";
import type { CrawClawConfig } from "../../config/config.js";
import { normalizeSecretInputString } from "../../config/types.secrets.js";
import { resolveMemoryConfig } from "../config/resolve.js";
import { runDreamAgentOnce } from "../dreaming/agent-runner.js";
import { runDurableExtractionAgentOnce } from "../durable/agent-runner.js";
import type { CompleteFn } from "../extraction/llm.js";
import { SqliteRuntimeStore } from "../runtime/sqlite-runtime-store.js";
import { runSessionSummaryAgentOnce } from "../session-summary/agent-runner.ts";
import type { LlmConfig } from "../types/config.js";
import { createContextMemoryRuntime } from "./context-memory-runtime.js";
import type { MemoryRuntime } from "./types.js";

type RuntimeLogger = Pick<typeof console, "info" | "warn" | "error">;

type RuntimeBootstrap = {
  runtime: MemoryRuntime;
  runtimeStore: SqliteRuntimeStore;
};

type RuntimeBootstrapOverrides = {
  llm?: LlmConfig;
  complete?: CompleteFn;
};

let cachedBootstrapPromise: Promise<RuntimeBootstrap | undefined> | null = null;

function resolveRawMemoryConfig(config?: CrawClawConfig): unknown {
  const notebooklm = config?.memory?.notebooklm;
  const durableExtraction = config?.memory?.durableExtraction;
  const contextArchive = config?.memory?.contextArchive;
  const dreaming = config?.memory?.dreaming;
  const sessionSummary = config?.memory?.sessionSummary;
  if (!notebooklm && !durableExtraction && !contextArchive && !dreaming && !sessionSummary) {
    return undefined;
  }
  return {
    ...(notebooklm ? { notebooklm } : {}),
    ...(durableExtraction ? { durableExtraction } : {}),
    ...(contextArchive ? { contextArchive } : {}),
    ...(dreaming ? { dreaming } : {}),
    ...(sessionSummary ? { sessionSummary } : {}),
  };
}

function pickPrimaryModelRef(config?: CrawClawConfig): string | undefined {
  const defaultsModel = config?.agents?.defaults?.model;
  if (typeof defaultsModel === "string") {
    return defaultsModel;
  }
  if (
    defaultsModel &&
    typeof defaultsModel === "object" &&
    typeof defaultsModel.primary === "string"
  ) {
    return defaultsModel.primary;
  }
  const defaultAgent = config?.agents?.list?.find?.((agent) => agent?.default);
  if (defaultAgent?.model && typeof defaultAgent.model === "string") {
    return defaultAgent.model;
  }
  if (
    defaultAgent?.model &&
    typeof defaultAgent.model === "object" &&
    typeof defaultAgent.model.primary === "string"
  ) {
    return defaultAgent.model.primary;
  }
  return undefined;
}

function resolveHostLlmConfig(
  config?: CrawClawConfig,
  requested?: LlmConfig,
): LlmConfig | undefined {
  if (requested?.apiKey && requested?.baseURL) {
    return requested;
  }
  const primary = pickPrimaryModelRef(config);
  if (!primary || typeof primary !== "string") {
    return requested;
  }
  const [providerName, explicitModel] = primary.includes("/")
    ? primary.split("/", 2)
    : [primary, undefined];
  const providerConfig = config?.models?.providers?.[providerName];
  const providerApi = providerConfig?.api;
  return {
    provider: requested?.provider ?? providerName,
    api:
      requested?.api ??
      (providerApi === "anthropic-messages" ||
      providerApi === "openai-completions" ||
      providerApi === "openai-responses" ||
      providerApi === "openai-codex-responses" ||
      providerApi === "azure-openai-responses"
        ? providerApi
        : "openai-completions"),
    apiKey: requested?.apiKey ?? normalizeSecretInputString(providerConfig?.apiKey),
    baseURL: requested?.baseURL ?? providerConfig?.baseUrl,
    model: requested?.model ?? explicitModel ?? providerConfig?.models?.[0]?.id,
    authSource: requested?.authSource ?? (providerConfig?.apiKey ? "crawclaw-config" : undefined),
  };
}

function createRuntimeLogger(): RuntimeLogger {
  return {
    info(message: string) {
      console.info(message);
    },
    warn(message: string) {
      console.warn(message);
    },
    error(message: string) {
      console.error(message);
    },
  };
}

async function bootstrapBuiltInMemoryRuntime(
  config?: CrawClawConfig,
  overrides?: RuntimeBootstrapOverrides,
): Promise<RuntimeBootstrap | undefined> {
  const rawConfig = resolveRawMemoryConfig(config);
  if (!rawConfig) {
    return undefined;
  }

  const logger = createRuntimeLogger();
  const resolvedConfig = resolveMemoryConfig(rawConfig);
  const runtimeStore = new SqliteRuntimeStore(resolvedConfig.runtimeStore.dbPath);
  await runtimeStore.init();
  const contextArchive =
    resolvedConfig.contextArchive?.mode && resolvedConfig.contextArchive.mode !== "off"
      ? createContextArchiveService({
          runtimeStore,
          ...(resolvedConfig.contextArchive.rootDir
            ? { rootDir: resolvedConfig.contextArchive.rootDir }
            : {}),
          defaultArchiveMode: resolvedConfig.contextArchive.mode,
          retentionDays: resolvedConfig.contextArchive.retentionDays,
          maxBlobBytes: resolvedConfig.contextArchive.maxBlobBytes,
          maxTotalBytes: resolvedConfig.contextArchive.maxTotalBytes,
        })
      : undefined;
  const llmConfig = resolveHostLlmConfig(config, overrides?.llm ?? resolvedConfig.llm);
  const runtime = createContextMemoryRuntime({
    runtimeStore,
    logger,
    config: resolvedConfig,
    llm: llmConfig,
    complete: overrides?.complete,
    durableExtractionRunner: runDurableExtractionAgentOnce,
    dreamRunner: runDreamAgentOnce,
    sessionSummaryRunner: runSessionSummaryAgentOnce,
    contextArchive,
  });

  return {
    runtime,
    runtimeStore,
  };
}

export async function resolveConfiguredBuiltInMemoryRuntime(
  config?: CrawClawConfig,
  overrides?: RuntimeBootstrapOverrides,
): Promise<MemoryRuntime | undefined> {
  if (!resolveRawMemoryConfig(config)) {
    return undefined;
  }
  if (overrides?.llm || overrides?.complete) {
    const bootstrap = await bootstrapBuiltInMemoryRuntime(config, overrides);
    return bootstrap?.runtime;
  }
  if (!cachedBootstrapPromise) {
    cachedBootstrapPromise = bootstrapBuiltInMemoryRuntime(config);
  }
  const bootstrap = await cachedBootstrapPromise;
  return bootstrap?.runtime;
}

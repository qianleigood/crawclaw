import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { CrawClawConfig } from "../../config/config.js";
import type { ModelApi } from "../../config/types.models.js";
import type { EmbeddedRunAttemptResult } from "../pi-embedded-runner/run/types.js";

export type EmbeddedPiRunnerTestWorkspace = {
  tempRoot: string;
  agentDir: string;
  workspaceDir: string;
};

export async function createEmbeddedPiRunnerTestWorkspace(
  prefix: string,
): Promise<EmbeddedPiRunnerTestWorkspace> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const agentDir = path.join(tempRoot, "agent");
  const workspaceDir = path.join(tempRoot, "workspace");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  return { tempRoot, agentDir, workspaceDir };
}

export async function cleanupEmbeddedPiRunnerTestWorkspace(
  workspace: EmbeddedPiRunnerTestWorkspace | undefined,
): Promise<void> {
  if (!workspace) {
    return;
  }
  await fs.rm(workspace.tempRoot, { recursive: true, force: true });
}

export const EMBEDDED_PI_RUNNER_E2E_MINIMAX_PROVIDER = "minimax" as const;
export const EMBEDDED_PI_RUNNER_E2E_MINIMAX_API = "anthropic-messages" as const;
export const EMBEDDED_PI_RUNNER_E2E_MINIMAX_MODEL_ID =
  process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.7";
export const EMBEDDED_PI_RUNNER_E2E_MINIMAX_ERROR_MODEL_ID = `${EMBEDDED_PI_RUNNER_E2E_MINIMAX_MODEL_ID}-error`;
export const EMBEDDED_PI_RUNNER_E2E_MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimax.io/anthropic";

function createEmbeddedPiRunnerProviderConfig(params: {
  providerId: string;
  api: ModelApi;
  apiKey: string;
  baseUrl: string;
  modelIds: string[];
  modelNamePrefix?: string;
}): CrawClawConfig {
  return {
    models: {
      providers: {
        [params.providerId]: {
          api: params.api,
          apiKey: params.apiKey,
          baseUrl: params.baseUrl,
          models: params.modelIds.map((id) => ({
            id,
            name: params.modelNamePrefix ? `${params.modelNamePrefix} ${id}` : id,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 16_000,
            maxTokens: 2048,
          })),
        },
      },
    },
  };
}

export function createEmbeddedPiRunnerOpenAiConfig(modelIds: string[]): CrawClawConfig {
  return createEmbeddedPiRunnerProviderConfig({
    providerId: "openai",
    api: "openai-responses",
    apiKey: "sk-test",
    baseUrl: "https://example.com",
    modelIds,
    modelNamePrefix: "Mock",
  });
}

export function createEmbeddedPiRunnerMinimaxConfig(
  modelIds: string[] = [EMBEDDED_PI_RUNNER_E2E_MINIMAX_MODEL_ID],
): CrawClawConfig {
  return createEmbeddedPiRunnerProviderConfig({
    providerId: EMBEDDED_PI_RUNNER_E2E_MINIMAX_PROVIDER,
    api: EMBEDDED_PI_RUNNER_E2E_MINIMAX_API,
    apiKey: process.env.MINIMAX_API_KEY?.trim() || "minimax-test-key",
    baseUrl: EMBEDDED_PI_RUNNER_E2E_MINIMAX_BASE_URL,
    modelIds,
    modelNamePrefix: "MiniMax",
  });
}

export async function immediateEnqueue<T>(task: () => Promise<T>): Promise<T> {
  return await task();
}

export function createMockUsage(input: number, output: number) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

const baseUsage = createMockUsage(0, 0);

export function buildEmbeddedRunnerAssistant(
  overrides: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "openai",
    model: "mock-1",
    usage: baseUsage,
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

export function makeEmbeddedRunnerAttempt(
  overrides: Partial<EmbeddedRunAttemptResult>,
): EmbeddedRunAttemptResult {
  return {
    aborted: false,
    timedOut: false,
    timedOutDuringCompaction: false,
    promptError: null,
    sessionIdUsed: "session:test",
    systemPromptReport: undefined,
    messagesSnapshot: [],
    assistantTexts: [],
    toolMetas: [],
    lastAssistant: undefined,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    ...overrides,
  };
}

export function createResolvedEmbeddedRunnerModel(
  provider: string,
  modelId: string,
  options?: { api?: ModelApi; baseUrl?: string },
) {
  const isMiniMax = provider === EMBEDDED_PI_RUNNER_E2E_MINIMAX_PROVIDER;
  return {
    model: {
      id: modelId,
      name: modelId,
      api: options?.api ?? (isMiniMax ? EMBEDDED_PI_RUNNER_E2E_MINIMAX_API : "openai-responses"),
      provider,
      baseUrl:
        options?.baseUrl ??
        (isMiniMax ? EMBEDDED_PI_RUNNER_E2E_MINIMAX_BASE_URL : `https://example.com/${provider}`),
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_000,
      maxTokens: 2048,
    },
    error: undefined,
    authStorage: {
      setRuntimeApiKey: () => undefined,
    },
    modelRegistry: {},
  };
}

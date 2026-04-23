import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { expect, vi } from "vitest";
import type {
  MemoryAssembleResult,
  MemoryBootstrapResult,
  MemoryCompactResult,
  MemoryIngestBatchResult,
  MemoryIngestResult,
  MemoryRuntimeInfo,
} from "../../../memory/index.js";
import type { EmbeddedContextFile } from "../../pi-embedded-helpers.js";
import type { WorkspaceBootstrapFile } from "../../workspace.js";

const hoisted = vi.hoisted(() => {
  type BootstrapContext = {
    bootstrapFiles: WorkspaceBootstrapFile[];
    contextFiles: EmbeddedContextFile[];
  };
  const spawnSubagentDirectMock = vi.fn();
  const createAgentSessionMock = vi.fn();
  const sessionManagerOpenMock = vi.fn();
  const resolveSandboxContextMock = vi.fn();
  const subscribeEmbeddedPiSessionMock = vi.fn();
  const acquireSessionWriteLockMock = vi.fn();
  const resolveBootstrapContextForRunMock = vi.fn<() => Promise<BootstrapContext>>(async () => ({
    bootstrapFiles: [],
    contextFiles: [],
  }));
  const buildEmbeddedSystemPromptMock = vi.fn<(params: unknown) => string>(() => "system prompt");
  const applyExtraParamsToAgentMock = vi.fn<
    (
      agent: unknown,
      cfg: unknown,
      provider: unknown,
      modelId: unknown,
      extraParamsOverride: unknown,
      thinkingLevel: unknown,
      agentId: unknown,
      workspaceDir: unknown,
      model: unknown,
      agentDir: unknown,
    ) => { effectiveExtraParams: Record<string, unknown> | undefined }
  >(() => ({ effectiveExtraParams: undefined }));
  const createCrawClawCodingToolsMock = vi.fn(
    (options?: { workspaceDir?: string; spawnWorkspaceDir?: string }) => [
      {
        name: "sessions_spawn",
        execute: async (
          _callId: string,
          input: { task?: string },
          _session?: unknown,
          _abortSignal?: unknown,
          _ctx?: unknown,
        ) =>
          await spawnSubagentDirectMock(
            {
              task: input.task ?? "",
            },
            {
              workspaceDir: options?.spawnWorkspaceDir ?? options?.workspaceDir,
            },
          ),
      },
    ],
  );
  const getGlobalHookRunnerMock = vi.fn<() => unknown>(() => undefined);
  const initializeGlobalHookRunnerMock = vi.fn();
  const runMemoryRuntimeMaintenanceMock = vi.fn(async (_params?: unknown) => undefined);
  const sessionManager = {
    getLeafEntry: vi.fn(() => null),
    branch: vi.fn(),
    resetLeaf: vi.fn(),
    buildSessionContext: vi.fn<() => { messages: AgentMessage[] }>(() => ({ messages: [] })),
    appendCustomEntry: vi.fn(),
  };
  return {
    spawnSubagentDirectMock,
    createAgentSessionMock,
    sessionManagerOpenMock,
    resolveSandboxContextMock,
    subscribeEmbeddedPiSessionMock,
    acquireSessionWriteLockMock,
    resolveBootstrapContextForRunMock,
    buildEmbeddedSystemPromptMock,
    applyExtraParamsToAgentMock,
    createCrawClawCodingToolsMock,
    getGlobalHookRunnerMock,
    initializeGlobalHookRunnerMock,
    runMemoryRuntimeMaintenanceMock,
    sessionManager,
  };
});

export function getHoisted() {
  return hoisted;
}

vi.mock("@mariozechner/pi-coding-agent", () => {
  class AuthStorage {}
  class DefaultResourceLoader {
    async reload() {}
  }
  class ModelRegistry {}

  return {
    AuthStorage,
    createAgentSession: (...args: unknown[]) => hoisted.createAgentSessionMock(...args),
    DefaultResourceLoader,
    ModelRegistry,
    SessionManager: {
      open: (...args: unknown[]) => hoisted.sessionManagerOpenMock(...args),
    },
  };
});

vi.mock("../../subagent-spawn.js", () => ({
  SUBAGENT_SPAWN_MODES: ["run", "session"],
  spawnSubagentDirect: (...args: unknown[]) => hoisted.spawnSubagentDirectMock(...args),
}));

vi.mock("../../sandbox.js", () => ({
  resolveSandboxContext: (...args: unknown[]) => hoisted.resolveSandboxContextMock(...args),
}));

vi.mock("../../session-tool-result-guard-wrapper.js", () => ({
  guardSessionManager: () => hoisted.sessionManager,
}));

vi.mock("../../pi-embedded-subscribe.js", () => ({
  subscribeEmbeddedPiSession: (...args: unknown[]) =>
    hoisted.subscribeEmbeddedPiSessionMock(...args),
}));

vi.mock("../../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: hoisted.getGlobalHookRunnerMock,
  initializeGlobalHookRunner: hoisted.initializeGlobalHookRunnerMock,
}));

vi.mock("../../../infra/machine-name.js", () => ({
  getMachineDisplayName: async () => "test-host",
}));

vi.mock("../../../infra/net/undici-global-dispatcher.js", () => ({
  ensureGlobalUndiciEnvProxyDispatcher: () => {},
  ensureGlobalUndiciStreamTimeouts: () => {},
}));

vi.mock("../../bootstrap-files.js", () => ({
  makeBootstrapWarn: () => () => {},
  resolveBootstrapContextForRun: hoisted.resolveBootstrapContextForRunMock,
}));

vi.mock("../../skills.js", () => ({
  applySkillEnvOverrides: () => () => {},
  resolveSkillsPromptForRun: () => "",
}));

vi.mock("../skills-runtime.js", () => ({
  resolveEmbeddedRunSkillEntries: () => ({
    skillEntries: [],
  }),
}));

vi.mock("../memory-runtime-maintenance.js", () => ({
  runMemoryRuntimeMaintenance: (params: unknown) => hoisted.runMemoryRuntimeMaintenanceMock(params),
}));

vi.mock("../../docs-path.js", () => ({
  resolveCrawClawDocsPath: async () => undefined,
}));

vi.mock("../../pi-project-settings.js", () => ({
  createPreparedEmbeddedPiSettingsManager: () => ({}),
}));

vi.mock("../../pi-settings.js", () => ({
  applyPiAutoCompactionGuard: () => {},
}));

vi.mock("../extensions.js", () => ({
  buildEmbeddedExtensionFactories: () => [],
}));

vi.mock("../google.js", () => ({
  logToolSchemasForGoogle: () => {},
  sanitizeSessionHistory: async ({ messages }: { messages: unknown[] }) => messages,
  sanitizeToolsForGoogle: ({ tools }: { tools: unknown[] }) => tools,
  validateReplayTurns: async ({ messages }: { messages: unknown[] }) => messages,
}));

vi.mock("../../session-file-repair.js", () => ({
  repairSessionFileIfNeeded: async () => {},
}));

vi.mock("../session-manager-cache.js", () => ({
  prewarmSessionFile: async () => {},
  trackSessionManagerAccess: () => {},
}));

vi.mock("../session-manager-init.js", () => ({
  prepareSessionManagerForRun: async () => {},
}));

vi.mock("../../session-write-lock.js", () => ({
  acquireSessionWriteLock: (...args: unknown[]) => hoisted.acquireSessionWriteLockMock(...args),
  resolveSessionLockMaxHoldFromTimeout: () => 1,
}));

vi.mock("../tool-result-context-guard.js", () => ({
  installToolResultContextGuard: () => () => {},
}));

vi.mock("../wait-for-idle-before-flush.js", () => ({
  flushPendingToolResultsAfterIdle: async () => {},
}));

vi.mock("../runs.js", () => ({
  setActiveEmbeddedRun: () => {},
  clearActiveEmbeddedRun: () => {},
  updateActiveEmbeddedRunSnapshot: () => {},
}));

vi.mock("./images.js", () => ({
  detectAndLoadPromptImages: async () => ({ images: [] }),
}));

vi.mock("../../system-prompt-params.js", () => ({
  buildSystemPromptParams: () => ({
    runtimeInfo: {},
    userTimezone: "UTC",
    userTime: "00:00",
    userTimeFormat: "24h",
  }),
}));

vi.mock("../../system-prompt-report.js", () => ({
  buildSystemPromptReport: () => undefined,
}));

vi.mock("../system-prompt.js", () => ({
  applySystemPromptOverrideToSession: () => {},
  buildEmbeddedSystemPrompt: (params: unknown) => hoisted.buildEmbeddedSystemPromptMock(params),
  buildEmbeddedSystemPromptSections: (params: unknown) => [
    {
      id: "mock-system-prompt",
      role: "system_prompt",
      content: hoisted.buildEmbeddedSystemPromptMock(params),
      source: "test",
      cacheable: true,
    },
  ],
  createSystemPromptOverride: (prompt: string) => () => prompt,
}));

vi.mock("../extra-params.js", () => ({
  applyExtraParamsToAgent: (
    agent: unknown,
    cfg: unknown,
    provider: unknown,
    modelId: unknown,
    extraParamsOverride: unknown,
    thinkingLevel: unknown,
    agentId: unknown,
    workspaceDir: unknown,
    model: unknown,
    agentDir: unknown,
  ) =>
    hoisted.applyExtraParamsToAgentMock(
      agent,
      cfg,
      provider,
      modelId,
      extraParamsOverride,
      thinkingLevel,
      agentId,
      workspaceDir,
      model,
      agentDir,
    ),
  resolveAgentTransportOverride: () => undefined,
}));

vi.mock("../../openai-ws-stream.js", () => ({
  createOpenAIWebSocketStreamFn: vi.fn(),
  releaseWsSession: () => {},
}));

vi.mock("../../anthropic-payload-log.js", () => ({
  createAnthropicPayloadLogger: () => undefined,
}));

vi.mock("../../cache-trace.js", () => ({
  createCacheTrace: () => undefined,
}));

vi.mock("../../pi-tools.js", () => ({
  createCrawClawCodingTools: (options?: { workspaceDir?: string; spawnWorkspaceDir?: string }) =>
    hoisted.createCrawClawCodingToolsMock(options),
  resolveToolLoopDetectionConfig: () => undefined,
}));

vi.mock("../../pi-bundle-mcp-tools.js", () => ({
  createBundleMcpToolRuntime: async () => undefined,
  getOrCreateSessionMcpRuntime: async () => undefined,
}));

vi.mock("../../pi-bundle-lsp-runtime.js", () => ({
  createBundleLspToolRuntime: async () => undefined,
}));

vi.mock("../../model-selection.js", () => ({
  normalizeProviderId: (providerId?: string) => providerId?.trim().toLowerCase() ?? "",
  resolveDefaultModelForAgent: () => ({ provider: "openai", model: "gpt-test" }),
}));

vi.mock("../../anthropic-vertex-stream.js", () => ({
  createAnthropicVertexStreamFnForModel: vi.fn(),
}));

vi.mock("../../custom-api-registry.js", () => ({
  ensureCustomApiRegistered: () => {},
}));

vi.mock("../../model-auth.js", () => ({
  resolveModelAuthMode: () => undefined,
}));

vi.mock("../../model-tool-support.js", () => ({
  supportsModelTools: () => true,
}));

vi.mock("../../provider-stream.js", () => ({
  registerProviderStreamForModel: vi.fn(),
}));

vi.mock("../../owner-display.js", () => ({
  resolveOwnerDisplaySetting: () => ({
    ownerDisplay: undefined,
    ownerDisplaySecret: undefined,
  }),
}));

vi.mock("../../sandbox/runtime-status.js", () => ({
  resolveSandboxRuntimeStatus: () => ({
    agentId: "main",
    sessionKey: "agent:main:main",
    mainSessionKey: "agent:main:main",
    mode: "off",
    sandboxed: false,
    toolPolicy: { allow: [], deny: [], sources: { allow: { key: "" }, deny: { key: "" } } },
  }),
}));

vi.mock("../../tool-call-id.js", () => ({
  extractToolCallsFromAssistant: (message: { content?: unknown }) => {
    const content = message?.content;
    if (!Array.isArray(content)) {
      return [];
    }
    return content.filter(
      (part) =>
        part &&
        typeof part === "object" &&
        ((part as { type?: unknown }).type === "toolUse" ||
          (part as { type?: unknown }).type === "toolCall"),
    );
  },
  sanitizeToolCallIdsForCloudCodeAssist: <T>(messages: T) => messages,
}));

vi.mock("../../tool-fs-policy.js", () => ({
  resolveEffectiveToolFsWorkspaceOnly: () => false,
}));

vi.mock("../../tool-policy.js", () => ({
  normalizeToolName: (name: string) => name,
}));

vi.mock("../../transcript-policy.js", () => ({
  resolveTranscriptPolicy: () => ({
    allowSyntheticToolResults: false,
  }),
}));

vi.mock("../cache-ttl.js", () => ({
  appendCacheTtlTimestamp: (
    sessionManager: { appendCustomEntry?: (customType: string, data: unknown) => void },
    data: unknown,
  ) => sessionManager.appendCustomEntry?.("crawclaw.cache-ttl", data),
  isCacheTtlEligibleProvider: (provider?: string) => provider === "anthropic",
}));

vi.mock("../compaction-runtime-context.js", () => ({
  buildEmbeddedCompactionRuntimeContext: () => ({}),
}));

vi.mock("../compaction-safety-timeout.js", () => ({
  resolveCompactionTimeoutMs: () => undefined,
}));

vi.mock("../history.js", () => ({
  getHistoryLimitFromSessionKey: () => undefined,
  limitHistoryTurns: <T>(messages: T) => messages,
}));

vi.mock("../logger.js", () => ({
  log: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    isEnabled: () => false,
    withContext() {
      return this;
    },
  },
}));

vi.mock("../message-action-discovery-input.js", () => ({
  buildEmbeddedMessageActionDiscoveryInput: () => undefined,
}));

vi.mock("../model.js", () => ({
  buildModelAliasLines: () => [],
}));

vi.mock("../sandbox-info.js", () => ({
  buildEmbeddedSandboxInfo: () => undefined,
}));

vi.mock("../thinking.js", () => ({
  dropThinkingBlocks: <T>(messages: T) => messages,
}));

vi.mock("../tool-name-allowlist.js", () => ({
  collectAllowedToolNames: () => undefined,
}));

vi.mock("../tool-split.js", () => ({
  splitSdkTools: ({ tools }: { tools: unknown[] }) => ({
    builtInTools: [],
    customTools: tools,
  }),
}));

vi.mock("../utils.js", () => ({
  describeUnknownError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  mapThinkingLevel: () => undefined,
}));

vi.mock("./compaction-retry-aggregate-timeout.js", () => ({
  waitForCompactionRetryWithAggregateTimeout: async () => ({
    timedOut: false,
    aborted: false,
  }),
}));

vi.mock("./compaction-timeout.js", () => ({
  resolveRunTimeoutDuringCompaction: () => "abort",
  resolveRunTimeoutWithCompactionGraceMs: ({
    runTimeoutMs,
    compactionTimeoutMs,
  }: {
    runTimeoutMs: number;
    compactionTimeoutMs: number;
  }) => runTimeoutMs + compactionTimeoutMs,
  selectCompactionTimeoutSnapshot: ({
    currentSnapshot,
    currentSessionId,
  }: {
    currentSnapshot: unknown[];
    currentSessionId: string;
  }) => ({
    messagesSnapshot: currentSnapshot,
    sessionIdUsed: currentSessionId,
    source: "current",
  }),
  shouldFlagCompactionTimeout: () => false,
}));

vi.mock("./history-image-prune.js", () => ({
  pruneProcessedHistoryImages: <T>(messages: T) => messages,
}));

let runEmbeddedAttemptPromise:
  | Promise<typeof import("./attempt.js").runEmbeddedAttempt>
  | undefined;

async function loadRunEmbeddedAttempt() {
  runEmbeddedAttemptPromise ??= import("./attempt.js").then((mod) => mod.runEmbeddedAttempt);
  return await runEmbeddedAttemptPromise;
}

export async function getRunEmbeddedAttempt() {
  return await loadRunEmbeddedAttempt();
}

export type MutableSession = {
  sessionId: string;
  messages: unknown[];
  isCompacting: boolean;
  isStreaming: boolean;
  subscriptions?: Array<(event: { type: string }) => void>;
  agent: {
    streamFn?: unknown;
    state: {
      messages: unknown[];
    };
  };
  prompt: (prompt: string, options?: { images?: unknown[] }) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  steer: (text: string) => Promise<void>;
  subscribe?: (listener: (event: { type: string }) => void) => () => void;
};

export function createSubscriptionMock() {
  return {
    assistantTexts: [] as string[],
    toolMetas: [] as Array<{ toolName: string; meta?: string }>,
    unsubscribe: () => {},
    waitForCompactionRetry: async () => {},
    getMessagingToolSentTexts: () => [] as string[],
    getMessagingToolSentMediaUrls: () => [] as string[],
    getMessagingToolSentTargets: () => [] as unknown[],
    getSuccessfulCronAdds: () => 0,
    didSendViaMessagingTool: () => false,
    didSendDeterministicApprovalPrompt: () => false,
    getLastToolError: () => undefined,
    getUsageTotals: () => undefined,
    getCompactionCount: () => 0,
    isCompacting: () => false,
  };
}

export function resetEmbeddedAttemptHarness(
  params: {
    includeSpawnSubagent?: boolean;
    subscribeImpl?: () => ReturnType<typeof createSubscriptionMock>;
    sessionMessages?: AgentMessage[];
  } = {},
) {
  if (params.includeSpawnSubagent) {
    hoisted.spawnSubagentDirectMock.mockReset().mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:main:subagent:child",
      runId: "run-child",
    });
  }
  hoisted.createAgentSessionMock.mockReset();
  hoisted.sessionManagerOpenMock.mockReset().mockReturnValue(hoisted.sessionManager);
  hoisted.resolveSandboxContextMock.mockReset();
  hoisted.acquireSessionWriteLockMock.mockReset().mockResolvedValue({
    release: async () => {},
  });
  hoisted.resolveBootstrapContextForRunMock.mockReset().mockResolvedValue({
    bootstrapFiles: [],
    contextFiles: [],
  });
  hoisted.buildEmbeddedSystemPromptMock.mockReset().mockReturnValue("system prompt");
  hoisted.applyExtraParamsToAgentMock.mockReset().mockReturnValue({
    effectiveExtraParams: undefined,
  });
  hoisted.createCrawClawCodingToolsMock
    .mockReset()
    .mockImplementation((options?: { workspaceDir?: string; spawnWorkspaceDir?: string }) => [
      {
        name: "sessions_spawn",
        execute: async (
          _callId: string,
          input: { task?: string },
          _session?: unknown,
          _abortSignal?: unknown,
          _ctx?: unknown,
        ) =>
          await hoisted.spawnSubagentDirectMock(
            {
              task: input.task ?? "",
            },
            {
              workspaceDir: options?.spawnWorkspaceDir ?? options?.workspaceDir,
            },
          ),
      },
    ]);
  hoisted.getGlobalHookRunnerMock.mockReset().mockReturnValue(undefined);
  hoisted.runMemoryRuntimeMaintenanceMock.mockReset().mockResolvedValue(undefined);
  hoisted.subscribeEmbeddedPiSessionMock.mockReset().mockReturnValue({
    assistantTexts: [],
    toolMetas: [],
    unsubscribe: () => {},
    waitForCompactionRetry: async () => false,
    isCompactionInFlight: () => false,
    isCompacting: () => false,
    getMessagingToolSentTexts: () => [],
    getMessagingToolSentMediaUrls: () => [],
    getMessagingToolSentTargets: () => [],
    getSuccessfulCronAdds: () => 0,
    didSendViaMessagingTool: () => false,
    getLastToolError: () => undefined,
    getUsageTotals: () => undefined,
    getCompactionCount: () => 0,
  });
  hoisted.sessionManager.getLeafEntry.mockReset().mockReturnValue(null);
  hoisted.sessionManager.branch.mockReset();
  hoisted.sessionManager.resetLeaf.mockReset();
  hoisted.sessionManager.buildSessionContext
    .mockReset()
    .mockReturnValue({ messages: params.sessionMessages ?? [] });
  hoisted.sessionManager.appendCustomEntry.mockReset();
  if (params.subscribeImpl) {
    hoisted.subscribeEmbeddedPiSessionMock.mockImplementation(params.subscribeImpl);
  }
}

export async function cleanupTempPaths(tempPaths: string[]) {
  while (tempPaths.length > 0) {
    const target = tempPaths.pop();
    if (target) {
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}

export function createDefaultEmbeddedSession(params?: {
  prompt?: (
    session: MutableSession,
    prompt: string,
    options?: { images?: unknown[] },
  ) => Promise<void>;
}): MutableSession {
  const session: MutableSession = {
    sessionId: "embedded-session",
    messages: [],
    isCompacting: false,
    isStreaming: false,
    subscriptions: [],
    agent: {
      state: {
        get messages() {
          return session.messages;
        },
        set messages(messages: unknown[]) {
          session.messages = [...messages];
        },
      },
    },
    prompt: async (prompt, options) => {
      if (params?.prompt) {
        await params.prompt(session, prompt, options);
        return;
      }
      session.messages = [
        ...session.messages,
        { role: "assistant", content: "done", timestamp: 2 },
      ];
    },
    abort: async () => {},
    dispose: () => {},
    steer: async () => {},
    subscribe: (listener) => {
      session.subscriptions?.push(listener);
      return () => {
        session.subscriptions = session.subscriptions?.filter((entry) => entry !== listener) ?? [];
      };
    },
  };

  return session;
}

export function createMemoryRuntimeBootstrapAndAssemble() {
  return {
    bootstrap: vi.fn(async (_params: { sessionKey?: string }) => ({ bootstrapped: true })),
    assemble: vi.fn(
      async ({ messages }: { messages: AgentMessage[]; sessionKey?: string; model?: string }) => ({
        messages,
        estimatedTokens: 1,
      }),
    ),
  };
}

export function expectCalledWithSessionKey(mock: ReturnType<typeof vi.fn>, sessionKey: string) {
  expect(mock).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionKey,
    }),
  );
}

export const testModel = {
  api: "openai-completions",
  provider: "openai",
  compat: {},
  contextWindow: 8192,
  input: ["text"],
} as unknown as Model<Api>;

export const cacheTtlEligibleModel = {
  api: "anthropic",
  provider: "anthropic",
  compat: {},
  contextWindow: 8192,
  input: ["text"],
} as unknown as Model<Api>;

export async function createMemoryRuntimeAttemptRunner(params: {
  memoryRuntime: {
    bootstrap?: (params: {
      sessionId: string;
      sessionKey?: string;
      sessionFile: string;
    }) => Promise<MemoryBootstrapResult>;
    maintain?:
      | boolean
      | ((params: {
          sessionId: string;
          sessionKey?: string;
          sessionFile: string;
          runtimeContext?: Record<string, unknown>;
        }) => Promise<{
          changed: boolean;
          bytesFreed: number;
          rewrittenEntries: number;
          reason?: string;
        }>);
    assemble: (params: {
      sessionId: string;
      sessionKey?: string;
      messages: AgentMessage[];
      tokenBudget?: number;
      model?: string;
    }) => Promise<MemoryAssembleResult>;
    afterTurn?: (params: {
      sessionId: string;
      sessionKey?: string;
      sessionFile: string;
      messages: AgentMessage[];
      prePromptMessageCount: number;
      tokenBudget?: number;
      runtimeContext?: Record<string, unknown>;
    }) => Promise<void>;
    ingestBatch?: (params: {
      sessionId: string;
      sessionKey?: string;
      messages: AgentMessage[];
    }) => Promise<MemoryIngestBatchResult>;
    ingest?: (params: {
      sessionId: string;
      sessionKey?: string;
      message: AgentMessage;
    }) => Promise<MemoryIngestResult>;
    compact?: (params: {
      sessionId: string;
      sessionKey?: string;
      sessionFile: string;
      tokenBudget?: number;
    }) => Promise<MemoryCompactResult>;
    info?: Partial<MemoryRuntimeInfo>;
  };
  attemptOverrides?: Partial<Parameters<Awaited<ReturnType<typeof loadRunEmbeddedAttempt>>>[0]>;
  sessionKey: string;
  tempPaths: string[];
}) {
  const { maintain: rawMaintain, ...memoryRuntimeRest } = params.memoryRuntime;
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "crawclaw-memory-runtime-workspace-"),
  );
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-runtime-agent-"));
  const sessionFile = path.join(workspaceDir, "session.jsonl");
  params.tempPaths.push(workspaceDir, agentDir);
  await fs.writeFile(sessionFile, "", "utf8");
  const seedMessages: AgentMessage[] = [
    { role: "user", content: "seed", timestamp: 1 } as AgentMessage,
  ];
  const infoId = params.memoryRuntime.info?.id ?? "test-memory-runtime";
  const infoName = params.memoryRuntime.info?.name ?? "Test Memory Runtime";
  const infoVersion = params.memoryRuntime.info?.version ?? "0.0.1";
  const maintain =
    typeof rawMaintain === "function"
      ? rawMaintain
      : rawMaintain
        ? async () => ({
            changed: false,
            bytesFreed: 0,
            rewrittenEntries: 0,
            reason: "test maintenance",
          })
        : undefined;

  hoisted.sessionManager.buildSessionContext
    .mockReset()
    .mockReturnValue({ messages: seedMessages });

  hoisted.createAgentSessionMock.mockImplementation(async () => ({
    session: createDefaultEmbeddedSession(),
  }));

  const runEmbeddedAttempt = await loadRunEmbeddedAttempt();
  return await runEmbeddedAttempt({
    sessionId: "embedded-session",
    sessionKey: params.sessionKey,
    sessionFile,
    workspaceDir,
    agentDir,
    config: {},
    prompt: "hello",
    timeoutMs: 10_000,
    runId: "run-memory-runtime-forwarding",
    provider: "openai",
    modelId: "gpt-test",
    model: testModel,
    authStorage: {} as never,
    modelRegistry: {} as never,
    thinkLevel: "off",
    senderIsOwner: true,
    disableMessageTool: true,
    contextTokenBudget: 2048,
    memoryRuntime: {
      ...memoryRuntimeRest,
      ingest:
        params.memoryRuntime.ingest ??
        (async () => ({
          ingested: true,
        })),
      compact:
        params.memoryRuntime.compact ??
        (async () => ({
          ok: false,
          compacted: false,
          reason: "not used in this test",
        })),
      ...(maintain ? { maintain } : {}),
      info: {
        id: infoId,
        name: infoName,
        version: infoVersion,
      },
    },
    ...params.attemptOverrides,
  });
}

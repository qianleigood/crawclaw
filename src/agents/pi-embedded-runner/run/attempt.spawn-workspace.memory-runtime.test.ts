import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AttemptMemoryRuntime,
  assembleAttemptMemoryRuntime,
  finalizeAttemptMemoryRuntimeTurn,
  runAttemptMemoryRuntimeBootstrap,
} from "./attempt.memory-runtime-helpers.js";
import {
  cleanupTempPaths,
  createMemoryRuntimeBootstrapAndAssemble,
  createMemoryRuntimeAttemptRunner,
  expectCalledWithSessionKey,
  getHoisted,
  resetEmbeddedAttemptHarness,
} from "./attempt.spawn-workspace.test-support.js";

const hoisted = getHoisted();
const embeddedSessionId = "embedded-session";
const sessionFile = "/tmp/session.jsonl";
const seedMessage = { role: "user", content: "seed", timestamp: 1 } as AgentMessage;
const doneMessage = { role: "assistant", content: "done", timestamp: 2 } as unknown as AgentMessage;

function createTestMemoryRuntime(params: Partial<AttemptMemoryRuntime>): AttemptMemoryRuntime {
  return {
    info: {
      id: "test-memory-runtime",
      name: "Test Memory Runtime",
      version: "0.0.1",
    },
    ingest: async () => ({ ingested: true }),
    compact: async () => ({
      ok: false,
      compacted: false,
      reason: "not used in this test",
    }),
    ...params,
  } as AttemptMemoryRuntime;
}

async function runBootstrap(
  sessionKey: string,
  memoryRuntime: AttemptMemoryRuntime,
  overrides: Partial<Parameters<typeof runAttemptMemoryRuntimeBootstrap>[0]> = {},
) {
  await runAttemptMemoryRuntimeBootstrap({
    hadSessionFile: true,
    memoryRuntime,
    sessionId: embeddedSessionId,
    sessionKey,
    sessionFile,
    sessionManager: hoisted.sessionManager,
    runtimeContext: {},
    runMaintenance: hoisted.runMemoryRuntimeMaintenanceMock,
    warn: () => {},
    ...overrides,
  });
}

async function runAssemble(
  sessionKey: string,
  memoryRuntime: AttemptMemoryRuntime,
  overrides: Partial<Parameters<typeof assembleAttemptMemoryRuntime>[0]> = {},
) {
  await assembleAttemptMemoryRuntime({
    memoryRuntime,
    sessionId: embeddedSessionId,
    sessionKey,
    messages: [seedMessage],
    tokenBudget: 2048,
    modelId: "gpt-test",
    ...overrides,
  });
}

async function finalizeTurn(
  sessionKey: string,
  memoryRuntime: AttemptMemoryRuntime,
  overrides: Partial<Parameters<typeof finalizeAttemptMemoryRuntimeTurn>[0]> = {},
) {
  await finalizeAttemptMemoryRuntimeTurn({
    memoryRuntime,
    promptError: false,
    aborted: false,
    yieldAborted: false,
    sessionIdUsed: embeddedSessionId,
    sessionKey,
    sessionFile,
    messagesSnapshot: [doneMessage],
    prePromptMessageCount: 0,
    tokenBudget: 2048,
    runtimeContext: {},
    runMaintenance: hoisted.runMemoryRuntimeMaintenanceMock,
    sessionManager: hoisted.sessionManager,
    warn: () => {},
    ...overrides,
  });
}

describe("runEmbeddedAttempt memory runtime sessionKey forwarding", () => {
  const sessionKey = "agent:main:discord:channel:test-memory-runtime";
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetEmbeddedAttemptHarness();
    hoisted.runMemoryRuntimeMaintenanceMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanupTempPaths(tempPaths);
  });

  it("forwards sessionKey to bootstrap, assemble, and afterTurn", async () => {
    const { bootstrap, assemble } = createMemoryRuntimeBootstrapAndAssemble();
    const afterTurn = vi.fn(async (_params: { sessionKey?: string }) => {});
    const memoryRuntime = createTestMemoryRuntime({
      bootstrap,
      assemble,
      afterTurn,
    });

    await runBootstrap(sessionKey, memoryRuntime);
    await runAssemble(sessionKey, memoryRuntime);
    await finalizeTurn(sessionKey, memoryRuntime);

    expectCalledWithSessionKey(bootstrap, sessionKey);
    expectCalledWithSessionKey(assemble, sessionKey);
    expectCalledWithSessionKey(afterTurn, sessionKey);
  });

  it("forwards modelId to assemble", async () => {
    const { bootstrap, assemble } = createMemoryRuntimeBootstrapAndAssemble();
    const memoryRuntime = createTestMemoryRuntime({ bootstrap, assemble });

    await runBootstrap(sessionKey, memoryRuntime);
    await runAssemble(sessionKey, memoryRuntime);

    expect(assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-test",
      }),
    );
  });

  it("forwards sessionKey to ingestBatch when afterTurn is absent", async () => {
    const { bootstrap, assemble } = createMemoryRuntimeBootstrapAndAssemble();
    const ingestBatch = vi.fn(
      async (_params: { sessionKey?: string; messages: AgentMessage[] }) => ({ ingestedCount: 1 }),
    );

    await finalizeTurn(sessionKey, createTestMemoryRuntime({ bootstrap, assemble, ingestBatch }), {
      messagesSnapshot: [seedMessage, doneMessage],
      prePromptMessageCount: 1,
    });

    expectCalledWithSessionKey(ingestBatch, sessionKey);
  });

  it("forwards sessionKey to per-message ingest when ingestBatch is absent", async () => {
    const { bootstrap, assemble } = createMemoryRuntimeBootstrapAndAssemble();
    const ingest = vi.fn(async (_params: { sessionKey?: string; message: AgentMessage }) => ({
      ingested: true,
    }));

    await finalizeTurn(sessionKey, createTestMemoryRuntime({ bootstrap, assemble, ingest }), {
      messagesSnapshot: [seedMessage, doneMessage],
      prePromptMessageCount: 1,
    });

    expect(ingest).toHaveBeenCalled();
    expect(
      ingest.mock.calls.every((call) => {
        const params = call[0];
        return params.sessionKey === sessionKey;
      }),
    ).toBe(true);
  });

  it("forwards silentExpected to the embedded subscription", async () => {
    const { bootstrap, assemble } = createMemoryRuntimeBootstrapAndAssemble();

    const result = await createMemoryRuntimeAttemptRunner({
      memoryRuntime: {
        bootstrap,
        assemble,
      },
      attemptOverrides: {
        silentExpected: true,
      },
      sessionKey,
      tempPaths,
    });

    expect(result.promptError).toBeNull();
    expect(hoisted.subscribeEmbeddedPiSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        silentExpected: true,
      }),
    );
  });

  it("passes the model-scaled memory budget to assemble", async () => {
    const { bootstrap, assemble } = createMemoryRuntimeBootstrapAndAssemble();

    await createMemoryRuntimeAttemptRunner({
      memoryRuntime: {
        bootstrap,
        assemble,
      },
      attemptOverrides: {
        contextTokenBudget: 1_048_576,
        contextWindowInfo: { tokens: 1_048_576, source: "modelsConfig" },
      },
      sessionKey,
      tempPaths,
    });

    expect(assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenBudget: 6_000,
      }),
    );
  });

  it("skips maintenance when afterTurn fails", async () => {
    const { bootstrap, assemble } = createMemoryRuntimeBootstrapAndAssemble();
    const afterTurn = vi.fn(async () => {
      throw new Error("afterTurn failed");
    });

    await finalizeTurn(sessionKey, createTestMemoryRuntime({ bootstrap, assemble, afterTurn }));

    expect(afterTurn).toHaveBeenCalled();
    expect(hoisted.runMemoryRuntimeMaintenanceMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: "turn" }),
    );
  });

  it("runs startup maintenance for existing sessions even without bootstrap()", async () => {
    const { assemble } = createMemoryRuntimeBootstrapAndAssemble();

    await runBootstrap(
      sessionKey,
      createTestMemoryRuntime({
        assemble,
        maintain: async () => ({
          changed: false,
          bytesFreed: 0,
          rewrittenEntries: 0,
          reason: "test maintenance",
        }),
      }),
    );

    expect(hoisted.runMemoryRuntimeMaintenanceMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "bootstrap" }),
    );
  });

  it("skips maintenance when ingestBatch fails", async () => {
    const { bootstrap, assemble } = createMemoryRuntimeBootstrapAndAssemble();
    const ingestBatch = vi.fn(async () => {
      throw new Error("ingestBatch failed");
    });

    await finalizeTurn(sessionKey, createTestMemoryRuntime({ bootstrap, assemble, ingestBatch }), {
      messagesSnapshot: [seedMessage, doneMessage],
      prePromptMessageCount: 1,
    });

    expect(ingestBatch).toHaveBeenCalled();
    expect(hoisted.runMemoryRuntimeMaintenanceMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: "turn" }),
    );
  });
});

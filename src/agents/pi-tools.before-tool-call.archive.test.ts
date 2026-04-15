import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { getRuntimeConfigSnapshot } from "../config/config.js";
import { resetDiagnosticSessionStateForTest } from "../logging/diagnostic-session-state.js";
import type { SessionState } from "../logging/diagnostic-session-state.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import type { HookRunner } from "../plugins/hooks.js";
import { resolveSharedContextArchiveService } from "./context-archive/runtime.js";
import type { ContextArchiveService } from "./context-archive/service.js";
import {
  runBeforeToolCallHook,
  wrapToolWithBeforeToolCallHook,
  __testing as beforeToolCallTesting,
} from "./pi-tools.before-tool-call.js";
import { beforeToolCallRuntime } from "./pi-tools.before-tool-call.runtime.js";
import type { LoopDetectionResult } from "./tool-loop-detection.js";
import type { AnyAgentTool } from "./tools/common.js";

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    getRuntimeConfigSnapshot: vi.fn(),
  };
});

vi.mock("./context-archive/runtime.js", () => ({
  resolveSharedContextArchiveService: vi.fn(),
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: vi.fn(),
}));

vi.mock("./pi-tools.before-tool-call.runtime.js", () => ({
  beforeToolCallRuntime: {
    getDiagnosticSessionState: vi.fn(),
    updateDiagnosticSessionState: vi.fn(),
    getAgentRuntimeState: vi.fn(),
    logToolLoopAction: vi.fn(),
    detectToolCallLoop: vi.fn(),
    recordToolCall: vi.fn(),
    recordToolCallOutcome: vi.fn(),
  },
}));

const mockGetRuntimeConfigSnapshot = vi.mocked(getRuntimeConfigSnapshot);
const mockResolveSharedContextArchiveService = vi.mocked(resolveSharedContextArchiveService);
const mockGetGlobalHookRunner = vi.mocked(getGlobalHookRunner);
const mockBeforeToolCallRuntime = beforeToolCallRuntime as unknown as {
  getDiagnosticSessionState: ReturnType<typeof vi.fn>;
  updateDiagnosticSessionState: ReturnType<typeof vi.fn>;
  getAgentRuntimeState: ReturnType<typeof vi.fn>;
  logToolLoopAction: ReturnType<typeof vi.fn>;
  detectToolCallLoop: ReturnType<typeof vi.fn>;
  recordToolCall: ReturnType<typeof vi.fn>;
  recordToolCallOutcome: ReturnType<typeof vi.fn>;
};

function createArchiveServiceFixture() {
  return {
    createRun: vi.fn().mockResolvedValue({ id: "carun-1" }),
    appendEvent: vi.fn().mockResolvedValue({ id: "caevt-1" }),
  } satisfies Pick<ContextArchiveService, "createRun" | "appendEvent">;
}

describe("before_tool_call archive capture", () => {
  beforeEach(() => {
    const sessionState: SessionState = {
      state: "processing",
      lastActivity: Date.now(),
      queueDepth: 0,
      loopProgressHistory: [],
    };
    const noLoop: LoopDetectionResult = { stuck: false };
    const hookRunner: Pick<HookRunner, "hasHooks" | "runBeforeToolCall"> = {
      hasHooks: vi.fn().mockReturnValue(false),
      runBeforeToolCall: vi.fn(),
    };

    resetDiagnosticSessionStateForTest();
    beforeToolCallTesting.archiveDecisionRunIdsByScope.clear();
    mockGetRuntimeConfigSnapshot.mockReturnValue({
      memory: {
        contextArchive: {
          mode: "replay",
        },
      },
    } satisfies CrawClawConfig);
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as HookRunner);
    mockBeforeToolCallRuntime.getDiagnosticSessionState.mockReturnValue(sessionState);
    mockBeforeToolCallRuntime.updateDiagnosticSessionState.mockReturnValue(sessionState);
    mockBeforeToolCallRuntime.getAgentRuntimeState.mockReturnValue(undefined);
    mockBeforeToolCallRuntime.detectToolCallLoop.mockReturnValue(noLoop);
    mockBeforeToolCallRuntime.recordToolCall.mockImplementation(() => undefined);
    mockBeforeToolCallRuntime.recordToolCallOutcome.mockImplementation(() => undefined);
  });

  it("archives a default admission decision when no hook changes the tool call", async () => {
    const archive = createArchiveServiceFixture();
    mockResolveSharedContextArchiveService.mockResolvedValue(
      archive as unknown as ContextArchiveService,
    );

    await expect(
      runBeforeToolCallHook({
        toolName: "read",
        params: { path: "/tmp/file" },
        ctx: {
          runId: "run-1",
          sessionKey: "agent:main:session-1",
          sessionId: "session-1",
          agentId: "main",
        },
      }),
    ).resolves.toEqual({
      blocked: false,
      params: { path: "/tmp/file" },
    });

    expect(archive.createRun).toHaveBeenCalledTimes(1);
    expect(archive.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool.guard_admission",
        payload: expect.objectContaining({
          toolName: "read",
          runId: "run-1",
          sessionKey: "agent:main:session-1",
          sessionId: "session-1",
          agentId: "main",
          admission: expect.objectContaining({
            stage: "default",
            blocked: false,
          }),
          inputParams: { path: "/tmp/file" },
        }),
      }),
    );
  });

  it("archives hook-blocked tool admission decisions", async () => {
    const archive = createArchiveServiceFixture();
    mockResolveSharedContextArchiveService.mockResolvedValue(
      archive as unknown as ContextArchiveService,
    );
    const hookRunner: Pick<HookRunner, "hasHooks" | "runBeforeToolCall"> = {
      hasHooks: vi.fn().mockReturnValue(true),
      runBeforeToolCall: vi.fn().mockResolvedValue({
        block: true,
        blockReason: "blocked by policy",
      }),
    };
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as HookRunner);

    await expect(
      runBeforeToolCallHook({
        toolName: "exec",
        params: { command: "rm -rf /" },
        ctx: {
          runId: "run-2",
          sessionKey: "agent:main:session-2",
          sessionId: "session-2",
          agentId: "main",
        },
      }),
    ).resolves.toEqual({
      blocked: true,
      reason: "blocked by policy",
    });

    expect(archive.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool.guard_admission",
        payload: expect.objectContaining({
          admission: expect.objectContaining({
            stage: "hook",
            blocked: true,
            reason: "blocked by policy",
          }),
        }),
      }),
    );
  });

  it("archives loop-policy decisions when a critical loop is blocked", async () => {
    const archive = createArchiveServiceFixture();
    mockResolveSharedContextArchiveService.mockResolvedValue(
      archive as unknown as ContextArchiveService,
    );
    const loopResult: LoopDetectionResult = {
      stuck: true,
      level: "critical",
      detector: "ping_pong",
      count: 20,
      message: "critical ping-pong loop",
      pairedToolName: "list",
    };
    mockBeforeToolCallRuntime.detectToolCallLoop.mockReturnValue(loopResult);

    await expect(
      runBeforeToolCallHook({
        toolName: "read",
        params: { path: "/tmp/file" },
        ctx: {
          runId: "run-3",
          sessionKey: "agent:main:session-3",
          sessionId: "session-3",
          agentId: "main",
        },
      }),
    ).resolves.toEqual({
      blocked: true,
      reason:
        "critical ping-pong loop Plan refresh required: stop alternating between the same tool-call patterns and revise your next step before trying again.",
    });

    expect(archive.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool.loop_policy",
        payload: expect.objectContaining({
          toolName: "read",
          loop: expect.objectContaining({
            detector: "ping_pong",
            level: "critical",
            count: 20,
          }),
          policy: expect.objectContaining({
            action: "require_plan_refresh",
            blocked: true,
          }),
        }),
      }),
    );
  });

  it("archives tool results after successful execution", async () => {
    const archive = createArchiveServiceFixture();
    mockResolveSharedContextArchiveService.mockResolvedValue(
      archive as unknown as ContextArchiveService,
    );
    const tool = {
      name: "read",
      label: "read",
      execute: vi.fn().mockResolvedValue({ ok: true, contents: "hello" }),
    } as unknown as AnyAgentTool;
    const wrapped = wrapToolWithBeforeToolCallHook(tool, {
      runId: "run-4",
      sessionKey: "agent:main:session-4",
      sessionId: "session-4",
      agentId: "main",
    });

    await expect(wrapped.execute?.("tool-4", { path: "/tmp/file" })).resolves.toEqual({
      ok: true,
      contents: "hello",
    });

    expect(archive.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool.result",
        payload: expect.objectContaining({
          toolName: "read",
          toolCallId: "tool-4",
          isError: false,
          result: { ok: true, contents: "hello" },
        }),
      }),
    );
  });
});

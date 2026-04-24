import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInspectionSnapshot } from "../agents/runtime/agent-inspection.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  agentInspectCommand,
  formatAgentInspection,
  resolveAgentInspectionOrExit,
} from "./agent.inspect.js";

const mocks = vi.hoisted(() => ({
  inspectAgentRuntimeMock: vi.fn(),
  writeRuntimeJsonMock: vi.fn(),
  loadConfigMock: vi.fn(),
  resolveMemoryConfigMock: vi.fn(),
  resolveSharedContextArchiveServiceMock: vi.fn(),
  readEventsMock: vi.fn(),
  readSessionSummaryFileMock: vi.fn(),
  sqliteRuntimeStoreInitMock: vi.fn(),
  sqliteRuntimeStoreCloseMock: vi.fn(),
  sqliteRuntimeStoreGetDreamStateMock: vi.fn(),
  sqliteRuntimeStoreListRecentMaintenanceRunsMock: vi.fn(),
  sqliteRuntimeStoreGetSessionSummaryStateMock: vi.fn(),
}));

vi.mock("../agents/runtime/agent-inspection.js", () => ({
  inspectAgentRuntime: mocks.inspectAgentRuntimeMock,
  mergeAgentInspectionArchive: (snapshot: unknown, archive: unknown) =>
    archive ? { ...(snapshot as Record<string, unknown>), archive } : snapshot,
}));

vi.mock("../agents/context-archive/runtime.js", () => ({
  resolveSharedContextArchiveService: mocks.resolveSharedContextArchiveServiceMock,
}));

vi.mock("../memory/session-summary/store.ts", () => ({
  readSessionSummaryFile: mocks.readSessionSummaryFileMock,
}));

vi.mock("../runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../runtime.js")>("../runtime.js");
  return {
    ...actual,
    writeRuntimeJson: mocks.writeRuntimeJsonMock,
    defaultRuntime: {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    },
  };
});

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock("../memory/config/resolve.js", () => ({
  resolveMemoryConfig: mocks.resolveMemoryConfigMock,
}));

vi.mock("../memory/runtime/sqlite-runtime-store.js", () => ({
  SqliteRuntimeStore: class {
    init = mocks.sqliteRuntimeStoreInitMock;
    close = mocks.sqliteRuntimeStoreCloseMock;
    getDreamState = mocks.sqliteRuntimeStoreGetDreamStateMock;
    listRecentMaintenanceRuns = mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock;
    getSessionSummaryState = mocks.sqliteRuntimeStoreGetSessionSummaryStateMock;
  },
}));

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("agent.inspect command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigMock.mockReturnValue({ memory: {} });
    mocks.resolveMemoryConfigMock.mockReturnValue({
      runtimeStore: { dbPath: "/tmp/memory-runtime.db" },
      dreaming: {
        enabled: true,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600_000,
        lockStaleAfterMs: 3_600_000,
        transcriptFallback: {
          enabled: true,
          minSignals: 2,
          staleSummaryMs: 21_600_000,
          maxSessions: 4,
          maxMatchesPerSession: 2,
          maxTotalBytes: 12_000,
          maxExcerptChars: 900,
        },
      },
    });
    mocks.resolveSharedContextArchiveServiceMock.mockResolvedValue(undefined);
    mocks.readEventsMock.mockResolvedValue([]);
    mocks.sqliteRuntimeStoreInitMock.mockResolvedValue(undefined);
    mocks.sqliteRuntimeStoreCloseMock.mockResolvedValue(undefined);
    mocks.sqliteRuntimeStoreGetDreamStateMock.mockResolvedValue(null);
    mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock.mockResolvedValue([]);
    mocks.sqliteRuntimeStoreGetSessionSummaryStateMock.mockResolvedValue(null);
    mocks.readSessionSummaryFileMock.mockResolvedValue({
      sessionId: "sess-inspection",
      agentId: "main",
      summaryPath: "/tmp/session-summary/agents/main/sessions/sess-inspection/summary.md",
      exists: false,
      content: null,
      bytes: 0,
      updatedAt: null,
      document: null,
    });
  });

  it("formats inspection details for text output", async () => {
    const runtime = createRuntime();
    mocks.inspectAgentRuntimeMock.mockReturnValue({
      runId: "run-1",
      taskId: "task-1",
      runtimeState: {
        runId: "run-1",
        taskId: "task-1",
        runtime: "subagent",
        status: "running",
        toolCallCount: 3,
        createdAt: 1,
        updatedAt: 2,
      },
      guard: {
        interactiveApprovalAvailable: false,
        interactiveApprovalBlocker: "background",
        controlUiVisible: false,
        heartbeat: false,
        sandboxed: true,
      },
      completion: {
        version: 1,
        evaluatedAt: 5,
        status: "waiting_external",
        summary: "Waiting for downstream task.",
        spec: {
          version: 1,
          taskType: "poll",
          completionMode: "external_condition",
          summary: "Polling task.",
          deliverables: ["Observed external state"],
          requiredEvidence: ["external_state_changed"],
        },
        satisfiedEvidence: [],
        missingEvidence: ["external_state_changed"],
        warnings: [],
        blockingState: "waiting_external",
      },
      loop: {
        progressCount: 1,
        lastProgressTool: "exec",
        lastProgressStateDelta: "new_result",
        warningBuckets: [{ key: "known_poll_no_progress", count: 2 }],
        commandPolls: [],
      },
      refs: {},
      warnings: [],
      lookup: { runId: "run-1" },
    });

    await agentInspectCommand({ runId: "run-1" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Agent Inspection:"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Guard:"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Completion:"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Loop:"));
  });

  it("writes json output when requested", async () => {
    const runtime = createRuntime();
    const snapshot = {
      runId: "run-json",
      refs: {},
      warnings: [],
      lookup: { runId: "run-json" },
    };
    mocks.inspectAgentRuntimeMock.mockReturnValue(snapshot);

    await agentInspectCommand({ runId: "run-json", json: true }, runtime);

    expect(mocks.writeRuntimeJsonMock).toHaveBeenCalledWith(runtime, snapshot);
  });

  it("looks up inspection snapshots by trace id", async () => {
    const runtime = createRuntime();
    const snapshot = {
      lookup: { traceId: "run-loop:run-json" },
      runId: "run-json",
      refs: {},
      warnings: [],
    };
    mocks.inspectAgentRuntimeMock.mockReturnValue(snapshot);

    await agentInspectCommand({ traceId: "run-loop:run-json", json: true }, runtime);

    expect(mocks.inspectAgentRuntimeMock).toHaveBeenCalledWith({
      traceId: "run-loop:run-json",
    });
    expect(mocks.writeRuntimeJsonMock).toHaveBeenCalledWith(runtime, snapshot);
  });

  it("enriches the inspection from the archive service when available", async () => {
    const runtime = createRuntime();
    const snapshot = {
      runId: "run-archive",
      taskId: "task-archive",
      refs: {},
      warnings: [],
      lookup: { runId: "run-archive" },
    };
    mocks.inspectAgentRuntimeMock.mockReturnValue(snapshot);
    mocks.resolveSharedContextArchiveServiceMock.mockResolvedValue({
      inspect: vi.fn().mockResolvedValue({
        runs: [
          {
            id: "carun-1",
            sessionId: "session-1",
            conversationUid: "session-1",
            kind: "turn",
            archiveMode: "replay",
            status: "complete",
            createdAt: 1,
            updatedAt: 2,
            refs: {
              runRef: "/tmp/archive/runs/carun-1.json",
              eventsRef: "/tmp/archive/events/carun-1.jsonl",
              blobRefs: [],
            },
          },
        ],
      }),
      readEvents: mocks.readEventsMock,
    });
    mocks.readEventsMock.mockResolvedValue([
      {
        id: "event-lifecycle-1",
        runId: "carun-1",
        type: "run.lifecycle.turn_started",
        sequence: 1,
        blobKeys: [],
        createdAt: 2,
        payload: {
          phase: "turn_started",
          traceId: "trace-1",
          spanId: "turn:1",
          decision: {
            code: "turn_started",
            summary: "main turn",
          },
          metrics: {
            messageCount: 2,
          },
        },
        metadata: {
          phase: "turn_started",
          traceId: "trace-1",
          spanId: "turn:1",
          decisionCode: "turn_started",
        },
      },
      {
        id: "event-lifecycle-2",
        runId: "carun-1",
        type: "run.lifecycle.provider_request_start",
        sequence: 2,
        blobKeys: [],
        createdAt: 3,
        payload: {
          phase: "provider_request_start",
          traceId: "trace-1",
          spanId: "provider:req-1",
          parentSpanId: "turn:1",
          decision: {
            code: "provider_model_selected",
            summary: "openai/gpt-5.4",
          },
          refs: {
            provider: "openai",
            modelId: "gpt-5.4",
            requestId: "req-1",
          },
          metrics: {
            promptChars: 120,
          },
        },
        metadata: {
          phase: "provider_request_start",
          traceId: "trace-1",
          spanId: "provider:req-1",
          parentSpanId: "turn:1",
          decisionCode: "provider_model_selected",
        },
      },
      {
        id: "event-1",
        runId: "carun-1",
        type: "agent.action",
        sequence: 3,
        blobKeys: [],
        createdAt: 4,
        payload: {
          version: 1,
          actionId: "workflow:exec_123",
          parentActionId: "tool:tool-wf-1",
          kind: "workflow",
          status: "waiting",
          title: "Workflow waiting: Publish Redbook Note",
          projectedTitle: "Workflow waiting: Publish Redbook Note",
          projectedSummary: "Current step: Review",
          toolName: "workflow",
          toolCallId: "tool-wf-1",
        },
      },
      {
        id: "event-approval-1",
        runId: "carun-1",
        type: "agent.action",
        sequence: 4,
        blobKeys: [],
        createdAt: 5,
        payload: {
          version: 1,
          actionId: "approval:approval-1",
          kind: "approval",
          status: "waiting",
          title: "Waiting for exec approval",
          projectedTitle: "Waiting for exec approval",
          projectedSummary: "pnpm test auth",
        },
      },
      {
        id: "event-completion-1",
        runId: "carun-1",
        type: "agent.action",
        sequence: 5,
        blobKeys: [],
        createdAt: 6,
        payload: {
          version: 1,
          actionId: "completion:run-1",
          kind: "completion",
          status: "waiting",
          title: "Waiting for user confirmation",
          projectedTitle: "Waiting for user confirmation",
          projectedSummary:
            "Task is waiting for explicit user confirmation before it can be completed.",
        },
      },
      {
        id: "event-2",
        runId: "carun-1",
        type: "turn.model_visible_context",
        sequence: 6,
        blobKeys: [],
        createdAt: 7,
        payload: {
          queryContextDiagnostics: {
            queryContextHash: "ctx-hash",
            bootstrapFiles: ["AGENTS.md"],
            skillNames: ["doc"],
            memorySources: ["session_summary"],
          },
          systemContextSections: [{ id: "memory" }, { id: "routing" }],
        },
      },
    ]);

    await agentInspectCommand({ runId: "run-archive" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Archive:"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Run: carun-1"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Query Context:"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Hash: ctx-hash"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Timeline:"));
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining("provider_request_start | openai/gpt-5.4"),
    );
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "action.workflow | Workflow waiting: Publish Redbook Note · Current step: Review | status=waiting",
      ),
    );
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "action.approval | Waiting for exec approval · pnpm test auth | status=waiting",
      ),
    );
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "action.completion | Waiting for user confirmation · Task is waiting for explicit user confirmation before it can be completed. | status=waiting",
      ),
    );
  });

  it("enriches the inspection with dream status when durable scope resolves", async () => {
    const runtime = createRuntime();
    mocks.inspectAgentRuntimeMock.mockReturnValue({
      runId: "run-dream",
      refs: {},
      warnings: [],
      lookup: { runId: "run-dream" },
      runtimeState: {
        runId: "run-dream",
        runtime: "embedded",
        status: "running",
        createdAt: 1,
        updatedAt: 2,
        sessionKey: "agent:main:channel:chat:user:user-1",
        agentId: "main",
      },
    });
    mocks.sqliteRuntimeStoreGetDreamStateMock.mockResolvedValue({
      scopeKey: "main:channel:chat%3Auser%3Auser-1",
      lastSuccessAt: 100,
      lastAttemptAt: 101,
      lastFailureAt: 99,
      lastSkipReason: "min_sessions_gate",
      lockOwner: "dream-1",
    });
    mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock.mockResolvedValue([
      {
        id: "mr-1",
        kind: "dream",
        scope: "main:channel:chat%3Auser%3Auser-1",
        status: "completed",
        triggerSource: "after_turn",
        summary: "Consolidated notes",
        error: null,
        metricsJson: JSON.stringify({
          touchedNotes: ["60 Preferences/answer-style.md"],
        }),
      },
      {
        id: "mr-2",
        kind: "dream",
        scope: "main:channel:chat%3Auser%3Auser-1",
        status: "failed",
        triggerSource: "manual_cli",
        summary: "Dream failed",
        error: "agent_failed",
        metricsJson: null,
      },
    ]);

    await agentInspectCommand({ runId: "run-dream" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Dream:"));
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining("Scope: main:channel:chat%3Auser%3Auser-1"),
    );
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Closed loop: active"));
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining("Transcript fallback: enabled"),
    );
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining("Last skip reason: min_sessions_gate"),
    );
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("reason: agent_failed"));
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining("touched: 60 Preferences/answer-style.md"),
    );
  });

  it("enriches the inspection with session summary state", async () => {
    const runtime = createRuntime();
    mocks.inspectAgentRuntimeMock.mockReturnValue({
      runId: "run-summary",
      refs: {},
      warnings: [],
      lookup: { runId: "run-summary" },
      runtimeState: {
        runId: "run-summary",
        runtime: "embedded",
        status: "running",
        createdAt: 1,
        updatedAt: 2,
        sessionId: "sess-inspection",
        sessionKey: "agent:main:sess-inspection",
        agentId: "main",
      },
    });
    mocks.sqliteRuntimeStoreGetSessionSummaryStateMock.mockResolvedValue({
      sessionId: "sess-inspection",
      lastSummarizedMessageId: "msg-10",
      lastSummaryUpdatedAt: 123,
      tokensAtLastSummary: 456,
      summaryInProgress: false,
      updatedAt: 123,
    });
    mocks.readSessionSummaryFileMock.mockResolvedValue({
      sessionId: "sess-inspection",
      agentId: "main",
      summaryPath: "/tmp/session-summary/agents/main/sessions/sess-inspection/summary.md",
      exists: true,
      content: "# Session Summary",
      bytes: 20,
      updatedAt: 123,
      document: null,
    });

    await agentInspectCommand({ runId: "run-summary" }, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Session Summary:"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("msg-10"));
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "/tmp/session-summary/agents/main/sessions/sess-inspection/summary.md",
      ),
    );
  });

  it("exits when lookup is missing", () => {
    const runtime = createRuntime();

    const result = resolveAgentInspectionOrExit({}, runtime);

    expect(result).toBeUndefined();
    expect(runtime.error).toHaveBeenCalledWith("Pass --run-id, --task-id, or --trace-id.");
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });

  it("exits when inspection target cannot be found", () => {
    const runtime = createRuntime();
    mocks.inspectAgentRuntimeMock.mockReturnValue(undefined);

    const result = resolveAgentInspectionOrExit({ taskId: "task-missing" }, runtime);

    expect(result).toBeUndefined();
    expect(runtime.error).toHaveBeenCalledWith(
      "Agent inspection target not found for task task-missing.",
    );
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });

  it("formats refs and warnings when present", () => {
    const rendered = formatAgentInspection({
      lookup: { taskId: "task-1" },
      runId: "run-1",
      taskId: "task-1",
      refs: {
        runtimeStateRef: "state.json",
        transcriptRef: "session.jsonl",
      },
      warnings: ["Runtime state not found"],
    });
    expect(rendered).toContain("Refs:");
    expect(rendered).toContain("Warnings:");
  });

  it("renders archive inspection refs when present", () => {
    const rendered = formatAgentInspection({
      lookup: { runId: "run-1" },
      runId: "run-1",
      refs: {},
      warnings: [],
      archive: {
        runs: [
          {
            id: "carun-1",
            sessionId: "session-1",
            conversationUid: "session-1",
            kind: "turn",
            archiveMode: "replay",
            status: "complete",
            createdAt: 1,
            updatedAt: 2,
            metadata: { source: "context-memory-runtime" },
            refs: {
              runRef: "/tmp/archive/runs/carun-1.json",
              eventsRef: "/tmp/archive/events/carun-1.jsonl",
              blobRefs: ["/tmp/archive/blobs/blob-1.blob"],
            },
          },
        ],
      },
    } as AgentInspectionSnapshot);

    expect(rendered).toContain("Archive:");
    expect(rendered).toContain("Run: carun-1");
    expect(rendered).toContain("Run ref: /tmp/archive/runs/carun-1.json");
    expect(rendered).toContain("Events ref: /tmp/archive/events/carun-1.jsonl");
  });

  it("renders dream inspection state and recent runs when present", () => {
    const rendered = formatAgentInspection({
      lookup: { runId: "run-1" },
      runId: "run-1",
      refs: {},
      warnings: [],
      dream: {
        scopeKey: "main:channel:chat%3Auser%3Auser-1",
        enabled: true,
        transcriptFallback: {
          enabled: true,
          maxSessions: 4,
          maxMatchesPerSession: 2,
          maxTotalBytes: 12_000,
          maxExcerptChars: 900,
        },
        closedLoopActive: true,
        closedLoopReason: "active",
        state: {
          lastSuccessAt: 100,
          lastAttemptAt: 101,
          lastFailureAt: 99,
          lastSkipReason: "min_sessions_gate",
          lockOwner: "dream-1",
        },
        recentRuns: [
          {
            id: "mr-1",
            status: "completed",
            summary: "Consolidated notes",
            triggerSource: "after_turn",
            touchedNotes: ["60 Preferences/answer-style.md"],
          },
          {
            id: "mr-2",
            status: "failed",
            summary: "Dream failed",
            triggerSource: "manual_cli",
            reason: "agent_failed",
          },
        ],
      },
    });

    expect(rendered).toContain("Dream:");
    expect(rendered).toContain("Scope: main:channel:chat%3Auser%3Auser-1");
    expect(rendered).toContain("Enabled: yes");
    expect(rendered).toContain("Closed loop: active");
    expect(rendered).toContain("Transcript fallback: enabled");
    expect(rendered).toContain("Last skip reason: min_sessions_gate");
    expect(rendered).toContain("Lock owner: dream-1");
    expect(rendered).toContain("reason: agent_failed");
    expect(rendered).toContain("touched: 60 Preferences/answer-style.md");
  });

  it("renders session summary state when present", () => {
    const rendered = formatAgentInspection({
      lookup: { runId: "run-1" },
      runId: "run-1",
      refs: {},
      warnings: [],
      sessionSummary: {
        sessionId: "sess-1",
        agentId: "main",
        path: "/tmp/session-summary/agents/main/sessions/sess-1/summary.md",
        exists: true,
        updatedAt: 123,
        state: {
          lastSummarizedMessageId: "msg-9",
          lastSummaryUpdatedAt: 123,
          tokensAtLastSummary: 456,
          summaryInProgress: false,
        },
      },
    });

    expect(rendered).toContain("Session Summary:");
    expect(rendered).toContain("msg-9");
    expect(rendered).toContain("/tmp/session-summary/agents/main/sessions/sess-1/summary.md");
  });

  it("renders durable recall provenance details when present", () => {
    const rendered = formatAgentInspection({
      lookup: { runId: "run-1" },
      runId: "run-1",
      refs: {},
      warnings: [],
      queryContext: {
        archiveRunId: "carun-1",
        eventId: "evt-1",
        memoryRecall: {
          durableRecallSource: "sync",
          hitReason: "durable_selected:sync",
          selectedItemIds: ["durable:project-probe-note.md"],
          omittedItemIds: ["durable:project-gateway-note.md"],
          selectedDurableDetails: [
            {
              itemId: "durable:project-probe-note.md",
              notePath: "project-probe-note.md",
              title: "Probe note",
              provenance: ["header", "body_rerank"],
            },
          ],
          omittedDurableDetails: [
            {
              itemId: "durable:project-gateway-note.md",
              notePath: "project-gateway-note.md",
              title: "Gateway note",
              provenance: ["header"],
              omittedReason: "ranked_below_limit",
            },
          ],
          recentDreamTouchedNotes: ["project-probe-note.md"],
        },
      },
    } as never);

    expect(rendered).toContain("Durable recall source: sync");
    expect(rendered).toContain("Durable selected details:");
    expect(rendered).toContain("- durable:project-probe-note.md [header, body_rerank]");
    expect(rendered).toContain("Durable omitted details:");
    expect(rendered).toContain(
      "- durable:project-gateway-note.md [header] reason=ranked_below_limit",
    );
    expect(rendered).toContain("Dream touched durable notes:");
    expect(rendered).toContain("project-probe-note.md");
  });

  it("renders timeline entries when present", () => {
    const rendered = formatAgentInspection({
      lookup: { runId: "run-1" },
      runId: "run-1",
      refs: {},
      warnings: [],
      timeline: [
        {
          eventId: "event-1",
          type: "run.lifecycle.provider_request_start",
          phase: "provider_request_start",
          createdAt: 100,
          traceId: "trace-1",
          spanId: "provider:req-1",
          parentSpanId: "turn:1",
          status: "ok",
          decisionCode: "provider_model_selected",
          decisionSummary: "openai/gpt-5.4",
          summary: "openai/gpt-5.4",
          metrics: { promptChars: 120 },
          refs: { provider: "openai", modelId: "gpt-5.4" },
        },
      ],
    });

    expect(rendered).toContain("Timeline:");
    expect(rendered).toContain(
      "100 provider_request_start | openai/gpt-5.4 | decision=provider_model_selected | status=ok",
    );
    expect(rendered).toContain('metrics={"promptChars":120}');
    expect(rendered).toContain('refs={"provider":"openai","modelId":"gpt-5.4"}');
  });
});

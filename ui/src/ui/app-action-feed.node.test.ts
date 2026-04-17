import { beforeAll, describe, expect, it } from "vitest";
import {
  handleAgentActionEvent,
  resetActionFeed,
  type ActionFeedEntry,
} from "./app-action-feed.ts";

type ActionFeedHost = {
  sessionKey: string;
  chatRunId: string | null;
  chatActionFeed?: ActionFeedEntry[];
  actionFeedById?: Map<string, ActionFeedEntry>;
  actionFeedOrder?: string[];
  actionFeedSyncTimer?: number | null;
};

function createHost(overrides?: Partial<ActionFeedHost>): ActionFeedHost {
  return {
    sessionKey: "main",
    chatRunId: null,
    ...overrides,
  };
}

describe("app-action-feed", () => {
  beforeAll(() => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
    }
  });

  it("tracks tool start and completion as a single action", () => {
    const host = createHost();

    handleAgentActionEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "tool-1",
        kind: "tool",
        status: "running",
        title: "Running read_file",
        summary: "/tmp/demo.ts",
        toolName: "read_file",
        toolCallId: "tool-1",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "tool-1",
      kind: "tool",
      status: "running",
      title: "Running read_file",
      summary: "/tmp/demo.ts",
    });

    handleAgentActionEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "action",
      ts: 200,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "tool-1",
        kind: "tool",
        status: "completed",
        title: "read_file completed",
        toolName: "read_file",
        toolCallId: "tool-1",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "tool-1",
      kind: "tool",
      status: "completed",
      title: "read_file completed",
    });
  });

  it("ignores agent events for other sessions", () => {
    const host = createHost();

    handleAgentActionEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "agent:other:main",
      data: {
        version: 1,
        actionId: "tool-1",
        kind: "tool",
        status: "running",
        title: "Running exec",
        toolName: "exec",
        toolCallId: "tool-1",
      },
    });

    expect(host.chatActionFeed ?? []).toHaveLength(0);
  });

  it("records approval action transitions from backend events", () => {
    const host = createHost();

    handleAgentActionEvent(host, {
      runId: "approval:approval-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "approval:approval-1",
        kind: "approval",
        status: "waiting",
        title: "Waiting for exec approval",
        summary: "pnpm test auth",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "approval:approval-1",
      kind: "approval",
      status: "waiting",
      title: "Waiting for exec approval",
      projectedTitle: "Waiting for exec approval",
      projectedSummary: "pnpm test auth",
    });

    handleAgentActionEvent(host, {
      runId: "approval:approval-1",
      seq: 2,
      stream: "action",
      ts: 200,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "approval:approval-1",
        kind: "approval",
        status: "completed",
        title: "Approval granted",
        summary: "allow-once",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "approval:approval-1",
      status: "completed",
      title: "Approval granted",
      summary: "allow-once",
      projectedTitle: "Approval granted",
      projectedSummary: "allow-once",
    });
  });

  it("accepts raw approval actions for the active session even when runId differs", () => {
    const host = createHost({
      chatRunId: "run-1",
    });

    handleAgentActionEvent(host, {
      runId: "approval:approval-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "approval:approval-1",
        kind: "approval",
        status: "waiting",
        title: "Waiting for exec approval",
        summary: "pnpm test auth",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "approval:approval-1",
      kind: "approval",
      status: "waiting",
      title: "Waiting for exec approval",
      projectedTitle: "Waiting for exec approval",
      projectedSummary: "pnpm test auth",
    });
  });

  it("accepts raw verification actions for the active session even when runId differs", () => {
    const host = createHost({
      chatRunId: "run-1",
    });

    handleAgentActionEvent(host, {
      runId: "verification:tool-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "verification:tool-1",
        kind: "verification",
        status: "running",
        title: "Verification running",
        summary: "重跑登录两次并确认重试流程",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "verification:tool-1",
      kind: "verification",
      status: "running",
      title: "Verification running",
      summary: "重跑登录两次并确认重试流程",
    });
  });

  it("projects completion actions with shared completion visibility", () => {
    const host = createHost({
      chatRunId: "run-1",
    });

    handleAgentActionEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "completion:run-1",
        kind: "completion",
        status: "waiting",
        title: "Completion decision",
        summary: "Task is waiting for the external condition to be observed before completion.",
        detail: {
          completionStatus: "waiting_external",
        },
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "completion:run-1",
      kind: "completion",
      status: "waiting",
      projectedTitle: "Waiting for external condition",
      projectedSummary:
        "Task is waiting for the external condition to be observed before completion.",
    });
  });

  it("accepts session-scoped workflow actions even when they use a synthetic run id", () => {
    const host = createHost({
      chatRunId: "run-1",
    });

    handleAgentActionEvent(host, {
      runId: "workflow:exec_123",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "workflow:exec_123",
        kind: "workflow",
        status: "running",
        title: "Running workflow: Publish Redbook Note",
        projectedTitle: "Running workflow: Publish Redbook Note",
        projectedSummary: "Current step: Draft content",
        toolName: "workflow",
        toolCallId: "tool-wf-1",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "workflow:exec_123",
      kind: "workflow",
      status: "running",
      projectedTitle: "Running workflow: Publish Redbook Note",
      projectedSummary: "Current step: Draft content",
    });
  });

  it("accepts raw memory actions for the active session even when runId differs", () => {
    const host = createHost({
      chatRunId: "run-1",
    });

    handleAgentActionEvent(host, {
      runId: "memory-extraction:session-1:2",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "memory-extraction:session-1:2",
        kind: "memory",
        status: "running",
        title: "Memory extraction running",
        summary: "main:feishu:user-1",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "memory-extraction:session-1:2",
      kind: "memory",
      status: "running",
      title: "Memory extraction running",
      summary: "main:feishu:user-1",
    });
  });

  it("projects memory actions with shared memory visibility", () => {
    const host = createHost({
      chatRunId: "run-1",
    });

    handleAgentActionEvent(host, {
      runId: "memory-extraction:session-1:2",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "memory-extraction:session-1:2",
        kind: "memory",
        status: "completed",
        title: "raw memory title",
        summary: "saved one durable note",
        detail: {
          memoryKind: "extraction",
          memoryPhase: "final",
          memoryResultStatus: "written",
        },
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      actionId: "memory-extraction:session-1:2",
      kind: "memory",
      status: "completed",
      projectedTitle: "Memory extraction wrote durable notes",
      projectedSummary: "saved one durable note",
    });
  });

  it("captures compaction and fallback state changes from backend action events", () => {
    const host = createHost();

    handleAgentActionEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "compaction:run-1",
        kind: "compaction",
        status: "running",
        title: "Compacting context",
      },
    });
    handleAgentActionEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "action",
      ts: 150,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "fallback:run-1",
        kind: "fallback",
        status: "completed",
        title: "Model fallback active",
        summary: "deepinfra/moonshotai/Kimi-K2.5 • rate limit",
      },
    });

    expect(host.chatActionFeed?.map((entry) => entry.kind)).toContain("compaction");
    expect(host.chatActionFeed?.map((entry) => entry.kind)).toContain("fallback");
  });

  it("projects tool actions through execution visibility summaries", () => {
    const host = createHost();

    handleAgentActionEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "tool-1",
        kind: "tool",
        status: "running",
        title: "Running read",
        summary: "from /tmp/demo.ts",
        toolName: "read",
        toolCallId: "tool-1",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      kind: "tool",
      projectedTitle: "Reading from /tmp/demo.ts",
    });
  });

  it("projects workflow tools as workflow action kind", () => {
    const host = createHost();

    handleAgentActionEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "action",
      ts: 100,
      sessionKey: "main",
      data: {
        version: 1,
        actionId: "tool-1",
        kind: "tool",
        status: "running",
        title: "Running workflow",
        summary: "Publish Redbook",
        toolName: "workflow",
        toolCallId: "tool-1",
      },
    });

    expect(host.chatActionFeed?.[0]).toMatchObject({
      kind: "workflow",
      projectedTitle: "Running workflow: Publish Redbook",
    });
  });

  it("clears action feed state", () => {
    const host = createHost({
      chatActionFeed: [
        {
          actionId: "x",
          runId: "run-1",
          kind: "system",
          status: "completed",
          title: "done",
          updatedAt: 1,
          version: 1,
        },
      ],
      actionFeedById: new Map(),
      actionFeedOrder: ["x"],
      actionFeedSyncTimer: null,
    });

    resetActionFeed(host);

    expect(host.chatActionFeed).toEqual([]);
    expect(host.actionFeedById?.size).toBe(0);
    expect(host.actionFeedOrder).toEqual([]);
  });
});

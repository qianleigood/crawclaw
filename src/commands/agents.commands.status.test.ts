import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsStatusCommand, formatAgentsStatusSummary } from "./agents.commands.status.js";

const emptyTaskSummary = {
  total: 0,
  active: 0,
  terminal: 0,
  failures: 0,
  byStatus: {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    timed_out: 0,
    cancelled: 0,
    lost: 0,
  },
  byRuntime: {
    subagent: 0,
    acp: 0,
    cli: 0,
    cron: 0,
  },
};

const emptyRuntimeSummary = {
  total: 0,
  active: 0,
  stale: 0,
  byStatus: {
    created: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  },
};

const mocks = vi.hoisted(() => ({
  requireValidConfigMock: vi.fn(),
  buildAgentOpsSummaryMock: vi.fn(),
  writeRuntimeJsonMock: vi.fn(),
}));

vi.mock("./agents.command-shared.js", () => ({
  requireValidConfig: mocks.requireValidConfigMock,
}));

vi.mock("../agents/runtime/agent-ops-summary.js", () => ({
  buildAgentOpsSummary: mocks.buildAgentOpsSummaryMock,
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

describe("agents.commands.status", () => {
  const runtime = {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early when config is unavailable", async () => {
    mocks.requireValidConfigMock.mockResolvedValue(null);

    const result = await agentsStatusCommand({}, runtime);

    expect(result).toBeUndefined();
    expect(mocks.buildAgentOpsSummaryMock).not.toHaveBeenCalled();
  });

  it("writes json when requested", async () => {
    const payload = {
      generatedAt: 1,
      defaultId: "main",
      taskSummary: emptyTaskSummary,
      runtimeSummary: emptyRuntimeSummary,
      agents: [],
    };
    mocks.requireValidConfigMock.mockResolvedValue({});
    mocks.buildAgentOpsSummaryMock.mockResolvedValue(payload);

    await agentsStatusCommand({ json: true }, runtime);

    expect(mocks.writeRuntimeJsonMock).toHaveBeenCalledWith(runtime, payload);
  });

  it("formats text summary", async () => {
    const payload = {
      generatedAt: Date.UTC(2026, 3, 7, 0, 0, 0),
      defaultId: "main",
      taskSummary: {
        ...emptyTaskSummary,
        total: 2,
        active: 1,
        terminal: 1,
        byStatus: {
          ...emptyTaskSummary.byStatus,
          running: 1,
          succeeded: 1,
        },
        byRuntime: {
          ...emptyTaskSummary.byRuntime,
          subagent: 1,
          acp: 1,
        },
      },
      runtimeSummary: {
        total: 2,
        active: 1,
        stale: 0,
        byStatus: {
          ...emptyRuntimeSummary.byStatus,
          running: 1,
          completed: 1,
        },
      },
      agents: [
        {
          id: "main",
          isDefault: true,
          workspaceDir: "/tmp/main",
          bootstrapPending: false,
          sessionsPath: "/tmp/sessions.json",
          sessionsCount: 2,
          lastUpdatedAt: 1,
          lastActiveAgeMs: 2000,
          taskSummary: {
            ...emptyTaskSummary,
            total: 2,
            active: 1,
            terminal: 1,
          },
          runtimeSummary: {
            ...emptyRuntimeSummary,
            total: 2,
            active: 1,
          },
          guardBlockers: [{ key: "background", count: 1 }],
          completionBlockers: [{ key: "waiting_external", count: 1 }],
          loopWarnings: [{ key: "known_poll_no_progress", count: 2 }],
        },
      ],
    };
    mocks.requireValidConfigMock.mockResolvedValue({});
    mocks.buildAgentOpsSummaryMock.mockResolvedValue(payload);

    await agentsStatusCommand({}, runtime);

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Agent Ops Summary:"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Guard blockers:"));
  });

  it("formats agent rows with blockers", () => {
    const rendered = formatAgentsStatusSummary({
      generatedAt: 1,
      defaultId: "main",
      taskSummary: emptyTaskSummary,
      runtimeSummary: emptyRuntimeSummary,
      agents: [
        {
          id: "main",
          isDefault: true,
          workspaceDir: "/tmp/main",
          bootstrapPending: false,
          sessionsPath: "/tmp/sessions.json",
          sessionsCount: 0,
          lastUpdatedAt: null,
          lastActiveAgeMs: null,
          taskSummary: emptyTaskSummary,
          runtimeSummary: emptyRuntimeSummary,
          guardBlockers: [{ key: "background", count: 1 }],
          completionBlockers: [],
          loopWarnings: [],
        },
      ],
    });
    expect(rendered).toContain("main (default)");
    expect(rendered).toContain("background: 1");
  });
});

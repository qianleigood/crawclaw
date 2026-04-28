import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentRunContext, resetAgentRunContextForTest } from "../infra/agent-events.js";
import {
  registerAgentRuntimeRun,
  resetAgentProgressEventsForTest,
} from "./runtime/agent-progress.js";

const mocks = vi.hoisted(() => ({
  sendExecApprovalFollowup: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("./bash-tools.exec-approval-followup.js", () => ({
  sendExecApprovalFollowup: mocks.sendExecApprovalFollowup,
}));

vi.mock("../logger.js", () => ({
  logWarn: mocks.logWarn,
}));

let sendExecApprovalFollowupResult: typeof import("./bash-tools.exec-host-shared.js").sendExecApprovalFollowupResult;
let maxExecApprovalFollowupFailureLogKeys: typeof import("./bash-tools.exec-host-shared.js").MAX_EXEC_APPROVAL_FOLLOWUP_FAILURE_LOG_KEYS;
let resolveExecApprovalGuardUnavailable: typeof import("./bash-tools.exec-host-shared.js").resolveExecApprovalGuardUnavailable;
let sendExecApprovalFollowup: typeof import("./bash-tools.exec-approval-followup.js").sendExecApprovalFollowup;
let logWarn: typeof import("../logger.js").logWarn;

describe("bash-tools.exec-host-shared", () => {
  beforeAll(async () => {
    ({
      sendExecApprovalFollowupResult,
      MAX_EXEC_APPROVAL_FOLLOWUP_FAILURE_LOG_KEYS: maxExecApprovalFollowupFailureLogKeys,
      resolveExecApprovalGuardUnavailable,
    } = await import("./bash-tools.exec-host-shared.js"));
    ({ sendExecApprovalFollowup } = await import("./bash-tools.exec-approval-followup.js"));
    ({ logWarn } = await import("../logger.js"));
  });

  beforeEach(() => {
    vi.mocked(sendExecApprovalFollowup).mockReset();
    vi.mocked(logWarn).mockReset();
    resetAgentRunContextForTest();
    resetAgentProgressEventsForTest();
  });

  it("logs repeated followup dispatch failures once per approval id and error message", async () => {
    vi.mocked(sendExecApprovalFollowup).mockRejectedValue(new Error("Channel is required"));

    const target = {
      approvalId: "approval-log-once",
      sessionKey: "agent:main:main",
    };
    await sendExecApprovalFollowupResult(target, "Exec finished");
    await sendExecApprovalFollowupResult(target, "Exec finished");

    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith(
      "exec approval followup dispatch failed (id=approval-log-once): Channel is required",
    );
  });

  it("evicts oldest followup failure dedupe keys after reaching the cap", async () => {
    vi.mocked(sendExecApprovalFollowup).mockRejectedValue(new Error("Channel is required"));

    for (let i = 0; i <= maxExecApprovalFollowupFailureLogKeys; i += 1) {
      await sendExecApprovalFollowupResult(
        {
          approvalId: `approval-${i}`,
          sessionKey: "agent:main:main",
        },
        "Exec finished",
      );
    }
    await sendExecApprovalFollowupResult(
      {
        approvalId: "approval-0",
        sessionKey: "agent:main:main",
      },
      "Exec finished",
    );

    expect(logWarn).toHaveBeenCalledTimes(maxExecApprovalFollowupFailureLogKeys + 2);
    expect(logWarn).toHaveBeenLastCalledWith(
      "exec approval followup dispatch failed (id=approval-0): Channel is required",
    );
  });

  it("maps background runtime guard state into exec approval unavailability", () => {
    registerAgentRuntimeRun({
      runId: "background-run",
      sessionKey: "agent:bg",
      sessionId: "session-bg",
      agentId: "worker",
      runtime: "subagent",
      mode: "background",
      status: "running",
      updatedAt: Date.now(),
    });

    expect(resolveExecApprovalGuardUnavailable({ runId: "background-run" })).toEqual({
      warningText:
        "Exec approval is required, but interactive approvals are unavailable for background agent runs.",
      unavailableReason: "background",
    });
  });

  it("maps hidden browser client runs into exec approval unavailability", () => {
    registerAgentRunContext("hidden-ui-run", {
      sessionKey: "agent:hidden",
      sessionId: "session-hidden",
      agentId: "main",
      taskRuntime: "cli",
      taskMode: "foreground",
      isBrowserClientsVisible: false,
    });
    registerAgentRuntimeRun({
      runId: "hidden-ui-run",
      sessionKey: "agent:hidden",
      sessionId: "session-hidden",
      agentId: "main",
      runtime: "cli",
      mode: "foreground",
      status: "running",
      updatedAt: Date.now(),
    });

    expect(resolveExecApprovalGuardUnavailable({ runId: "hidden-ui-run" })).toEqual({
      warningText:
        "Exec approval is required, but interactive approvals are unavailable when operator client updates are hidden for this run.",
      unavailableReason: "hidden-browser-client",
    });
  });
});

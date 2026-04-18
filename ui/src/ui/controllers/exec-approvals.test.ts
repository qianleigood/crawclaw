import { describe, expect, it, vi } from "vitest";
import { loadExecApprovals, saveExecApprovals, type ExecApprovalsState } from "./exec-approvals.ts";

function createState(): {
  state: ExecApprovalsState;
  request: ReturnType<typeof vi.fn>;
  hasMethod: ReturnType<typeof vi.fn>;
  hasCapability: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn();
  const hasMethod = vi.fn(() => true);
  const hasCapability = vi.fn(() => true);
  const state: ExecApprovalsState = {
    client: {
      request,
      hasMethod,
      hasCapability,
    } as unknown as ExecApprovalsState["client"],
    connected: true,
    execApprovalsLoading: false,
    execApprovalsSaving: false,
    execApprovalsDirty: false,
    execApprovalsSnapshot: null,
    execApprovalsForm: null,
    execApprovalsSelectedAgent: null,
    lastError: null,
  };
  return { state, request, hasMethod, hasCapability };
}

describe("exec approvals controller", () => {
  it("loads gateway exec approvals through the shared contract path", async () => {
    const { state, request, hasMethod } = createState();
    request.mockResolvedValue({
      path: "/tmp/exec-approvals.json",
      exists: true,
      hash: "hash-1",
      file: { version: 1 },
    });

    await loadExecApprovals(state, { kind: "gateway" });

    expect(hasMethod).toHaveBeenCalledWith("exec.approvals.get");
    expect(request).toHaveBeenCalledWith("exec.approvals.get", {});
    expect(state.execApprovalsSnapshot?.hash).toBe("hash-1");
    expect(state.lastError).toBeNull();
  });

  it("skips node exec approvals loading when the gateway lacks node capability", async () => {
    const { state, request, hasCapability } = createState();
    hasCapability.mockReturnValue(false);

    await loadExecApprovals(state, { kind: "node", nodeId: "node-1" });

    expect(hasCapability).toHaveBeenCalledWith("exec.approvals.node");
    expect(request).not.toHaveBeenCalled();
    expect(state.lastError).toBe("Node exec approvals are not supported by this gateway.");
  });

  it("skips node exec approvals saving when the gateway lacks node capability", async () => {
    const { state, request, hasCapability } = createState();
    hasCapability.mockReturnValue(false);
    state.execApprovalsSnapshot = {
      path: "/tmp/exec-approvals.json",
      exists: true,
      hash: "hash-2",
      file: { version: 1 },
    };
    state.execApprovalsForm = {
      version: 1,
      defaults: { security: "strict" },
    };

    await saveExecApprovals(state, { kind: "node", nodeId: "node-1" });

    expect(hasCapability).toHaveBeenCalledWith("exec.approvals.node");
    expect(request).not.toHaveBeenCalled();
    expect(state.lastError).toBe("Node exec approvals are not supported by this gateway.");
  });
});

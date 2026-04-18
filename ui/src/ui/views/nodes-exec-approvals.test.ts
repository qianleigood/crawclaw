/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderExecApprovals } from "./nodes-exec-approvals.ts";

type ExecApprovalsViewState = Parameters<typeof renderExecApprovals>[0];

function createState(overrides: Partial<ExecApprovalsViewState> = {}): ExecApprovalsViewState {
  return {
    ready: true,
    disabled: false,
    dirty: true,
    loading: false,
    saving: false,
    form: {
      defaults: {
        security: "allowlist",
        ask: "on-miss",
        askFallback: "deny",
        autoAllowSkills: true,
      },
      agents: {},
    },
    defaults: {
      security: "allowlist",
      ask: "on-miss",
      askFallback: "deny",
      autoAllowSkills: true,
    },
    selectedScope: "__defaults__",
    selectedAgent: null,
    agents: [{ id: "main", name: "Main", isDefault: true }],
    allowlist: [],
    target: "gateway",
    targetNodeId: null,
    targetNodes: [],
    onSelectScope: () => {},
    onSelectTarget: () => {},
    onPatch: () => {},
    onRemove: () => {},
    onLoad: () => {},
    onSave: () => {},
    ...overrides,
  };
}

describe("renderExecApprovals", () => {
  it("renders the stitch control-console shell for approvals", async () => {
    const container = document.createElement("div");
    render(renderExecApprovals(createState()), container);
    await Promise.resolve();

    expect(container.textContent).toContain("Control plane approvals");
    expect(container.textContent).toContain("Exec approval policy");
    expect(container.textContent).toContain("Target surface");
    expect(container.textContent).toContain("Gateway");
    expect(container.textContent).toContain("Runtime state");
    expect(container.textContent).toContain("Apply required");
  });
});

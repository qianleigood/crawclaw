import { describe, expect, it } from "vitest";
import { createWorkflowDefinitionDiff } from "./diff.js";
import { applyWorkflowDefinitionPatch } from "./spec-patch.js";
import type { WorkflowRegistryEntry, WorkflowSpec } from "./types.js";

function buildBaseSpec(): WorkflowSpec {
  return {
    workflowId: "wf_publish",
    name: "Publish Redbook Note",
    goal: "Generate and publish a redbook post",
    topology: "linear_v1",
    description: "Initial description",
    tags: ["redbook"],
    inputs: [{ name: "topic", type: "string", required: true }],
    outputs: [{ name: "postUrl", type: "string", required: false }],
    steps: [
      {
        id: "step_1",
        kind: "crawclaw_agent",
        title: "Draft content",
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildBaseEntry(): WorkflowRegistryEntry {
  return {
    workflowId: "wf_publish",
    name: "Publish Redbook Note",
    description: "Initial description",
    scope: "workspace",
    target: "n8n",
    enabled: true,
    safeForAutoRun: false,
    requiresApproval: true,
    tags: ["redbook"],
    specVersion: 1,
    deploymentVersion: 1,
    deploymentState: "deployed",
    n8nWorkflowId: "wf_remote",
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("workflow spec patching and diff", () => {
  it("applies top-level workflow definition patches and marks deployed specs dirty", () => {
    const patched = applyWorkflowDefinitionPatch({
      spec: buildBaseSpec(),
      entry: buildBaseEntry(),
      patch: {
        goal: "Generate, review, and publish a redbook post",
        description: "Updated description",
        safeForAutoRun: true,
        requiresApproval: false,
        steps: [
          {
            id: "step_1",
            kind: "crawclaw_agent",
            title: "Draft content",
          },
          {
            id: "step_2",
            kind: "human_wait",
            title: "Review draft",
            path: "approval",
            branchGroup: "review",
            activation: {
              mode: "conditional",
              when: "{{ $json.requiresApproval === true }}",
              fromStepIds: ["step_1"],
            },
          },
        ],
      },
      specVersion: 2,
      updatedAt: 2,
    });

    expect(patched.spec.topology).toBe("branch_v2");
    expect(patched.entry.specVersion).toBe(2);
    expect(patched.entry.deploymentState).toBe("draft");
    expect(patched.entry.safeForAutoRun).toBe(true);
    expect(patched.entry.requiresApproval).toBe(false);
  });

  it("produces structured diffs for policy, step, and topology changes", () => {
    const beforeSpec = buildBaseSpec();
    const beforeEntry = buildBaseEntry();
    const after = applyWorkflowDefinitionPatch({
      spec: beforeSpec,
      entry: beforeEntry,
      patch: {
        description: "Updated description",
        safeForAutoRun: true,
        steps: [
          {
            id: "step_1",
            kind: "crawclaw_agent",
            title: "Draft content",
          },
          {
            id: "step_2",
            kind: "service",
            title: "Publish via API",
            serviceRequest: {
              url: "https://api.example.com/publish",
              method: "POST",
            },
          },
        ],
      },
      specVersion: 2,
      updatedAt: 2,
    });

    const diff = createWorkflowDefinitionDiff(
      {
        spec: beforeSpec,
        policy: beforeEntry,
      },
      {
        spec: after.spec,
        policy: after.entry,
      },
    );

    expect(diff.summary.basicChanged).toBe(true);
    expect(diff.summary.policyChanged).toBe(true);
    expect(diff.summary.stepsAdded).toBe(1);
    expect(diff.changes.policy.some((change) => change.field === "policy.safeForAutoRun")).toBe(
      true,
    );
    expect(diff.changes.steps.find((change) => change.stepId === "step_2")?.change).toBe("added");
  });
});

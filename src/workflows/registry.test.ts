import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import {
  createWorkflowDraft,
  deleteWorkflow,
  describeWorkflow,
  getWorkflowInvocationHint,
  listWorkflows,
  markWorkflowDeployed,
  matchWorkflows,
  setWorkflowArchived,
  setWorkflowEnabled,
} from "./registry.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("workflow registry", () => {
  it("creates a draft workflow and persists registry/spec files", async () => {
    const workspaceDir = await tempDirs.make("workflow-registry-");
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      steps: ["Draft content", "Wait for approval", "Publish"],
      tags: ["redbook", "content"],
      inputs: ["topic"],
      outputs: ["postUrl"],
      sessionKey: "agent:main:main",
      sessionId: "session-1",
    });

    expect(created.entry.workflowId).toMatch(/^wf_/);
    expect(created.entry.deploymentState).toBe("draft");
    expect(created.spec.steps).toHaveLength(3);
    expect(created.spec.sourceWorkspaceDir).toBe(workspaceDir);
    await expect(fs.readFile(created.specPath, "utf8")).resolves.toContain("Publish Redbook Note");
  });

  it("lists, describes, matches, and toggles workflow entries", async () => {
    const workspaceDir = await tempDirs.make("workflow-registry-list-");
    await createWorkflowDraft({
      workspaceDir,
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      description: "Content publishing workflow",
      tags: ["redbook", "publish"],
    });

    const listed = await listWorkflows({ workspaceDir });
    expect(listed).toHaveLength(1);

    const described = await describeWorkflow({ workspaceDir }, "Publish Redbook Note");
    expect(described?.entry.name).toBe("Publish Redbook Note");
    expect(described?.spec?.goal).toBe("Generate and publish a redbook post");

    const matches = await matchWorkflows({ workspaceDir }, "redbook");
    expect(matches[0]?.name).toBe("Publish Redbook Note");
    expect(matches[0]?.matchScore).toBeGreaterThan(0);

    const disabled = await setWorkflowEnabled({ workspaceDir }, "Publish Redbook Note", false);
    expect(disabled?.enabled).toBe(false);
  });

  it("infers workflow step portability from workspace skill metadata", async () => {
    const workspaceDir = await tempDirs.make("workflow-registry-portability-");
    await fs.mkdir(`${workspaceDir}/skills-optional/grok-video-web`, { recursive: true });
    await fs.writeFile(
      `${workspaceDir}/skills-optional/grok-video-web/SKILL.md`,
      `---
name: grok-video-web
description: Automate Grok browser work.
metadata: { "crawclaw": { "workflow": { "portability": "crawclaw_agent", "allowedTools": ["browser"], "notes": "Needs persistent browser login." } } }
---

# Grok Video Web
`,
      "utf8",
    );

    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Generate Grok Video",
      goal: "Generate a Grok video from a prompt",
      stepSpecs: [
        {
          title: "Generate via Grok UI",
          skill: "grok-video-web",
        },
      ],
      tags: ["video"],
    });

    expect(created.spec.steps[0]).toMatchObject({
      kind: "crawclaw_agent",
      sourceSkill: "grok-video-web",
      portability: "crawclaw_agent",
      agent: {
        allowedSkills: ["grok-video-web"],
        allowedTools: ["browser"],
      },
      notes: "Needs persistent browser login.",
    });
  });

  it("persists future branch-aware step metadata in workflow specs", async () => {
    const workspaceDir = await tempDirs.make("workflow-registry-branch-contracts-");

    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Branch Contracts",
      goal: "Prepare workflow branch metadata",
      stepSpecs: [
        {
          title: "Prepare",
        },
        {
          title: "Approval path",
          kind: "human_wait",
          path: "approval",
          branchGroup: "review",
          activationMode: "conditional",
          activationWhen: "{{ $json.requiresApproval === true }}",
          activationFromStepIds: ["step_1"],
        },
      ],
    });

    expect(created.spec.topology).toBe("branch_v2");
    expect(created.spec.steps[1]).toMatchObject({
      path: "approval",
      branchGroup: "review",
      activation: {
        mode: "conditional",
        when: "{{ $json.requiresApproval === true }}",
        fromStepIds: ["step_1"],
      },
    });
  });

  it("derives invocation hints and supports filtered workflow matches", async () => {
    const workspaceDir = await tempDirs.make("workflow-registry-invocation-");
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Auto Publish",
      goal: "Automatically publish content",
      safeForAutoRun: true,
      requiresApproval: false,
    });
    await markWorkflowDeployed({ workspaceDir }, created.entry.workflowId, {
      n8nWorkflowId: "wf_remote",
    });

    const described = await describeWorkflow({ workspaceDir }, created.entry.workflowId);
    expect(described).not.toBeNull();
    expect(getWorkflowInvocationHint(described!.entry)).toEqual({
      canRun: true,
      autoRunnable: true,
      recommendedAction: "run",
      reason: "Workflow is deployed, enabled, and marked safe for auto-run.",
    });

    const filtered = await matchWorkflows({ workspaceDir }, "publish", {
      deployedOnly: true,
      autoRunnableOnly: true,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.workflowId).toBe(created.entry.workflowId);
  });

  it("archives and deletes workflow entries", async () => {
    const workspaceDir = await tempDirs.make("workflow-registry-delete-");
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Archive Me",
      goal: "Archive and delete workflow",
    });

    const archived = await setWorkflowArchived({ workspaceDir }, created.entry.workflowId, true);
    expect(archived?.archivedAt).toBeTypeOf("number");
    expect(getWorkflowInvocationHint(archived!)).toMatchObject({
      recommendedAction: "skip",
      canRun: false,
    });

    const deleted = await deleteWorkflow({ workspaceDir }, created.entry.workflowId);
    expect(deleted.deleted).toBe(true);
    expect(await describeWorkflow({ workspaceDir }, created.entry.workflowId)).toBeNull();
  });
});

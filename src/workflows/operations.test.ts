import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import {
  createWorkflowDraft,
  markWorkflowDeployed,
  resolveRunnableWorkflowForExecution,
  setWorkflowArchived,
  setWorkflowEnabled,
} from "./api.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("workflow operations run gate", () => {
  async function createDeployedWorkflow(overrides?: {
    requiresApproval?: boolean;
    enabled?: boolean;
  }) {
    const workspaceDir = await tempDirs.make("workflow-run-gate-");
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      tags: ["redbook"],
      requiresApproval: overrides?.requiresApproval ?? false,
    });
    await markWorkflowDeployed({ workspaceDir }, created.entry.workflowId, {
      n8nWorkflowId: "wf_remote",
      specVersion: created.entry.specVersion,
    });
    if (overrides?.enabled === false) {
      await setWorkflowEnabled({ workspaceDir }, created.entry.workflowId, false);
    }
    return { workspaceDir, workflowId: created.entry.workflowId };
  }

  it("rejects disabled and archived workflows before execution", async () => {
    const disabled = await createDeployedWorkflow({ enabled: false });
    await expect(
      resolveRunnableWorkflowForExecution(disabled, disabled.workflowId),
    ).rejects.toThrow(/disabled/);

    const archived = await createDeployedWorkflow();
    await setWorkflowArchived({ workspaceDir: archived.workspaceDir }, archived.workflowId, true);
    await expect(
      resolveRunnableWorkflowForExecution(archived, archived.workflowId),
    ).rejects.toThrow(/archived/);
  });

  it("requires explicit approval when registry policy requires approval", async () => {
    const workflow = await createDeployedWorkflow({ requiresApproval: true });
    await expect(
      resolveRunnableWorkflowForExecution(workflow, workflow.workflowId),
    ).rejects.toThrow(/requires explicit approval/);
    await expect(
      resolveRunnableWorkflowForExecution(workflow, workflow.workflowId, { approved: true }),
    ).resolves.toMatchObject({
      entry: { workflowId: workflow.workflowId, n8nWorkflowId: "wf_remote" },
    });
  });
});

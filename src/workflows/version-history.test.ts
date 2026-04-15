import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import {
  createWorkflowDraft,
  listWorkflowVersions,
  markWorkflowDeployed,
  rollbackWorkflowDefinition,
  updateWorkflowDefinition,
} from "./registry.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("workflow version history", () => {
  it("stores spec snapshots on create and update, then supports rollback", async () => {
    const workspaceDir = await tempDirs.make("workflow-version-history-");
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      description: "Initial description",
      tags: ["redbook"],
      safeForAutoRun: false,
      requiresApproval: true,
    });

    await markWorkflowDeployed({ workspaceDir }, created.entry.workflowId, {
      n8nWorkflowId: "wf_remote",
      specVersion: created.entry.specVersion,
      publishedBySessionKey: "agent:main:main",
      summary: "initial deploy",
    });

    const updated = await updateWorkflowDefinition(
      {
        workspaceDir,
        sessionKey: "agent:main:main",
      },
      created.entry.workflowId,
      {
        description: "Updated description",
        safeForAutoRun: true,
      },
    );
    expect(updated?.entry.specVersion).toBe(2);
    expect(updated?.entry.deploymentState).toBe("draft");

    const rolledBack = await rollbackWorkflowDefinition(
      {
        workspaceDir,
        sessionKey: "agent:main:main",
      },
      created.entry.workflowId,
      1,
    );
    expect(rolledBack?.entry.specVersion).toBe(3);
    expect(rolledBack?.spec.description).toBe("Initial description");
    expect(rolledBack?.entry.safeForAutoRun).toBe(false);

    const versions = await listWorkflowVersions({ workspaceDir }, created.entry.workflowId);
    expect(versions?.specVersions.map((snapshot) => snapshot.specVersion)).toEqual([3, 2, 1]);
    expect(versions?.deployments).toHaveLength(1);
    expect(versions?.deployments[0]).toMatchObject({
      deploymentVersion: 1,
      specVersion: 1,
      n8nWorkflowId: "wf_remote",
    });
  });
});

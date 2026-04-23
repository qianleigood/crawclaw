import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { __testing as n8nTesting } from "../../workflows/api.js";
import { createWorkflowTool } from "./workflow-tool.js";
import { createWorkflowizeTool } from "./workflowize-tool.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  n8nTesting.setDepsForTest(null);
  await tempDirs.cleanup();
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function parseJsonRequestBody(init?: RequestInit): Record<string, unknown> | undefined {
  const body = init?.body;
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string") {
    return JSON.parse(body) as Record<string, unknown>;
  }
  if (body instanceof URLSearchParams) {
    return JSON.parse(body.toString()) as Record<string, unknown>;
  }
  throw new Error(`Unexpected request body type in workflow-tool.test.ts: ${typeof body}`);
}

const TEST_WORKFLOW_NAME = "Publish Redbook Note";

const TEST_N8N_CONFIG = {
  workflow: {
    n8n: {
      baseUrl: "https://n8n.example.com",
      apiKey: "secret-token",
      projectId: "proj-workflows",
      triggerBearerToken: "trigger-secret",
      callbackBaseUrl: "https://crawclaw.example.com/",
      callbackBearerToken: "secret-gateway-token",
    },
  },
} as const;

function createRemoteWorkflowResponse(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: TEST_WORKFLOW_NAME,
    nodes: [],
    connections: {},
    settings: {},
    ...overrides,
  };
}

function createWorkflowToolSet(params: {
  workspaceDir: string;
  sessionKey?: string;
  sessionId?: string;
}) {
  return {
    workflowize: createWorkflowizeTool({
      workspaceDir: params.workspaceDir,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    }),
    workflow: createWorkflowTool({
      workspaceDir: params.workspaceDir,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      config: TEST_N8N_CONFIG,
    }),
  };
}

describe("workflow tools", () => {
  it("workflowize creates a draft workflow in the workspace store", async () => {
    const workspaceDir = await tempDirs.make("workflow-tool-");
    const tool = createWorkflowizeTool({
      workspaceDir,
      sessionKey: "agent:main:main",
      sessionId: "session-1",
    });

    const result = await tool.execute("workflowize-1", {
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      steps: ["Draft content", "Wait for approval", "Publish"],
      tags: ["redbook", "content"],
    });
    const details = result.details as {
      status: string;
      workflowId: string;
      storeRoot: string;
      specPath: string;
    };

    expect(details.status).toBe("created");
    expect(details.workflowId).toMatch(/^wf_/);
    expect(details.storeRoot).toBe(path.join(workspaceDir, ".crawclaw", "workflows"));
    await expect(fs.readFile(details.specPath, "utf8")).resolves.toContain(TEST_WORKFLOW_NAME);
  });

  it("workflowize infers branch_v2 when step specs include branch metadata", async () => {
    const workspaceDir = await tempDirs.make("workflow-tool-branchy-");
    const tool = createWorkflowizeTool({
      workspaceDir,
      sessionKey: "agent:main:main",
      sessionId: "session-branchy",
    });

    const result = await tool.execute("workflowize-branch-1", {
      name: "Branchy Approval Workflow",
      goal: "Branch on approval before publish",
      stepSpecs: [
        { title: "Prepare" },
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
    const details = result.details as {
      spec: { topology?: string; steps: Array<{ path?: string; activation?: { mode?: string } }> };
    };

    expect(details.spec.topology).toBe("branch_v2");
    expect(details.spec.steps[1]).toMatchObject({
      path: "approval",
      activation: { mode: "conditional" },
    });
  });

  it("workflow tool lists, describes, matches, toggles, deploys, runs, and queries execution", async () => {
    const workspaceDir = await tempDirs.make("workflow-tool-list-");
    const { workflowize, workflow } = createWorkflowToolSet({ workspaceDir });

    let webhookBody: Record<string, unknown> | null = null;
    let createdWorkflowBody: Record<string, unknown> | null = null;
    n8nTesting.setDepsForTest({
      fetchImpl: async (input, init) => {
        const url = requestUrl(input);
        if (url.endsWith("/api/v1/workflows")) {
          createdWorkflowBody = parseJsonRequestBody(init) ?? {};
          return new Response(JSON.stringify(createRemoteWorkflowResponse("wf_remote")), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/v1/workflows/wf_remote")) {
          return new Response(JSON.stringify(createRemoteWorkflowResponse("wf_remote")), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/v1/workflows/wf_remote/activate")) {
          return new Response(
            JSON.stringify(createRemoteWorkflowResponse("wf_remote", { active: true })),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/v1/workflows/wf_remote/deactivate")) {
          return new Response(
            JSON.stringify(createRemoteWorkflowResponse("wf_remote", { active: false })),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/webhook/crawclaw-wf_publish_redbook_note")) {
          expect(((init?.headers ?? {}) as Record<string, string>).Authorization).toBe(
            "Bearer trigger-secret",
          );
          webhookBody = parseJsonRequestBody(init) ?? {};
          return new Response(JSON.stringify({ message: "Workflow was started" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/v1/executions?workflowId=wf_remote")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "exec_unrelated",
                  workflowId: "wf_remote",
                  status: "running",
                  finished: false,
                  startedAt: new Date().toISOString(),
                  data: {
                    resultData: { runData: { trigger: [{ data: { main: [[{}]] } }] } },
                  },
                },
                {
                  id: "exec_1",
                  workflowId: "wf_remote",
                  status: "running",
                  finished: false,
                  startedAt: new Date().toISOString(),
                  data: {
                    resultData: {
                      runData: {
                        trigger: [
                          {
                            data: {
                              main: [
                                [
                                  {
                                    json: {
                                      crawclawExecutionId: webhookBody?.crawclawExecutionId,
                                    },
                                  },
                                ],
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/api/v1/executions/exec_1") && !url.includes("/stop")) {
          return new Response(JSON.stringify({ id: "exec_1", status: "success", finished: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/v1/executions/exec_1/stop")) {
          return new Response(JSON.stringify({ id: "exec_1", status: "canceled" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL ${url} ${init?.method ?? "GET"}`);
      },
    });

    await workflowize.execute("workflowize-2", {
      name: TEST_WORKFLOW_NAME,
      goal: "Generate and publish a redbook post",
      description: "Content publishing workflow",
      tags: ["redbook", "publish"],
    });

    const listed = (
      await workflow.execute("workflow-list", {
        action: "list",
      })
    ).details as {
      count: number;
      workflows: Array<{
        name: string;
        runCount: number;
        recentExecution: Record<string, unknown> | null;
      }>;
    };
    expect(listed.count).toBe(1);
    expect(listed.workflows[0]?.name).toBe(TEST_WORKFLOW_NAME);
    expect(listed.workflows[0]?.runCount).toBe(0);
    expect(listed.workflows[0]?.recentExecution).toBeNull();

    const described = (
      await workflow.execute("workflow-describe", {
        action: "describe",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as {
      workflow: { name: string };
      spec: { goal: string };
      recentExecutions: unknown[];
    };
    expect(described.workflow.name).toBe(TEST_WORKFLOW_NAME);
    expect(described.spec.goal).toBe("Generate and publish a redbook post");
    expect(described.recentExecutions).toHaveLength(0);

    const matched = (
      await workflow.execute("workflow-match", {
        action: "match",
        query: "redbook",
        enabledOnly: true,
      })
    ).details as {
      count: number;
      matches: Array<{ name: string; invocation: { recommendedAction: string } }>;
    };
    expect(matched.count).toBe(1);
    expect(matched.matches[0]?.name).toBe(TEST_WORKFLOW_NAME);
    expect(matched.matches[0]?.invocation.recommendedAction).toBe("skip");

    const disabled = (
      await workflow.execute("workflow-disable", {
        action: "disable",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as { workflow: { enabled: boolean } };
    expect(disabled.workflow.enabled).toBe(false);

    const archived = (
      await workflow.execute("workflow-archive", {
        action: "archive",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as { workflow: { archivedAt?: number } };
    expect(archived.workflow.archivedAt).toBeTypeOf("number");

    const unarchived = (
      await workflow.execute("workflow-unarchive", {
        action: "unarchive",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as { workflow: { archivedAt?: number } };
    expect(unarchived.workflow.archivedAt).toBeUndefined();

    const deployed = (
      await workflow.execute("workflow-deploy", {
        action: "deploy",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as {
      workflow: { deploymentState: string; n8nWorkflowId: string };
      compiled: {
        staticData?: { crawclawSpecVersion?: number };
        nodes: Array<{ type?: string; parameters?: { url?: string } }>;
      };
    };
    expect(deployed.workflow.deploymentState).toBe("deployed");
    expect(deployed.workflow.n8nWorkflowId).toBe("wf_remote");
    expect(createdWorkflowBody?.["projectId"]).toBe("proj-workflows");
    expect(deployed.compiled.staticData?.crawclawSpecVersion).toBe(1);
    expect(deployed.compiled.nodes[3]?.type).toBe("n8n-nodes-base.httpRequest");
    expect(deployed.compiled.nodes[3]?.parameters?.url).toBe(
      "https://crawclaw.example.com/workflows/agent/run",
    );

    const enabledAfterDeploy = (
      await workflow.execute("workflow-enable-after-deploy", {
        action: "enable",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as { workflow: { enabled: boolean } };
    expect(enabledAfterDeploy.workflow.enabled).toBe(true);

    const run = (
      await workflow.execute("workflow-run", {
        action: "run",
        workflow: TEST_WORKFLOW_NAME,
        approved: true,
        inputs: {
          topic: "AI workflow",
          requiresApproval: true,
        },
      })
    ).details as {
      status: string;
      execution: { executionId: string; n8nExecutionId: string; source: string };
      localExecution: { executionId: string; workflowId: string };
      remoteExecution: { executionId: string };
    };
    expect(run.status).toBe("ok");
    expect(run.execution.n8nExecutionId).toBe("exec_1");
    expect(run.execution.source).toBe("local+n8n");
    expect(run.localExecution.executionId).toMatch(/^exec_/);
    expect(run.remoteExecution.executionId).toBe("exec_1");
    expect(webhookBody).toMatchObject({
      workflowInput: {
        topic: "AI workflow",
        requiresApproval: true,
      },
      topic: "AI workflow",
      requiresApproval: true,
    });

    const runs = (
      await workflow.execute("workflow-runs", {
        action: "runs",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as { count: number; executions: Array<{ executionId: string; workflowId: string }> };
    expect(runs.count).toBe(1);
    expect(runs.executions[0]?.executionId).toBe(run.localExecution.executionId);
    expect(runs.executions[0]?.workflowId).toBe(run.localExecution.workflowId);

    const listedAfterRun = (
      await workflow.execute("workflow-list-after-run", {
        action: "list",
      })
    ).details as {
      workflows: Array<{ runCount: number; recentExecution: { executionId: string } | null }>;
    };
    expect(listedAfterRun.workflows[0]?.runCount).toBe(1);
    expect(listedAfterRun.workflows[0]?.recentExecution?.executionId).toBe(
      run.localExecution.executionId,
    );

    const status = (
      await workflow.execute("workflow-status", {
        action: "status",
        executionId: run.localExecution.executionId,
      })
    ).details as {
      status: string;
      execution: { status: string; executionId: string; n8nExecutionId: string; source: string };
    };
    expect(status.status).toBe("ok");
    expect(status.execution.status).toBe("succeeded");
    expect(status.execution.executionId).toBe(run.localExecution.executionId);
    expect(status.execution.n8nExecutionId).toBe("exec_1");
    expect(status.execution.source).toBe("local+n8n");

    const cancelled = (
      await workflow.execute("workflow-cancel", {
        action: "cancel",
        executionId: run.localExecution.executionId,
      })
    ).details as { status: string; execution: { status: string; source: string } };
    expect(cancelled.status).toBe("ok");
    expect(cancelled.execution.status).toBe("cancelled");
    expect(cancelled.execution.source).toBe("local+n8n");

    const deleted = (
      await workflow.execute("workflow-delete", {
        action: "delete",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as { status: string; deleted: boolean };
    expect(deleted.status).toBe("ok");
    expect(deleted.deleted).toBe(true);
  });

  it("workflow tool manages spec versions, diff, republish, and rollback", async () => {
    const workspaceDir = await tempDirs.make("workflow-tool-versions-");
    const { workflowize, workflow } = createWorkflowToolSet({
      workspaceDir,
      sessionKey: "agent:main:main",
      sessionId: "session-versions",
    });

    n8nTesting.setDepsForTest({
      fetchImpl: async (input, init) => {
        const url = requestUrl(input);
        if (url.endsWith("/api/v1/workflows")) {
          return new Response(JSON.stringify(createRemoteWorkflowResponse("wf_remote_versions")), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/api/v1/workflows/wf_remote_versions")) {
          return new Response(
            JSON.stringify(
              createRemoteWorkflowResponse("wf_remote_versions", {
                active: true,
                body: parseJsonRequestBody(init),
              }),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/v1/workflows/wf_remote_versions/activate")) {
          return new Response(
            JSON.stringify(createRemoteWorkflowResponse("wf_remote_versions", { active: true })),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Unexpected URL ${url} ${init?.method ?? "GET"}`);
      },
    });

    await workflowize.execute("workflowize-versions", {
      name: TEST_WORKFLOW_NAME,
      goal: "Generate and publish a redbook post",
      description: "Initial description",
      tags: ["redbook"],
      safeForAutoRun: false,
      requiresApproval: true,
    });

    const initialVersions = (
      await workflow.execute("workflow-versions-initial", {
        action: "versions",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as {
      specVersions: Array<{ specVersion: number }>;
      deployments: unknown[];
    };
    expect(initialVersions.specVersions.map((snapshot) => snapshot.specVersion)).toEqual([1]);
    expect(initialVersions.deployments).toHaveLength(0);

    const deployed = (
      await workflow.execute("workflow-deploy-initial", {
        action: "deploy",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as {
      workflow: { deploymentVersion: number; n8nWorkflowId: string; deploymentState: string };
    };
    expect(deployed.workflow.deploymentVersion).toBe(1);
    expect(deployed.workflow.deploymentState).toBe("deployed");

    const updated = (
      await workflow.execute("workflow-update", {
        action: "update",
        workflow: TEST_WORKFLOW_NAME,
        patch: {
          description: "Updated description",
          safeForAutoRun: true,
        },
      })
    ).details as {
      workflow: { specVersion: number; deploymentState: string; safeForAutoRun: boolean };
      needsRepublish: boolean;
    };
    expect(updated.workflow.specVersion).toBe(2);
    expect(updated.workflow.deploymentState).toBe("draft");
    expect(updated.workflow.safeForAutoRun).toBe(true);
    expect(updated.needsRepublish).toBe(true);

    const diff = (
      await workflow.execute("workflow-diff", {
        action: "diff",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as {
      fromSpecVersion: number;
      toSpecVersion: number;
      diff: { summary: { basicChanged: boolean; policyChanged: boolean } };
    };
    expect(diff.fromSpecVersion).toBe(1);
    expect(diff.toSpecVersion).toBe(2);
    expect(diff.diff.summary.basicChanged).toBe(true);
    expect(diff.diff.summary.policyChanged).toBe(true);

    await expect(
      workflow.execute("workflow-run-while-draft", {
        action: "run",
        workflow: TEST_WORKFLOW_NAME,
      }),
    ).rejects.toThrow(/not currently deployed/i);

    const republished = (
      await workflow.execute("workflow-republish", {
        action: "republish",
        workflow: TEST_WORKFLOW_NAME,
        summary: "publish updated spec",
      })
    ).details as {
      workflow: { deploymentVersion: number; deploymentState: string };
      republished: boolean;
    };
    expect(republished.workflow.deploymentVersion).toBe(2);
    expect(republished.workflow.deploymentState).toBe("deployed");
    expect(republished.republished).toBe(true);

    const rolledBack = (
      await workflow.execute("workflow-rollback", {
        action: "rollback",
        workflow: TEST_WORKFLOW_NAME,
        specVersion: 1,
      })
    ).details as {
      workflow: { specVersion: number; deploymentState: string; safeForAutoRun: boolean };
      restoredFromSpecVersion: number;
      needsRepublish: boolean;
    };
    expect(rolledBack.workflow.specVersion).toBe(3);
    expect(rolledBack.workflow.deploymentState).toBe("draft");
    expect(rolledBack.workflow.safeForAutoRun).toBe(false);
    expect(rolledBack.restoredFromSpecVersion).toBe(1);
    expect(rolledBack.needsRepublish).toBe(true);

    const versions = (
      await workflow.execute("workflow-versions-final", {
        action: "versions",
        workflow: TEST_WORKFLOW_NAME,
      })
    ).details as {
      specVersions: Array<{ specVersion: number; reason: string }>;
      deployments: Array<{ deploymentVersion: number; specVersion: number; summary?: string }>;
    };
    expect(versions.specVersions.map((snapshot) => snapshot.specVersion)).toEqual([3, 2, 1]);
    expect(versions.deployments.map((deployment) => deployment.deploymentVersion)).toEqual([2, 1]);
    expect(versions.deployments[0]).toMatchObject({
      deploymentVersion: 2,
      specVersion: 2,
      summary: "publish updated spec",
    });
  });
});

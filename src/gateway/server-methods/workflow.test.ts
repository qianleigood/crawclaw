import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGatewaySubagentRuntime,
  setGatewaySubagentRuntime,
} from "../../plugins/runtime/index.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import {
  __testing as n8nTesting,
  createWorkflowDraft,
  createWorkflowExecutionRecord,
  getWorkflowExecution,
} from "../../workflows/api.js";
import { ErrorCodes } from "../protocol/index.js";
import { workflowHandlers } from "./workflow.js";

const tempDirs = createTrackedTempDirs();

type RespondCall = [boolean, unknown?, { code: string; message: string }?];

afterEach(async () => {
  clearGatewaySubagentRuntime();
  n8nTesting.setDepsForTest(null);
  delete process.env.CRAWCLAW_N8N_BASE_URL;
  delete process.env.CRAWCLAW_N8N_API_KEY;
  delete process.env.CRAWCLAW_N8N_CALLBACK_BASE_URL;
  delete process.env.CRAWCLAW_N8N_CALLBACK_BEARER_TOKEN;
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
  throw new Error(`Unexpected request body type in workflow.test.ts: ${typeof body}`);
}

function expectSuccessPayload<T>(call: RespondCall | undefined): T {
  expect(call?.[0]).toBe(true);
  if (!call) {
    throw new Error("expected success response call");
  }
  return call[1] as T;
}

function createInvokeParams(
  method: keyof typeof workflowHandlers,
  params: Record<string, unknown>,
) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await workflowHandlers[method]({
        params,
        respond: respond as never,
        context: {} as never,
        client: null,
        req: { type: "req", id: "req-1", method },
        isWebchatConnect: () => false,
      }),
  };
}

describe("workflow.agent.run handler", () => {
  it("rejects invalid params when no workflow store binding is provided", async () => {
    const { respond, invoke } = createInvokeParams("workflow.agent.run", {
      workflowId: "wf_publish_redbook_123",
      executionId: "exec_remote_1",
      stepId: "draft",
      goal: "Draft content",
    });

    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call?.[2]?.message).toContain("invalid workflow.agent.run params");
  });

  it("runs workflow-step-agent callbacks through the gateway-bound subagent runtime", async () => {
    const workspaceDir = await tempDirs.make("gateway-workflow-agent-");
    await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
        n8nWorkflowId: "wf_remote",
        spec: {
          workflowId: "wf_publish_redbook_123",
          name: "Publish Redbook Note",
          goal: "Generate and publish a redbook post",
          sourceWorkspaceDir: workspaceDir,
          tags: [],
          inputs: [],
          outputs: [],
          steps: [
            { id: "draft", kind: "crawclaw_agent", title: "Draft content", goal: "Draft content" },
            { id: "review", kind: "human_wait", title: "Review", prompt: "Approve" },
          ],
          createdAt: 0,
          updatedAt: 0,
        },
        remote: {
          executionId: "exec_remote_1",
          status: "running",
          finished: false,
        },
      },
    );

    let seenRunParams: unknown;
    setGatewaySubagentRuntime({
      run: async (params) => {
        seenRunParams = params;
        return { runId: "run-1" };
      },
      waitForRun: async () => ({ status: "ok" as const }),
      getSessionMessages: async () => ({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "succeeded",
                  summary: "Draft completed",
                  output: { title: "AI workflow" },
                }),
              },
            ],
          },
        ],
      }),
      deleteSession: async () => {},
    });

    const { respond, invoke } = createInvokeParams("workflow.agent.run", {
      workflowId: "wf_publish_redbook_123",
      executionId: "exec_remote_1",
      stepId: "draft",
      goal: "Draft content",
      workspaceBinding: {
        workspaceDir,
      },
      allowedTools: ["browser"],
      allowedSkills: ["redbook-skills"],
    });

    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    const payload = call?.[1] as
      | {
          result: { status: string; summary?: string };
          execution: { status: string; steps?: Array<{ stepId: string; status: string }> };
        }
      | undefined;
    expect(seenRunParams).toMatchObject({
      toolsAllow: ["browser"],
      skillsAllow: ["redbook-skills"],
      lane: "workflow-step",
    });
    expect(payload?.result.status).toBe("succeeded");
    expect(payload?.execution.status).toBe("running");
    expect(payload?.execution.steps?.[0]).toMatchObject({
      stepId: "draft",
      status: "succeeded",
    });

    const persisted = await getWorkflowExecution({ workspaceDir }, "exec_remote_1");
    expect(persisted?.steps?.[0]?.summary).toBe("Draft completed");
  });
});

describe("workflow management handlers", () => {
  it("lists workflows and recent executions from the workflow store", async () => {
    const workspaceDir = await tempDirs.make("gateway-workflow-list-");
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      description: "Content publishing workflow",
      tags: ["redbook", "publish"],
    });
    await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: created.entry.workflowId,
        workflowName: created.entry.name,
        spec: created.spec,
      },
    );

    const { respond, invoke } = createInvokeParams("workflow.list", {
      workspaceDir,
    });
    await invoke();

    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    const payload = call?.[1] as
      | {
          count: number;
          workflows: Array<{
            name: string;
            runCount: number;
            recentExecution: { workflowId: string } | null;
          }>;
        }
      | undefined;
    expect(payload?.count).toBe(1);
    expect(payload?.workflows[0]?.name).toBe("Publish Redbook Note");
    expect(payload?.workflows[0]?.runCount).toBe(1);
    expect(payload?.workflows[0]?.recentExecution?.workflowId).toBe(created.entry.workflowId);
  });

  it("archives and deletes workflows through gateway workflow methods", async () => {
    const workspaceDir = await tempDirs.make("gateway-workflow-archive-");
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Archive Me",
      goal: "Archive workflow",
    });

    const archive = createInvokeParams("workflow.archive", {
      workspaceDir,
      workflow: created.entry.workflowId,
    });
    await archive.invoke();
    const archiveCall = archive.respond.mock.calls[0] as RespondCall | undefined;
    const archivePayload = expectSuccessPayload<{ workflow: { archivedAt?: number } }>(archiveCall);
    expect(archivePayload.workflow.archivedAt).toBeTypeOf("number");

    const remove = createInvokeParams("workflow.delete", {
      workspaceDir,
      workflow: created.entry.workflowId,
    });
    await remove.invoke();
    const removeCall = remove.respond.mock.calls[0] as RespondCall | undefined;
    const removePayload = expectSuccessPayload<{ deleted: boolean }>(removeCall);
    expect(removePayload.deleted).toBe(true);
  });

  it("supports versions, diff, update, republish, and rollback through gateway workflow methods", async () => {
    const workspaceDir = await tempDirs.make("gateway-workflow-versioning-");
    process.env.CRAWCLAW_N8N_BASE_URL = "https://n8n.example.com";
    process.env.CRAWCLAW_N8N_API_KEY = "secret-token";
    process.env.CRAWCLAW_N8N_CALLBACK_BASE_URL = "https://crawclaw.example.com";
    process.env.CRAWCLAW_N8N_CALLBACK_BEARER_TOKEN = "secret-gateway-token";
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      description: "Initial description",
      tags: ["redbook"],
      safeForAutoRun: false,
      requiresApproval: true,
    });

    n8nTesting.setDepsForTest({
      fetchImpl: async (input, init) => {
        const url = requestUrl(input);
        if (url.endsWith("/api/v1/workflows")) {
          return new Response(
            JSON.stringify({
              id: "wf_remote_versions",
              name: "Publish Redbook Note",
              nodes: [],
              connections: {},
              settings: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/v1/workflows/wf_remote_versions")) {
          return new Response(
            JSON.stringify({
              id: "wf_remote_versions",
              name: "Publish Redbook Note",
              active: true,
              nodes: [],
              connections: {},
              settings: {},
              body: parseJsonRequestBody(init),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/v1/workflows/wf_remote_versions/activate")) {
          return new Response(
            JSON.stringify({
              id: "wf_remote_versions",
              name: "Publish Redbook Note",
              active: true,
              nodes: [],
              connections: {},
              settings: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Unexpected URL ${url} ${init?.method ?? "GET"}`);
      },
    });

    const versionsInitial = createInvokeParams("workflow.versions", {
      workspaceDir,
      workflow: created.entry.workflowId,
    });
    await versionsInitial.invoke();
    const versionsInitialCall = versionsInitial.respond.mock.calls[0] as RespondCall | undefined;
    const versionsInitialPayload = expectSuccessPayload<{
      specVersions: Array<{ specVersion: number }>;
    }>(versionsInitialCall);
    expect(versionsInitialPayload.specVersions.map((entry) => entry.specVersion)).toEqual([1]);

    const deploy = createInvokeParams("workflow.deploy", {
      workspaceDir,
      workflow: created.entry.workflowId,
    });
    await deploy.invoke();
    const deployCall = deploy.respond.mock.calls[0] as RespondCall | undefined;
    const deployPayload = expectSuccessPayload<{ workflow: { deploymentVersion: number } }>(
      deployCall,
    );
    expect(deployPayload.workflow.deploymentVersion).toBe(1);

    const update = createInvokeParams("workflow.update", {
      workspaceDir,
      workflow: created.entry.workflowId,
      patch: {
        description: "Updated description",
        safeForAutoRun: true,
      },
    });
    await update.invoke();
    const updateCall = update.respond.mock.calls[0] as RespondCall | undefined;
    const updatePayload = expectSuccessPayload<{
      workflow: { specVersion: number; deploymentState: string };
    }>(updateCall);
    expect(updatePayload.workflow).toMatchObject({
      specVersion: 2,
      deploymentState: "draft",
    });

    const diff = createInvokeParams("workflow.diff", {
      workspaceDir,
      workflow: created.entry.workflowId,
    });
    await diff.invoke();
    const diffCall = diff.respond.mock.calls[0] as RespondCall | undefined;
    const diffPayload = expectSuccessPayload<{ fromSpecVersion: number; toSpecVersion: number }>(
      diffCall,
    );
    expect(diffPayload.fromSpecVersion).toBe(1);
    expect(diffPayload.toSpecVersion).toBe(2);

    const republish = createInvokeParams("workflow.republish", {
      workspaceDir,
      workflow: created.entry.workflowId,
      summary: "publish updated spec",
    });
    await republish.invoke();
    const republishCall = republish.respond.mock.calls[0] as RespondCall | undefined;
    const republishPayload = expectSuccessPayload<{
      workflow: { deploymentVersion: number };
      republished: boolean;
    }>(republishCall);
    expect(republishPayload.workflow.deploymentVersion).toBe(2);
    expect(republishPayload.republished).toBe(true);

    const rollback = createInvokeParams("workflow.rollback", {
      workspaceDir,
      workflow: created.entry.workflowId,
      specVersion: 1,
    });
    await rollback.invoke();
    const rollbackCall = rollback.respond.mock.calls[0] as RespondCall | undefined;
    const rollbackPayload = expectSuccessPayload<{
      restoredFromSpecVersion: number;
      workflow: { specVersion: number; deploymentState: string };
    }>(rollbackCall);
    expect(rollbackPayload.restoredFromSpecVersion).toBe(1);
    expect(rollbackPayload.workflow).toMatchObject({
      specVersion: 3,
      deploymentState: "draft",
    });

    const versionsFinal = createInvokeParams("workflow.versions", {
      workspaceDir,
      workflow: created.entry.workflowId,
    });
    await versionsFinal.invoke();
    const versionsFinalCall = versionsFinal.respond.mock.calls[0] as RespondCall | undefined;
    const versionsFinalPayload = expectSuccessPayload<{
      specVersions: Array<{ specVersion: number }>;
      deployments: Array<{ deploymentVersion: number; specVersion: number }>;
    }>(versionsFinalCall);
    expect(versionsFinalPayload.specVersions.map((entry) => entry.specVersion)).toEqual([3, 2, 1]);
    expect(versionsFinalPayload.deployments.map((entry) => entry.deploymentVersion)).toEqual([
      2, 1,
    ]);
  });

  it("deploys, runs, and synchronizes workflow executions through gateway workflow methods", async () => {
    const workspaceDir = await tempDirs.make("gateway-workflow-run-");
    process.env.CRAWCLAW_N8N_BASE_URL = "https://n8n.example.com";
    process.env.CRAWCLAW_N8N_API_KEY = "secret-token";
    process.env.CRAWCLAW_N8N_CALLBACK_BASE_URL = "https://crawclaw.example.com";
    process.env.CRAWCLAW_N8N_CALLBACK_BEARER_TOKEN = "secret-gateway-token";
    await createWorkflowDraft({
      workspaceDir,
      name: "Publish Redbook Note",
      goal: "Generate and publish a redbook post",
      description: "Content publishing workflow",
      tags: ["redbook", "publish"],
    });

    let webhookBody: Record<string, unknown> | null = null;
    n8nTesting.setDepsForTest({
      fetchImpl: async (input, init) => {
        const url = requestUrl(input);
        if (url.endsWith("/api/v1/workflows")) {
          return new Response(
            JSON.stringify({
              id: "wf_remote",
              name: "Publish Redbook Note",
              nodes: [],
              connections: {},
              settings: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/v1/workflows/wf_remote")) {
          return new Response(
            JSON.stringify({
              id: "wf_remote",
              name: "Publish Redbook Note",
              nodes: [],
              connections: {},
              settings: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/api/v1/workflows/wf_remote/activate")) {
          return new Response(
            JSON.stringify({
              id: "wf_remote",
              name: "Publish Redbook Note",
              active: true,
              nodes: [],
              connections: {},
              settings: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/webhook/crawclaw-wf_publish_redbook_note")) {
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
                  id: "exec_1",
                  workflowId: "wf_remote",
                  status: "running",
                  finished: false,
                  startedAt: new Date().toISOString(),
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

    const deploy = createInvokeParams("workflow.deploy", {
      workspaceDir,
      workflow: "Publish Redbook Note",
    });
    await deploy.invoke();
    const deployCall = deploy.respond.mock.calls[0] as RespondCall | undefined;
    expect(deployCall?.[0]).toBe(true);

    const run = createInvokeParams("workflow.run", {
      workspaceDir,
      workflow: "Publish Redbook Note",
      inputs: {
        topic: "AI workflow",
        requiresApproval: true,
      },
    });
    await run.invoke();
    const runCall = run.respond.mock.calls[0] as RespondCall | undefined;
    expect(runCall?.[0]).toBe(true);
    const runPayload = runCall?.[1] as
      | {
          execution: { executionId: string; n8nExecutionId: string };
          localExecution: { executionId: string };
        }
      | undefined;
    expect(runPayload?.execution.n8nExecutionId).toBe("exec_1");
    expect(webhookBody).toMatchObject({
      workflowInput: {
        topic: "AI workflow",
        requiresApproval: true,
      },
      topic: "AI workflow",
      requiresApproval: true,
    });

    const status = createInvokeParams("workflow.status", {
      workspaceDir,
      executionId: runPayload?.localExecution.executionId,
    });
    await status.invoke();
    const statusCall = status.respond.mock.calls[0] as RespondCall | undefined;
    expect(statusCall?.[0]).toBe(true);
    const statusPayload = statusCall?.[1] as
      | { execution: { status: string; source: string } }
      | undefined;
    expect(statusPayload?.execution.status).toBe("succeeded");
    expect(statusPayload?.execution.source).toBe("local+n8n");

    const cancel = createInvokeParams("workflow.cancel", {
      workspaceDir,
      executionId: runPayload?.localExecution.executionId,
    });
    await cancel.invoke();
    const cancelCall = cancel.respond.mock.calls[0] as RespondCall | undefined;
    expect(cancelCall?.[0]).toBe(true);
    const cancelPayload = cancelCall?.[1] as { execution: { status: string } } | undefined;
    expect(cancelPayload?.execution.status).toBe("cancelled");
  });

  it("resumes waiting executions through the n8n wait webhook URL", async () => {
    const workspaceDir = await tempDirs.make("gateway-workflow-resume-");
    process.env.CRAWCLAW_N8N_BASE_URL = "https://n8n.example.com";
    process.env.CRAWCLAW_N8N_API_KEY = "secret-token";
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Approval Flow",
      goal: "Wait for approval before publish",
      description: "Approval workflow",
      tags: ["approval"],
    });
    const localExecution = await createWorkflowExecutionRecord(
      { workspaceDir },
      {
        workflowId: created.entry.workflowId,
        workflowName: created.entry.name,
        n8nWorkflowId: "wf_remote_resume",
        spec: {
          ...created.spec,
          steps: [{ id: "approve", kind: "human_wait", prompt: "Approve publish" }],
        },
        remote: {
          executionId: "exec_wait_1",
          status: "waiting",
          finished: false,
          data: {
            resumeUrl: "https://n8n.example.com/webhook-waiting/exec_wait_1",
          },
        },
      },
    );

    let resumed = false;
    n8nTesting.setDepsForTest({
      fetchImpl: async (input, init) => {
        const url = requestUrl(input);
        if (url.includes("/api/v1/executions/exec_wait_1") && !url.includes("/stop")) {
          return new Response(
            JSON.stringify({
              id: "exec_wait_1",
              status: resumed ? "running" : "waiting",
              finished: false,
              data: {
                resumeUrl: "https://n8n.example.com/webhook-waiting/exec_wait_1",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "https://n8n.example.com/webhook-waiting/exec_wait_1") {
          expect(init?.method).toBe("POST");
          expect(init?.body).toBe(JSON.stringify({ input: "approved" }));
          resumed = true;
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected URL ${url} ${init?.method ?? "GET"}`);
      },
    });

    const resume = createInvokeParams("workflow.resume", {
      workspaceDir,
      executionId: localExecution.executionId,
      input: "approved",
    });
    await resume.invoke();

    const resumeCall = resume.respond.mock.calls[0] as RespondCall | undefined;
    expect(resumeCall?.[0]).toBe(true);
    const payload = resumeCall?.[1] as
      | { execution: { status: string }; localExecution?: { events?: Array<{ type: string }> } }
      | undefined;
    expect(payload?.execution.status).toBe("running");
    expect(
      payload?.localExecution?.events?.some((event) => event.type === "execution.resume_requested"),
    ).toBe(true);
  });
});

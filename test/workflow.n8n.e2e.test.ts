import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowizeTool } from "../src/agents/tools/workflowize-tool.js";
import {
  connectGatewayClient,
  disconnectGatewayClient,
  getFreeGatewayPort,
} from "../src/gateway/test-helpers.e2e.js";
import { startGatewayServer } from "../src/gateway/server.js";
import {
  clearGatewaySubagentRuntime,
  setGatewaySubagentRuntime,
} from "../src/plugins/runtime/index.js";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../src/config/config.js";
import { clearSessionStoreCacheForTest } from "../src/config/sessions/store.js";
import { sleep } from "../src/utils.js";

const E2E_TIMEOUT_MS = 60_000;
const POLL_MS = 100;
const VERBOSE_E2E = process.env.CRAWCLAW_E2E_VERBOSE === "1";

type FakeN8nWorkflow = {
  id: string;
  name: string;
  active?: boolean;
  nodes: Array<Record<string, unknown>>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

type FakeN8nExecution = {
  id: string;
  executionId: string;
  workflowId: string;
  status: string;
  finished: boolean;
  startedAt: string;
  stoppedAt?: string | null;
  data?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(`${JSON.stringify(payload)}\n`);
}

function deepReplaceExecutionId<T>(value: T, executionId: string): T {
  if (typeof value === "string") {
    return (value === "$execution.id" ? executionId : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepReplaceExecutionId(entry, executionId)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, deepReplaceExecutionId(entry, executionId)]),
    ) as T;
  }
  return value;
}

async function waitForCondition<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = E2E_TIMEOUT_MS,
): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await fn();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(lastValue, null, 2)}`);
}

async function requestWithTimeout<T>(
  client: Awaited<ReturnType<typeof connectGatewayClient>>,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<T> {
  return await Promise.race([
    client.request<T>(method, params),
    sleep(timeoutMs).then(() => {
      throw new Error(`gateway request timed out: ${method}`);
    }),
  ]);
}

function checkpoint(label: string) {
  if (VERBOSE_E2E) {
    process.stderr.write(`[workflow-e2e] ${label}\n`);
  }
}

async function startFakeN8nServer(params: {
  apiKey: string;
  gatewayToken: string;
}) {
  checkpoint("fake-n8n:create");
  const workflows = new Map<string, FakeN8nWorkflow>();
  const executions = new Map<string, FakeN8nExecution>();
  const callbackErrors: string[] = [];
  const resumePayloads = new Map<string, Record<string, unknown>>();
  let workflowSeq = 0;
  let executionSeq = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname.startsWith("/api/v1/")) {
      const apiKey = req.headers["x-n8n-api-key"];
      if (apiKey !== params.apiKey) {
        return sendJson(res, 401, { message: "invalid api key" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/v1/workflows") {
      const body = await readJsonBody(req);
      workflowSeq += 1;
      const id = `wf_remote_${workflowSeq}`;
      const workflow: FakeN8nWorkflow = {
        id,
        name: typeof body.name === "string" ? body.name : id,
        nodes: Array.isArray(body.nodes) ? (body.nodes as Array<Record<string, unknown>>) : [],
        connections: isRecord(body.connections) ? body.connections : {},
        ...(isRecord(body.settings) ? { settings: body.settings } : {}),
        ...(isRecord(body.staticData) ? { staticData: body.staticData } : {}),
        ...(isRecord(body.meta) ? { meta: body.meta } : {}),
      };
      workflows.set(id, workflow);
      return sendJson(res, 200, workflow);
    }

    const workflowMatch = url.pathname.match(/^\/api\/v1\/workflows\/([^/]+)$/);
    if (req.method === "GET" && workflowMatch) {
      const workflow = workflows.get(decodeURIComponent(workflowMatch[1] ?? ""));
      if (!workflow) {
        return sendJson(res, 404, { message: "workflow not found" });
      }
      return sendJson(res, 200, workflow);
    }

    const workflowActivateMatch = url.pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/activate$/);
    if (req.method === "POST" && workflowActivateMatch) {
      const workflowId = decodeURIComponent(workflowActivateMatch[1] ?? "");
      const workflow = workflows.get(workflowId);
      if (!workflow) {
        return sendJson(res, 404, { message: "workflow not found" });
      }
      workflow.active = true;
      return sendJson(res, 200, workflow);
    }

    const webhookTriggerMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
    if (req.method === "POST" && webhookTriggerMatch) {
      const webhookPath = decodeURIComponent(webhookTriggerMatch[1] ?? "");
      const triggerBody = await readJsonBody(req);
      const workflow = [...workflows.values()].find((candidate) => {
        const trigger = candidate.nodes.find((node) => node.type === "n8n-nodes-base.webhook");
        const parameters = isRecord(trigger?.parameters) ? trigger.parameters : null;
        return candidate.active === true && parameters?.path === webhookPath;
      });
      const workflowId = workflow?.id;
      if (!workflow || !workflowId) {
        return sendJson(res, 404, { message: "workflow trigger not found" });
      }

      executionSeq += 1;
      const executionId = `exec_remote_${executionSeq}`;
      const execution: FakeN8nExecution = {
        id: executionId,
        executionId,
        workflowId,
        status: "running",
        finished: false,
        startedAt: new Date().toISOString(),
        data: {},
      };
      executions.set(executionId, execution);

      queueMicrotask(async () => {
        try {
          const callbackNode = workflow.nodes.find((node) => {
            const meta = isRecord(node.meta) ? node.meta : null;
            return meta?.crawclawStepKind === "crawclaw_agent";
          });
          if (!callbackNode || !isRecord(callbackNode.meta)) {
            execution.status = "success";
            execution.finished = true;
            execution.stoppedAt = new Date().toISOString();
            return;
          }

          const callbackUrl =
            typeof callbackNode.meta.crawclawCallbackUrl === "string"
              ? callbackNode.meta.crawclawCallbackUrl
              : null;
          const rawContract = callbackNode.meta.crawclawAgentContract;
          if (!callbackUrl || !isRecord(rawContract)) {
            throw new Error("missing crawclaw callback contract on compiled workflow");
          }

          const contract = deepReplaceExecutionId(rawContract, executionId);
          if (
            contract.localExecutionId === "$json.crawclawExecutionId" &&
            typeof triggerBody.crawclawExecutionId === "string" &&
            triggerBody.crawclawExecutionId.trim()
          ) {
            contract.localExecutionId = triggerBody.crawclawExecutionId.trim();
          }
          const response = await fetch(callbackUrl, {
            method: "POST",
            headers: {
              authorization: `Bearer ${params.gatewayToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(contract),
          });
          const text = await response.text();
          if (!response.ok) {
            throw new Error(`callback failed (${response.status}): ${text}`);
          }

          execution.status = "waiting";
          execution.finished = false;
          execution.data = {
            resumeUrl: `${baseUrl}/webhook-waiting/${executionId}`,
            callbackResponse: text ? JSON.parse(text) : {},
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          callbackErrors.push(message);
          execution.status = "failed";
          execution.finished = true;
          execution.stoppedAt = new Date().toISOString();
          execution.data = {
            error: message,
          };
        }
      });

      return sendJson(res, 200, {
        message: "Workflow was started",
        executionId,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/executions") {
      const workflowId = url.searchParams.get("workflowId")?.trim() ?? "";
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "0", 10);
      const filtered = [...executions.values()]
        .filter((execution) => !workflowId || execution.workflowId === workflowId)
        .toSorted((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
      return sendJson(res, 200, {
        data: Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered,
      });
    }

    const executionMatch = url.pathname.match(/^\/api\/v1\/executions\/([^/]+)$/);
    if (req.method === "GET" && executionMatch) {
      const execution = executions.get(decodeURIComponent(executionMatch[1] ?? ""));
      if (!execution) {
        return sendJson(res, 404, { message: "execution not found" });
      }
      return sendJson(res, 200, execution);
    }

    const executionStopMatch = url.pathname.match(/^\/api\/v1\/executions\/([^/]+)\/stop$/);
    if (req.method === "POST" && executionStopMatch) {
      const execution = executions.get(decodeURIComponent(executionStopMatch[1] ?? ""));
      if (!execution) {
        return sendJson(res, 404, { message: "execution not found" });
      }
      execution.status = "cancelled";
      execution.finished = true;
      execution.stoppedAt = new Date().toISOString();
      return sendJson(res, 200, execution);
    }

    const waitWebhookMatch = url.pathname.match(/^\/webhook-waiting\/([^/]+)$/);
    if (req.method === "POST" && waitWebhookMatch) {
      const executionId = decodeURIComponent(waitWebhookMatch[1] ?? "");
      const execution = executions.get(executionId);
      if (!execution) {
        return sendJson(res, 404, { message: "execution not found" });
      }
      const body = await readJsonBody(req);
      resumePayloads.set(executionId, body);
      execution.status = "success";
      execution.finished = true;
      execution.stoppedAt = new Date().toISOString();
      execution.data = {
        resumedPayload: body,
      };
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { message: "not found" });
  });

  checkpoint("fake-n8n:listen:start");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  checkpoint("fake-n8n:listen:done");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake n8n server failed to bind");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    callbackErrors,
    resumePayloads,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("workflow n8n e2e", () => {
  const originalEnv = new Map<string, string | undefined>();
  const envKeys = [
    "CRAWCLAW_CONFIG_PATH",
    "CRAWCLAW_STATE_DIR",
    "CRAWCLAW_N8N_BASE_URL",
    "CRAWCLAW_N8N_API_KEY",
    "CRAWCLAW_N8N_CALLBACK_BASE_URL",
    "CRAWCLAW_N8N_CALLBACK_BEARER_ENV_VAR",
    "CRAWCLAW_GATEWAY_TOKEN",
  ] as const;

  let fakeN8n: Awaited<ReturnType<typeof startFakeN8nServer>> | undefined;
  let gateway:
    | {
        port: number;
        server: Awaited<ReturnType<typeof startGatewayServer>>;
        client: Awaited<ReturnType<typeof connectGatewayClient>>;
      }
    | undefined;

  beforeEach(() => {
    originalEnv.clear();
    for (const key of envKeys) {
      originalEnv.set(key, process.env[key]);
    }
  });

  afterAll(async () => {
    if (gateway) {
      await disconnectGatewayClient(gateway.client);
      await gateway.server.close({ reason: "workflow n8n e2e done" });
      gateway = undefined;
    }
    if (fakeN8n) {
      await fakeN8n.close();
      fakeN8n = undefined;
    }
    clearGatewaySubagentRuntime();
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    clearSessionStoreCacheForTest();
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it(
    "runs workflow deploy -> n8n callback -> wait -> resume end to end",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      checkpoint("test-start");
      const homeDir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-workflow-e2e-home-"));
      checkpoint("home-created");
      const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-workflow-e2e-workspace-"));
      checkpoint("workspace-created");
      const configPath = path.join(homeDir, "crawclaw.json");
      const gatewayToken = "gateway-workflow-e2e-token";
      const n8nApiKey = "n8n-e2e-api-key";

      fakeN8n = await startFakeN8nServer({
        apiKey: n8nApiKey,
        gatewayToken,
      });
      checkpoint(`fake-n8n-started:${fakeN8n.baseUrl}`);

      const cfg = {};
      await writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");

      process.env.CRAWCLAW_N8N_BASE_URL = fakeN8n.baseUrl;
      process.env.CRAWCLAW_N8N_API_KEY = n8nApiKey;
      process.env.CRAWCLAW_N8N_CALLBACK_BEARER_ENV_VAR = "CRAWCLAW_GATEWAY_TOKEN";
      process.env.CRAWCLAW_GATEWAY_TOKEN = gatewayToken;
      process.env.CRAWCLAW_CONFIG_PATH = configPath;
      clearRuntimeConfigSnapshot();
      clearConfigCache();
      clearSessionStoreCacheForTest();

      const port = await getFreeGatewayPort();
      gateway = {
        port,
        server: await startGatewayServer(port, {
          bind: "loopback",
          auth: { mode: "token", token: gatewayToken },
          controlUiEnabled: false,
        }),
        client: await connectGatewayClient({
          url: `ws://127.0.0.1:${port}`,
          token: gatewayToken,
          clientDisplayName: "workflow-e2e",
        }),
      };
      checkpoint(`gateway-started:${gateway.port}`);

      process.env.CRAWCLAW_N8N_CALLBACK_BASE_URL = `http://127.0.0.1:${gateway.port}`;

      setGatewaySubagentRuntime({
        run: async () => ({ runId: "workflow-step-run-1" }),
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
                    summary: "Draft completed from e2e callback",
                    output: { title: "AI workflow" },
                  }),
                },
              ],
            },
          ],
        }),
        getSession: async () => ({ messages: [] }),
        deleteSession: async () => {},
      });

      const workflowize = createWorkflowizeTool({
        workspaceDir,
        sessionKey: "agent:main:main",
        sessionId: "main",
      });
      const created = (await workflowize.execute("workflowize-e2e", {
        name: "publish-redbook-e2e",
        goal: "Generate and review a redbook note",
        description: "Workflow e2e smoke",
        stepSpecs: [
          {
            title: "Draft content",
            kind: "crawclaw_agent",
            goal: "Draft the redbook note",
          },
          {
            title: "Human review",
            kind: "human_wait",
            prompt: "Approve publish",
            waitKind: "input",
          },
        ],
        tags: ["e2e", "workflow"],
        inputs: ["topic"],
        outputs: ["title"],
        requiresApproval: true,
      })) as { details: { workflowId: string } };
      checkpoint(`workflowized:${created.details.workflowId}`);

      const deployed = await requestWithTimeout<{
        workflow: { n8nWorkflowId: string; deploymentState: string };
        compiled: { nodes: Array<{ type?: string }> };
      }>(gateway.client, "workflow.deploy", {
        workflow: created.details.workflowId,
        workspaceDir,
      });
      checkpoint(`deployed:${deployed.workflow.n8nWorkflowId}`);
      expect(deployed.workflow.deploymentState).toBe("deployed");
      expect(deployed.workflow.n8nWorkflowId).toBeTruthy();
      expect(deployed.compiled.nodes.some((node) => node.type === "n8n-nodes-base.httpRequest")).toBe(
        true,
      );

      const run = await requestWithTimeout<{
        execution: {
          executionId: string;
          n8nExecutionId: string;
          status: string;
          source: string;
        };
      }>(gateway.client, "workflow.run", {
        workflow: created.details.workflowId,
        workspaceDir,
      });
      checkpoint(`run-started:${run.execution.executionId}:${run.execution.n8nExecutionId}`);
      expect(run.execution.status).toBe("running");
      expect(run.execution.source).toBe("local+n8n");

      const waiting = await waitForCondition(
        async () =>
          await requestWithTimeout<{
            execution: {
              status: string;
              currentExecutor?: string;
              waiting?: { resumeUrl?: string; canResume: boolean };
              steps?: Array<{ stepId: string; status: string }>;
            };
          }>(gateway!.client, "workflow.status", {
            executionId: run.execution.executionId,
            workspaceDir,
          }),
        (payload) => payload.execution.status === "waiting_external",
        "workflow to enter waiting state",
        15_000,
      );
      checkpoint(`waiting:${waiting.execution.status}`);
      checkpoint(`waiting-payload:${JSON.stringify(waiting.execution)}`);

      expect(fakeN8n.callbackErrors).toEqual([]);
      expect(waiting.execution.currentExecutor).toBe("n8n_wait");
      expect(waiting.execution.waiting?.canResume).toBe(true);
      expect(waiting.execution.waiting?.resumeUrl).toContain("/webhook-waiting/");
      expect(waiting.execution.steps?.[0]?.stepId).toBe("step_1");
      expect(waiting.execution.steps?.[0]?.status).toBe("succeeded");
      expect(waiting.execution.steps?.[1]?.stepId).toBe("step_2");
      expect(waiting.execution.steps?.[1]?.status).toBe("waiting");

      const resumed = await requestWithTimeout<{
        resumeAccepted: boolean;
        execution: { status: string };
      }>(gateway.client, "workflow.resume", {
        executionId: run.execution.executionId,
        workspaceDir,
        input: JSON.stringify({ approved: true }),
      });
      checkpoint(`resume-requested:${String(resumed.resumeAccepted)}`);
      expect(resumed.resumeAccepted).toBe(true);

      const succeeded = await waitForCondition(
        async () =>
          await requestWithTimeout<{
            execution: {
              status: string;
              source: string;
              steps?: Array<{ stepId: string; status: string }>;
            };
          }>(gateway!.client, "workflow.status", {
            executionId: run.execution.executionId,
            workspaceDir,
          }),
        (payload) => payload.execution.status === "succeeded",
        "workflow to succeed after resume",
        15_000,
      );
      checkpoint(`succeeded:${succeeded.execution.status}`);

      expect(succeeded.execution.source).toBe("local+n8n");
      expect(succeeded.execution.steps?.every((step) => step.status === "succeeded")).toBe(true);
      expect(fakeN8n.resumePayloads.get(run.execution.n8nExecutionId)).toEqual({ approved: true });
    },
  );
});

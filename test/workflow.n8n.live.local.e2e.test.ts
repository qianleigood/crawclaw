import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createWorkflowizeTool } from "../src/agents/tools/workflowize-tool.js";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../src/config/config.js";
import { clearSessionStoreCacheForTest } from "../src/config/sessions/store.js";
import { startGatewayServer } from "../src/gateway/server.js";
import {
  connectGatewayClient,
  disconnectGatewayClient,
  getFreeGatewayPort,
} from "../src/gateway/test-helpers.e2e.js";
import {
  clearGatewaySubagentRuntime,
  setGatewaySubagentRuntime,
} from "../src/plugins/runtime/index.js";
import { sleep } from "../src/utils.js";

const LIVE_E2E_TIMEOUT_MS = 120_000;
const POLL_MS = 500;
const LIVE_N8N_BASE_URL = process.env.CRAWCLAW_N8N_BASE_URL?.trim();
const LIVE_N8N_API_KEY = process.env.CRAWCLAW_N8N_API_KEY?.trim();
const LIVE_GATEWAY_TOKEN = process.env.CRAWCLAW_GATEWAY_TOKEN?.trim();
const LIVE_CALLBACK_HOST = process.env.CRAWCLAW_N8N_CALLBACK_HOST?.trim() || "host.docker.internal";

function checkpoint(label: string, extra?: unknown) {
  const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  process.stderr.write(`[workflow-live-e2e] ${label}${suffix}\n`);
}

async function waitForCondition<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = LIVE_E2E_TIMEOUT_MS,
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
  timeoutMs = 20_000,
): Promise<T> {
  return await Promise.race([
    client.request<T>(method, params),
    sleep(timeoutMs).then(() => {
      throw new Error(`gateway request timed out: ${method}`);
    }),
  ]);
}

async function bestEffortDeleteWorkflow(
  baseUrl: string,
  apiKey: string,
  workflowId: string | null,
) {
  if (!workflowId) {
    return;
  }
  try {
    await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/v1/workflows/${encodeURIComponent(workflowId)}`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          "X-N8N-API-KEY": apiKey,
        },
      },
    );
  } catch {
    // Ignore cleanup failures in local live e2e.
  }
}

async function createCallbackCredential(params: {
  baseUrl: string;
  apiKey: string;
  gatewayToken: string;
}): Promise<{ id: string; name: string }> {
  const credentialName = `CrawClaw Callback Auth ${Date.now()}`;
  const response = await fetch(`${params.baseUrl.replace(/\/+$/, "")}/api/v1/credentials`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": params.apiKey,
    },
    body: JSON.stringify({
      name: credentialName,
      type: "httpHeaderAuth",
      data: {
        name: "Authorization",
        value: `Bearer ${params.gatewayToken}`,
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `failed to create n8n callback credential (${response.status}): ${text || response.statusText}`,
    );
  }
  const payload = (await response.json()) as { id?: string; name?: string };
  if (!payload.id || !payload.name) {
    throw new Error(`n8n callback credential response missing id/name: ${JSON.stringify(payload)}`);
  }
  return {
    id: payload.id,
    name: payload.name,
  };
}

async function bestEffortDeleteCredential(
  baseUrl: string,
  apiKey: string,
  credentialId: string | null,
) {
  if (!credentialId) {
    return;
  }
  try {
    await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/v1/credentials/${encodeURIComponent(credentialId)}`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          "X-N8N-API-KEY": apiKey,
        },
      },
    );
  } catch {
    // Ignore cleanup failures in local live e2e.
  }
}

async function fetchJsonWithApiKey<T>(baseUrl: string, apiKey: string, url: string): Promise<T> {
  const response = await fetch(
    url.startsWith("http") ? url : `${baseUrl.replace(/\/+$/, "")}${url}`,
    {
      headers: {
        Accept: "application/json",
        "X-N8N-API-KEY": apiKey,
      },
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`request failed (${response.status}): ${text || response.statusText}`);
  }
  return (await response.json()) as T;
}

describe.runIf(Boolean(LIVE_N8N_BASE_URL && LIVE_N8N_API_KEY && LIVE_GATEWAY_TOKEN))(
  "workflow n8n live local e2e",
  () => {
    let gateway:
      | {
          port: number;
          server: Awaited<ReturnType<typeof startGatewayServer>>;
          client: Awaited<ReturnType<typeof connectGatewayClient>>;
        }
      | undefined;
    const deployedWorkflowIds: string[] = [];
    const callbackCredentialIds: string[] = [];
    let originalEnv = new Map<string, string | undefined>();
    const envKeys = [
      "CRAWCLAW_CONFIG_PATH",
      "CRAWCLAW_STATE_DIR",
      "CRAWCLAW_N8N_BASE_URL",
      "CRAWCLAW_N8N_API_KEY",
      "CRAWCLAW_N8N_CALLBACK_BASE_URL",
      "CRAWCLAW_N8N_CALLBACK_CREDENTIAL_ID",
      "CRAWCLAW_N8N_CALLBACK_CREDENTIAL_NAME",
      "CRAWCLAW_N8N_CALLBACK_BEARER_ENV_VAR",
      "CRAWCLAW_N8N_CALLBACK_BEARER_TOKEN",
      "CRAWCLAW_GATEWAY_TOKEN",
    ] as const;

    afterAll(async () => {
      clearGatewaySubagentRuntime();
      if (gateway) {
        await disconnectGatewayClient(gateway.client);
        await gateway.server.close({ reason: "workflow live e2e done" });
        gateway = undefined;
      }
      if (LIVE_N8N_BASE_URL && LIVE_N8N_API_KEY) {
        for (const workflowId of deployedWorkflowIds.splice(0)) {
          await bestEffortDeleteWorkflow(LIVE_N8N_BASE_URL, LIVE_N8N_API_KEY, workflowId);
        }
        for (const credentialId of callbackCredentialIds.splice(0)) {
          await bestEffortDeleteCredential(LIVE_N8N_BASE_URL, LIVE_N8N_API_KEY, credentialId);
        }
      }
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
      "runs workflow deploy -> real local n8n -> callback -> wait -> resume end to end",
      { timeout: LIVE_E2E_TIMEOUT_MS },
      async () => {
        originalEnv = new Map<string, string | undefined>();
        for (const key of envKeys) {
          originalEnv.set(key, process.env[key]);
        }

        const homeDir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-workflow-live-home-"));
        const workspaceDir = await mkdtemp(
          path.join(os.tmpdir(), "crawclaw-workflow-live-workspace-"),
        );
        const configPath = path.join(homeDir, "crawclaw.json");
        await writeFile(configPath, "{}\n", "utf8");
        checkpoint("paths", { homeDir, workspaceDir });

        const port = await getFreeGatewayPort();
        const callbackBaseUrl = `http://${LIVE_CALLBACK_HOST}:${port}`;
        const callbackCredential = await createCallbackCredential({
          baseUrl: LIVE_N8N_BASE_URL!,
          apiKey: LIVE_N8N_API_KEY!,
          gatewayToken: LIVE_GATEWAY_TOKEN!,
        });
        callbackCredentialIds.push(callbackCredential.id);
        checkpoint("callback-credential-created", callbackCredential);

        process.env.CRAWCLAW_CONFIG_PATH = configPath;
        process.env.CRAWCLAW_N8N_BASE_URL = LIVE_N8N_BASE_URL;
        process.env.CRAWCLAW_N8N_API_KEY = LIVE_N8N_API_KEY;
        process.env.CRAWCLAW_N8N_CALLBACK_BASE_URL = callbackBaseUrl;
        process.env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_ID = callbackCredential.id;
        process.env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_NAME = callbackCredential.name;
        process.env.CRAWCLAW_GATEWAY_TOKEN = LIVE_GATEWAY_TOKEN;
        clearRuntimeConfigSnapshot();
        clearConfigCache();
        clearSessionStoreCacheForTest();

        gateway = {
          port,
          server: await startGatewayServer(port, {
            bind: "lan",
            host: "0.0.0.0",
            auth: { mode: "token", token: LIVE_GATEWAY_TOKEN! },
            controlUiEnabled: false,
          }),
          client: await connectGatewayClient({
            url: `ws://127.0.0.1:${port}`,
            token: LIVE_GATEWAY_TOKEN!,
            clientDisplayName: "workflow-live-e2e",
          }),
        };
        checkpoint("gateway-started", { port, callbackBaseUrl });

        setGatewaySubagentRuntime({
          run: async () => ({ runId: "workflow-step-run-live-1" }),
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
                      summary: "Draft completed from live callback",
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
        const created = (await workflowize.execute("workflowize-live-e2e", {
          name: "publish-redbook-live-e2e",
          goal: "Generate and review a redbook note",
          description: "Workflow live e2e smoke against local n8n",
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
          tags: ["e2e", "workflow", "live"],
          inputs: ["topic"],
          outputs: ["title"],
          requiresApproval: true,
        })) as { details: { workflowId: string } };
        checkpoint("workflowized", created.details);

        const deployed = await requestWithTimeout<{
          workflow: { n8nWorkflowId: string; deploymentState: string };
          compiled: { nodes: Array<{ type?: string }> };
        }>(gateway.client, "workflow.deploy", {
          workflow: created.details.workflowId,
          workspaceDir,
        });
        deployedWorkflowIds.push(deployed.workflow.n8nWorkflowId);
        checkpoint("deployed", deployed.workflow);
        expect(deployed.workflow.deploymentState).toBe("deployed");
        expect(deployed.workflow.n8nWorkflowId).toBeTruthy();
        expect(
          deployed.compiled.nodes.some((node) => node.type === "n8n-nodes-base.httpRequest"),
        ).toBe(true);

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
        checkpoint("run", run.execution);
        if (run.execution.status !== "running") {
          const [recentExecutions, remoteWorkflow] = await Promise.all([
            fetchJsonWithApiKey<{ data?: unknown }>(
              LIVE_N8N_BASE_URL!,
              LIVE_N8N_API_KEY!,
              `/api/v1/executions?workflowId=${encodeURIComponent(deployedWorkflowId)}&limit=5&includeData=true`,
            ).catch((error) => ({ error: String(error) })),
            fetchJsonWithApiKey<Record<string, unknown>>(
              LIVE_N8N_BASE_URL!,
              LIVE_N8N_API_KEY!,
              `/api/v1/workflows/${encodeURIComponent(deployedWorkflowId)}`,
            ).catch((error) => ({ error: String(error) })),
          ]);
          checkpoint("run-debug", {
            recentExecutions,
            remoteWorkflow,
          });
        }
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
          60_000,
        );
        checkpoint("waiting", waiting.execution);
        expect(waiting.execution.currentExecutor).toBe("n8n_wait");
        expect(waiting.execution.waiting?.canResume).toBe(true);
        expect(waiting.execution.waiting?.resumeUrl).toBeTruthy();

        const resumed = await requestWithTimeout<{
          resumeAccepted: boolean;
          execution: { status: string };
        }>(gateway.client, "workflow.resume", {
          executionId: run.execution.executionId,
          workspaceDir,
          input: JSON.stringify({ approved: true }),
        });
        checkpoint("resume", resumed);
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
          60_000,
        );
        checkpoint("succeeded", succeeded.execution);

        expect(succeeded.execution.source).toBe("local+n8n");
        expect(succeeded.execution.steps?.every((step) => step.status === "succeeded")).toBe(true);
      },
    );

    it(
      "runs branch_v2 workflow against real local n8n and marks the inactive branch as skipped",
      { timeout: LIVE_E2E_TIMEOUT_MS },
      async () => {
        originalEnv = new Map<string, string | undefined>();
        for (const key of envKeys) {
          originalEnv.set(key, process.env[key]);
        }

        const homeDir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-workflow-branch-home-"));
        const workspaceDir = await mkdtemp(
          path.join(os.tmpdir(), "crawclaw-workflow-branch-workspace-"),
        );
        const configPath = path.join(homeDir, "crawclaw.json");
        await writeFile(configPath, "{}\n", "utf8");
        checkpoint("branch-paths", { homeDir, workspaceDir });

        const port = await getFreeGatewayPort();
        const callbackBaseUrl = `http://${LIVE_CALLBACK_HOST}:${port}`;
        const callbackCredential = await createCallbackCredential({
          baseUrl: LIVE_N8N_BASE_URL!,
          apiKey: LIVE_N8N_API_KEY!,
          gatewayToken: LIVE_GATEWAY_TOKEN!,
        });
        callbackCredentialIds.push(callbackCredential.id);
        checkpoint("branch-callback-credential-created", callbackCredential);

        process.env.CRAWCLAW_CONFIG_PATH = configPath;
        process.env.CRAWCLAW_N8N_BASE_URL = LIVE_N8N_BASE_URL;
        process.env.CRAWCLAW_N8N_API_KEY = LIVE_N8N_API_KEY;
        process.env.CRAWCLAW_N8N_CALLBACK_BASE_URL = callbackBaseUrl;
        process.env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_ID = callbackCredential.id;
        process.env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_NAME = callbackCredential.name;
        process.env.CRAWCLAW_GATEWAY_TOKEN = LIVE_GATEWAY_TOKEN;
        clearRuntimeConfigSnapshot();
        clearConfigCache();
        clearSessionStoreCacheForTest();

        gateway = {
          port,
          server: await startGatewayServer(port, {
            bind: "lan",
            host: "0.0.0.0",
            auth: { mode: "token", token: LIVE_GATEWAY_TOKEN! },
            controlUiEnabled: false,
          }),
          client: await connectGatewayClient({
            url: `ws://127.0.0.1:${port}`,
            token: LIVE_GATEWAY_TOKEN!,
            clientDisplayName: "workflow-branch-live-e2e",
          }),
        };
        checkpoint("branch-gateway-started", { port, callbackBaseUrl });

        setGatewaySubagentRuntime({
          run: async () => ({ runId: "workflow-step-run-branch-live-1" }),
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
                      summary: "Branch callback completed from live callback",
                      output: { approved: true },
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
        const created = (await workflowize.execute("workflowize-branch-live-e2e", {
          name: "publish-redbook-branch-live-e2e",
          goal: "Generate and route a publish review branch",
          description: "Branch-aware workflow live e2e smoke against local n8n",
          topology: "branch_v2",
          stepSpecs: [
            {
              title: "Prepare input",
              kind: "native",
              goal: "Prepare payload for branching",
            },
            {
              title: "Approval path",
              kind: "crawclaw_agent",
              goal: "Handle the selected approval branch",
              path: "approval",
              branchGroup: "publish_gate",
              activationMode: "conditional",
              activationWhen: "{{ $workflowInput.requiresApproval === true }}",
              activationFromStepIds: ["step_1"],
              terminalOnSuccess: true,
            },
            {
              title: "Fast path",
              kind: "native",
              goal: "Skip approval and finish immediately",
              path: "fast",
              branchGroup: "publish_gate",
              activationMode: "conditional",
              activationWhen: "{{ $workflowInput.requiresApproval !== true }}",
              activationFromStepIds: ["step_1"],
              terminalOnSuccess: true,
            },
          ],
          tags: ["e2e", "workflow", "live", "branch"],
          outputs: ["approved"],
          requiresApproval: true,
        })) as { details: { workflowId: string } };
        checkpoint("branch-workflowized", created.details);

        const deployed = await requestWithTimeout<{
          workflow: { n8nWorkflowId: string; deploymentState: string };
          compiled: { nodes: Array<{ type?: string; meta?: { crawclawHelperKind?: string } }> };
        }>(gateway.client, "workflow.deploy", {
          workflow: created.details.workflowId,
          workspaceDir,
        });
        deployedWorkflowIds.push(deployed.workflow.n8nWorkflowId);
        checkpoint("branch-deployed", deployed.workflow);
        expect(deployed.workflow.deploymentState).toBe("deployed");
        expect(
          deployed.compiled.nodes.some(
            (node) => node.meta?.crawclawHelperKind === "conditional_gate",
          ),
        ).toBe(true);

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
          inputs: {
            requiresApproval: true,
          },
        });
        checkpoint("branch-run", run.execution);

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
          "branch workflow to succeed after resume",
          60_000,
        );
        checkpoint("branch-succeeded", succeeded.execution);

        expect(succeeded.execution.source).toBe("local+n8n");
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_1")?.status).toBe(
          "succeeded",
        );
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_2")?.status).toBe(
          "succeeded",
        );
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_3")?.status).toBe(
          "skipped",
        );
        expect(
          succeeded.execution.steps?.find((step) => step.stepId === "step_3")?.skippedReason,
        ).toContain("Branch group");
      },
    );

    it(
      "runs branch_v2 fan_out workflow against real local n8n and keeps parallel branches active",
      { timeout: LIVE_E2E_TIMEOUT_MS },
      async () => {
        originalEnv = new Map<string, string | undefined>();
        for (const key of envKeys) {
          originalEnv.set(key, process.env[key]);
        }

        const homeDir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-workflow-fan-out-home-"));
        const workspaceDir = await mkdtemp(
          path.join(os.tmpdir(), "crawclaw-workflow-fan-out-workspace-"),
        );
        const configPath = path.join(homeDir, "crawclaw.json");
        await writeFile(configPath, "{}\n", "utf8");
        checkpoint("fan-out-paths", { homeDir, workspaceDir });

        const port = await getFreeGatewayPort();
        const callbackBaseUrl = `http://${LIVE_CALLBACK_HOST}:${port}`;
        const callbackCredential = await createCallbackCredential({
          baseUrl: LIVE_N8N_BASE_URL!,
          apiKey: LIVE_N8N_API_KEY!,
          gatewayToken: LIVE_GATEWAY_TOKEN!,
        });
        callbackCredentialIds.push(callbackCredential.id);
        checkpoint("fan-out-callback-credential-created", callbackCredential);

        process.env.CRAWCLAW_CONFIG_PATH = configPath;
        process.env.CRAWCLAW_N8N_BASE_URL = LIVE_N8N_BASE_URL;
        process.env.CRAWCLAW_N8N_API_KEY = LIVE_N8N_API_KEY;
        process.env.CRAWCLAW_N8N_CALLBACK_BASE_URL = callbackBaseUrl;
        process.env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_ID = callbackCredential.id;
        process.env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_NAME = callbackCredential.name;
        process.env.CRAWCLAW_GATEWAY_TOKEN = LIVE_GATEWAY_TOKEN;
        clearRuntimeConfigSnapshot();
        clearConfigCache();
        clearSessionStoreCacheForTest();

        gateway = {
          port,
          server: await startGatewayServer(port, {
            bind: "lan",
            host: "0.0.0.0",
            auth: { mode: "token", token: LIVE_GATEWAY_TOKEN! },
            controlUiEnabled: false,
          }),
          client: await connectGatewayClient({
            url: `ws://127.0.0.1:${port}`,
            token: LIVE_GATEWAY_TOKEN!,
            clientDisplayName: "workflow-fan-out-live-e2e",
          }),
        };
        checkpoint("fan-out-gateway-started", { port, callbackBaseUrl });

        setGatewaySubagentRuntime({
          run: async () => ({ runId: "workflow-step-run-fan-out-live-1" }),
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
                      summary: "Fan out callback completed from live callback",
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
        const created = (await workflowize.execute("workflowize-fan-out-live-e2e", {
          name: "publish-redbook-fan-out-live-e2e",
          goal: "Generate parallel assets before finalizing",
          description: "Fan out workflow live e2e smoke against local n8n",
          topology: "branch_v2",
          stepSpecs: [
            {
              title: "Prepare input",
              kind: "native",
              goal: "Prepare payload for parallel branches",
            },
            {
              title: "Draft title",
              kind: "crawclaw_agent",
              goal: "Create the title asset",
              path: "title",
              branchGroup: "asset_bundle",
              activationMode: "fan_out",
              activationFromStepIds: ["step_1"],
            },
            {
              title: "Draft cover",
              kind: "native",
              goal: "Create the cover asset",
              path: "cover",
              branchGroup: "asset_bundle",
              activationMode: "fan_out",
              activationFromStepIds: ["step_1"],
            },
            {
              title: "Finalize package",
              kind: "native",
              goal: "Join generated assets",
              activationMode: "fan_in",
              activationFromStepIds: ["step_2", "step_3"],
              terminalOnSuccess: true,
            },
          ],
          tags: ["e2e", "workflow", "live", "fan_out"],
          outputs: ["title"],
        })) as { details: { workflowId: string } };
        checkpoint("fan-out-workflowized", created.details);

        const deployed = await requestWithTimeout<{
          workflow: { n8nWorkflowId: string; deploymentState: string };
        }>(gateway.client, "workflow.deploy", {
          workflow: created.details.workflowId,
          workspaceDir,
        });
        deployedWorkflowIds.push(deployed.workflow.n8nWorkflowId);
        checkpoint("fan-out-deployed", deployed.workflow);
        expect(deployed.workflow.deploymentState).toBe("deployed");

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
          inputs: {},
        });
        checkpoint("fan-out-run", run.execution);

        const succeeded = await waitForCondition(
          async () =>
            await requestWithTimeout<{
              execution: {
                status: string;
                source: string;
                steps?: Array<{ stepId: string; status: string; skippedReason?: string }>;
              };
            }>(gateway!.client, "workflow.status", {
              executionId: run.execution.executionId,
              workspaceDir,
            }),
          (payload) => payload.execution.status === "succeeded",
          "fan_out workflow to succeed",
          60_000,
        );
        checkpoint("fan-out-succeeded", succeeded.execution);

        expect(succeeded.execution.source).toBe("local+n8n");
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_1")?.status).toBe(
          "succeeded",
        );
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_2")?.status).toBe(
          "succeeded",
        );
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_3")?.status).toBe(
          "succeeded",
        );
        expect(
          succeeded.execution.steps?.find((step) => step.stepId === "step_3")?.skippedReason,
        ).toBeUndefined();
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_4")?.status).toBe(
          "succeeded",
        );
      },
    );

    it(
      "runs branch_v2 fan_out workflow with continue policy and preserves failed parallel branches",
      { timeout: LIVE_E2E_TIMEOUT_MS },
      async () => {
        originalEnv = new Map<string, string | undefined>();
        for (const key of envKeys) {
          originalEnv.set(key, process.env[key]);
        }

        const homeDir = await mkdtemp(
          path.join(os.tmpdir(), "crawclaw-workflow-fan-out-continue-home-"),
        );
        const workspaceDir = await mkdtemp(
          path.join(os.tmpdir(), "crawclaw-workflow-fan-out-continue-workspace-"),
        );
        const configPath = path.join(homeDir, "crawclaw.json");
        await writeFile(configPath, "{}\n", "utf8");
        checkpoint("fan-out-continue-paths", { homeDir, workspaceDir });

        const port = await getFreeGatewayPort();
        const callbackBaseUrl = `http://${LIVE_CALLBACK_HOST}:${port}`;
        const callbackCredential = await createCallbackCredential({
          baseUrl: LIVE_N8N_BASE_URL!,
          apiKey: LIVE_N8N_API_KEY!,
          gatewayToken: LIVE_GATEWAY_TOKEN!,
        });
        callbackCredentialIds.push(callbackCredential.id);
        checkpoint("fan-out-continue-callback-credential-created", callbackCredential);

        process.env.CRAWCLAW_CONFIG_PATH = configPath;
        process.env.CRAWCLAW_N8N_BASE_URL = LIVE_N8N_BASE_URL;
        process.env.CRAWCLAW_N8N_API_KEY = LIVE_N8N_API_KEY;
        process.env.CRAWCLAW_N8N_CALLBACK_BASE_URL = callbackBaseUrl;
        process.env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_ID = callbackCredential.id;
        process.env.CRAWCLAW_N8N_CALLBACK_CREDENTIAL_NAME = callbackCredential.name;
        process.env.CRAWCLAW_GATEWAY_TOKEN = LIVE_GATEWAY_TOKEN;
        clearRuntimeConfigSnapshot();
        clearConfigCache();
        clearSessionStoreCacheForTest();

        gateway = {
          port,
          server: await startGatewayServer(port, {
            bind: "lan",
            host: "0.0.0.0",
            auth: { mode: "token", token: LIVE_GATEWAY_TOKEN! },
            controlUiEnabled: false,
          }),
          client: await connectGatewayClient({
            url: `ws://127.0.0.1:${port}`,
            token: LIVE_GATEWAY_TOKEN!,
            clientDisplayName: "workflow-fan-out-continue-live-e2e",
          }),
        };
        checkpoint("fan-out-continue-gateway-started", { port, callbackBaseUrl });

        setGatewaySubagentRuntime({
          run: async () => ({ runId: "workflow-step-run-fan-out-continue-live-1" }),
          waitForRun: async () => ({ status: "ok" as const }),
          getSessionMessages: async ({ sessionKey }: { sessionKey?: string } = {}) => ({
            messages: [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      sessionKey?.includes("compensation")
                        ? {
                            status: "succeeded",
                            summary: "Compensation branch completed",
                          }
                        : {
                            status: "failed",
                            summary: "Parallel title branch failed but workflow should continue",
                            error: "title generation failed",
                          },
                    ),
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
        const created = (await workflowize.execute("workflowize-fan-out-continue-live-e2e", {
          name: "publish-redbook-fan-out-continue-live-e2e",
          goal: "Generate parallel assets with best-effort continuation",
          description: "Fan out continue workflow live e2e smoke against local n8n",
          topology: "branch_v2",
          stepSpecs: [
            {
              title: "Prepare input",
              kind: "native",
              goal: "Prepare payload for parallel branches",
            },
            {
              title: "Draft title",
              kind: "crawclaw_agent",
              goal: "Create the title asset",
              path: "title",
              branchGroup: "asset_bundle",
              activationMode: "fan_out",
              activationFromStepIds: ["step_1"],
              parallelFailurePolicy: "continue",
              parallelJoinPolicy: "best_effort",
              maxActiveBranches: 2,
              compensationMode: "crawclaw_agent",
              compensationGoal: "Compensate failed title generation",
            },
            {
              title: "Draft cover",
              kind: "native",
              goal: "Create the cover asset",
              path: "cover",
              branchGroup: "asset_bundle",
              activationMode: "fan_out",
              activationFromStepIds: ["step_1"],
              parallelFailurePolicy: "continue",
              parallelJoinPolicy: "best_effort",
              maxActiveBranches: 2,
            },
            {
              title: "Finalize package",
              kind: "native",
              goal: "Join generated assets",
              activationMode: "fan_in",
              activationFromStepIds: ["step_2", "step_3"],
              parallelJoinPolicy: "best_effort",
              terminalOnSuccess: true,
            },
          ],
          tags: ["e2e", "workflow", "live", "fan_out", "continue"],
          outputs: ["title"],
        })) as { details: { workflowId: string } };
        checkpoint("fan-out-continue-workflowized", created.details);

        const deployed = await requestWithTimeout<{
          workflow: { n8nWorkflowId: string; deploymentState: string };
        }>(gateway.client, "workflow.deploy", {
          workflow: created.details.workflowId,
          workspaceDir,
        });
        deployedWorkflowIds.push(deployed.workflow.n8nWorkflowId);
        checkpoint("fan-out-continue-deployed", deployed.workflow);
        expect(deployed.workflow.deploymentState).toBe("deployed");

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
          inputs: {},
        });
        checkpoint("fan-out-continue-run", run.execution);

        const succeeded = await waitForCondition(
          async () =>
            await requestWithTimeout<{
              execution: {
                status: string;
                source: string;
                steps?: Array<{
                  stepId: string;
                  status: string;
                  error?: string;
                  compensationStatus?: string;
                  compensationSummary?: string;
                  skippedReason?: string;
                }>;
              };
            }>(gateway!.client, "workflow.status", {
              executionId: run.execution.executionId,
              workspaceDir,
            }),
          (payload) => payload.execution.status === "succeeded",
          "fan_out continue workflow to succeed",
          60_000,
        );
        checkpoint("fan-out-continue-succeeded", succeeded.execution);

        expect(succeeded.execution.source).toBe("local+n8n");
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_1")?.status).toBe(
          "succeeded",
        );
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_2")).toMatchObject({
          status: "failed",
          error: "title generation failed",
          compensationStatus: "succeeded",
          compensationSummary: "Compensation branch completed",
        });
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_3")?.status).toBe(
          "succeeded",
        );
        expect(succeeded.execution.steps?.find((step) => step.stepId === "step_4")?.status).toBe(
          "succeeded",
        );
      },
    );
  },
);

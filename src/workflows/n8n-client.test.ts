import { describe, expect, it } from "vitest";
import {
  __testing,
  createN8nClient,
  resolveN8nCallbackConfig,
  resolveN8nConfig,
} from "./n8n-client.js";

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("n8n client", () => {
  it("resolves config from explicit workflow config and env", () => {
    expect(
      resolveN8nConfig(
        {
          workflow: {
            n8n: {
              baseUrl: "https://n8n.example.com/",
              apiKey: "token-1",
              projectId: "proj-1",
            },
          },
        },
        {},
      ),
    ).toEqual({
      baseUrl: "https://n8n.example.com",
      apiKey: "token-1",
      projectId: "proj-1",
    });

    expect(
      resolveN8nConfig(undefined, {
        CRAWCLAW_N8N_BASE_URL: "https://n8n.example.com",
        CRAWCLAW_N8N_API_KEY: "token-2",
      }),
    ).toEqual({
      baseUrl: "https://n8n.example.com",
      apiKey: "token-2",
    });

    expect(
      resolveN8nCallbackConfig(
        {
          workflow: {
            n8n: {
              callbackBaseUrl: "https://crawclaw.example.com/",
              callbackCredentialId: "cred-123",
              callbackCredentialName: "CrawClaw Callback Auth",
              callbackBearerEnvVar: "CRAWCLAW_GATEWAY_WORKFLOW_TOKEN",
            },
          },
        },
        {},
      ),
    ).toEqual({
      callbackBaseUrl: "https://crawclaw.example.com",
      callbackBearerEnvVar: "CRAWCLAW_GATEWAY_WORKFLOW_TOKEN",
      callbackCredentialId: "cred-123",
      callbackCredentialName: "CrawClaw Callback Auth",
    });

    expect(
      resolveN8nCallbackConfig(undefined, {
        CRAWCLAW_N8N_CALLBACK_BASE_URL: "https://crawclaw.example.com",
        CRAWCLAW_N8N_CALLBACK_CREDENTIAL_ID: "cred-456",
        CRAWCLAW_N8N_CALLBACK_CREDENTIAL_NAME: "Callback Auth Env",
      }),
    ).toEqual({
      callbackBaseUrl: "https://crawclaw.example.com",
      callbackBearerEnvVar: "CRAWCLAW_GATEWAY_TOKEN",
      callbackCredentialId: "cred-456",
      callbackCredentialName: "Callback Auth Env",
    });

    expect(
      resolveN8nCallbackConfig(undefined, {
        CRAWCLAW_N8N_CALLBACK_BASE_URL: "https://crawclaw.example.com",
        CRAWCLAW_N8N_CALLBACK_BEARER_TOKEN: "literal-token",
      }),
    ).toEqual({
      callbackBaseUrl: "https://crawclaw.example.com",
      callbackBearerEnvVar: "CRAWCLAW_GATEWAY_TOKEN",
      callbackBearerToken: "literal-token",
    });
  });

  it("calls n8n workflow and execution endpoints with X-N8N-API-KEY", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    __testing.setDepsForTest({
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        const url = String(input);
        if (url.endsWith("/api/v1/workflows")) {
          return jsonResponse({ id: "wf_remote", name: "Remote Workflow", nodes: [], connections: {} });
        }
        if (url.endsWith("/api/v1/workflows/wf_remote")) {
          return jsonResponse({
            id: "wf_remote",
            name: "Remote Workflow",
            nodes: [],
            connections: {},
            settings: {},
          });
        }
        if (url.endsWith("/api/v1/workflows/wf_remote/activate")) {
          return jsonResponse({
            id: "wf_remote",
            name: "Remote Workflow",
            active: true,
            nodes: [],
            connections: {},
          });
        }
        if (url.endsWith("/webhook/crawclaw-wf_remote")) {
          return jsonResponse({ message: "Workflow was started" });
        }
        if (url.includes("/api/v1/executions?workflowId=wf_remote")) {
          return jsonResponse({
            data: [{ id: "exec_1", workflowId: "wf_remote", status: "running", finished: false }],
          });
        }
        if (url.includes("/api/v1/executions/exec_1") && !url.includes("/stop")) {
          return jsonResponse({ id: "exec_1", status: "success", finished: true });
        }
        if (url.endsWith("/api/v1/executions/exec_1/stop")) {
          return jsonResponse({ id: "exec_1", status: "canceled" });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    const client = createN8nClient({
      baseUrl: "https://n8n.example.com",
      apiKey: "secret-token",
    });

    await client.createWorkflow({
      name: "Remote Workflow",
      nodes: [],
      connections: {},
      settings: {},
    });
    await client.getWorkflow("wf_remote");
    await client.activateWorkflow("wf_remote");
    await client.listExecutions({ workflowId: "wf_remote", limit: 10 });
    await client.triggerWorkflowByWebhookAndWaitForExecution({
      workflowId: "wf_remote",
      webhookPath: "crawclaw-wf_remote",
      startedAfter: 0,
      timeoutMs: 2_000,
      pollMs: 10,
    });
    await client.getExecution("exec_1", { includeData: true });
    await client.stopExecution("exec_1");

    expect(calls).toHaveLength(8);
    for (const call of calls) {
      if (call.url.startsWith("https://n8n.example.com/api/v1/")) {
        expect((call.init?.headers as Record<string, string>)["X-N8N-API-KEY"]).toBe("secret-token");
      }
    }
    const createBody = JSON.parse(String(calls[0]?.init?.body ?? "{}")) as {
      nodes?: Array<Record<string, unknown>>;
    };
    expect(createBody.nodes).toEqual([]);
  });

  it("strips CrawClaw node meta before sending workflow payloads to n8n", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    __testing.setDepsForTest({
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init });
        return jsonResponse({ id: "wf_remote", name: "Remote Workflow", nodes: [], connections: {} });
      },
    });

    const client = createN8nClient({
      baseUrl: "https://n8n.example.com",
      apiKey: "secret-token",
    });

    await client.createWorkflow({
      name: "Remote Workflow",
      nodes: [
        {
          id: "http_1",
          name: "Draft content",
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4.2,
          position: [520, 300],
          parameters: { method: "POST", url: "https://example.com" },
          meta: { source: "crawclaw", crawclawStepKind: "crawclaw_agent" },
        },
      ],
      connections: {},
      settings: {},
      meta: { workflowId: "wf_1" },
    });

    const createBody = JSON.parse(String(calls[0]?.init?.body ?? "{}")) as {
      nodes?: Array<Record<string, unknown>>;
      meta?: Record<string, unknown>;
    };
    expect(createBody.meta).toBeUndefined();
    expect(createBody.nodes?.[0]?.meta).toBeUndefined();
  });
});

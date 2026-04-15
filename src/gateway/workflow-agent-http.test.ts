import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { createWorkflowExecutionRecord, getWorkflowExecution } from "../workflows/api.js";
import { clearGatewaySubagentRuntime, setGatewaySubagentRuntime } from "../plugins/runtime/index.js";

let cfg: Record<string, unknown> = {};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => cfg,
  };
});

vi.mock("./auth.js", () => ({
  authorizeHttpGatewayConnect: vi.fn(async () => ({ ok: true })),
}));

const { authorizeHttpGatewayConnect } = await import("./auth.js");
const { handleWorkflowAgentHttpRequest } = await import("./workflow-agent-http.js");

const tempDirs = createTrackedTempDirs();

type MockResponse = ServerResponse & {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function createMockRequest(params: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}): IncomingMessage & PassThrough {
  const req = new PassThrough() as IncomingMessage & PassThrough;
  req.method = params.method ?? "POST";
  req.url = params.url;
  req.headers = params.headers ?? {};
  queueMicrotask(() => {
    if (params.body !== undefined) {
      req.write(JSON.stringify(params.body));
    }
    req.end();
  });
  return req;
}

function createMockResponse(): MockResponse {
  const res = new PassThrough() as unknown as MockResponse;
  res.statusCode = 200;
  res.headers = {};
  res.body = "";
  res.setHeader = ((name: string, value: string | number | readonly string[]) => {
    res.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    return res as unknown as ServerResponse;
  }) as unknown as MockResponse["setHeader"];
  res.end = ((chunk?: unknown) => {
    if (typeof chunk === "string") {
      res.body += chunk;
    } else if (Buffer.isBuffer(chunk)) {
      res.body += chunk.toString("utf8");
    }
    return res as unknown as ServerResponse;
  }) as unknown as MockResponse["end"];
  return res;
}

beforeEach(() => {
  cfg = {};
  vi.mocked(authorizeHttpGatewayConnect).mockResolvedValue({ ok: true });
});

afterEach(async () => {
  clearGatewaySubagentRuntime();
  await tempDirs.cleanup();
});

describe("POST /workflows/agent/run", () => {
  it("rejects invalid requests without workflow store binding", async () => {
    const req = createMockRequest({
      url: "/workflows/agent/run",
      headers: { "x-crawclaw-scopes": "operator.write" },
      body: {
        workflowId: "wf_publish_redbook_123",
        executionId: "exec_remote_1",
        stepId: "draft",
        goal: "Draft content",
      },
    });
    const res = createMockResponse();

    const handled = await handleWorkflowAgentHttpRequest(req, res, {
      auth: { mode: "none", allowTailscale: false },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({
      error: {
        type: "invalid_request_error",
      },
    });
  });

  it("runs workflow-step-agent callbacks over the HTTP endpoint", async () => {
    const workspaceDir = await tempDirs.make("workflow-agent-http-");
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

    setGatewaySubagentRuntime({
      run: async () => ({ runId: "run-http-1" }),
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
                  summary: "Draft completed over HTTP",
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

    const req = createMockRequest({
      url: "/workflows/agent/run",
      headers: { "x-crawclaw-scopes": "operator.write" },
      body: {
        workflowId: "wf_publish_redbook_123",
        executionId: "exec_remote_1",
        stepId: "draft",
        goal: "Draft content",
        workspaceBinding: {
          workspaceDir,
        },
      },
    });
    const res = createMockResponse();

    const handled = await handleWorkflowAgentHttpRequest(req, res, {
      auth: { mode: "none", allowTailscale: false },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      result: {
        result: {
          status: "succeeded",
          summary: "Draft completed over HTTP",
        },
        execution: {
          status: "running",
        },
      },
    });

    const persisted = await getWorkflowExecution({ workspaceDir }, "exec_remote_1");
    expect(persisted?.steps?.[0]?.summary).toBe("Draft completed over HTTP");
  });
});

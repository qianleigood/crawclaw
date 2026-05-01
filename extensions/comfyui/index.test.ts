import { describe, expect, it, vi } from "vitest";
import entry from "./index.js";
import type { CrawClawPluginApi, GatewayRequestHandlerOptions } from "./runtime-api.js";

function createApiRecorder(
  options: {
    config?: Record<string, unknown>;
    resolveAgentWorkspaceDir?: (config: unknown, agentId: string) => string;
  } = {},
) {
  const tools: Array<{ tool: unknown; opts?: Record<string, unknown> }> = [];
  const hooks: Array<{ event: string; handler: (event: unknown) => unknown; opts?: unknown }> = [];
  const gatewayMethods: Array<{
    method: string;
    handler: (opts: GatewayRequestHandlerOptions) => Promise<void> | void;
    opts?: { scope?: string };
  }> = [];
  const resolveAgentWorkspaceDir =
    options.resolveAgentWorkspaceDir ??
    vi.fn((_config: unknown, agentId: string) => `/tmp/${agentId}-workspace`);
  const api = {
    id: "comfyui",
    name: "ComfyUI",
    source: "test",
    registrationMode: "full",
    config: options.config ?? {},
    pluginConfig: {},
    runtime: {
      agent: {
        resolveAgentWorkspaceDir,
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerTool(tool: unknown, opts?: Record<string, unknown>) {
      tools.push({ tool, opts });
    },
    registerGatewayMethod(
      method: string,
      handler: (opts: GatewayRequestHandlerOptions) => Promise<void> | void,
      opts?: unknown,
    ) {
      gatewayMethods.push({ method, handler, opts: opts as { scope?: string } | undefined });
    },
    on(event: string, handler: (event: unknown) => unknown, opts?: unknown) {
      hooks.push({ event, handler, opts });
    },
  } as unknown as CrawClawPluginApi;
  return { api, tools, hooks, gatewayMethods, resolveAgentWorkspaceDir };
}

describe("comfyui plugin entry", () => {
  it("registers ComfyUI gateway methods in management UI order", () => {
    const recorder = createApiRecorder();

    entry.register(recorder.api);

    expect(
      recorder.gatewayMethods.map((item) => ({ method: item.method, scope: item.opts?.scope })),
    ).toEqual([
      { method: "comfyui.status", scope: "operator.read" },
      { method: "comfyui.workflows.list", scope: "operator.read" },
      { method: "comfyui.workflow.get", scope: "operator.read" },
      { method: "comfyui.runs.list", scope: "operator.read" },
      { method: "comfyui.outputs.list", scope: "operator.read" },
      { method: "comfyui.workflow.validate", scope: "operator.read" },
      { method: "comfyui.workflow.run", scope: "operator.write" },
    ]);
  });

  it("rejects direct workflow runs without explicit confirmation", async () => {
    const recorder = createApiRecorder();
    entry.register(recorder.api);

    const method = recorder.gatewayMethods.find((item) => item.method === "comfyui.workflow.run");
    const responses: Array<{ ok: boolean; payload?: unknown }> = [];
    await method?.handler({
      params: { workflowId: "demo" },
      respond: (ok: boolean, payload: unknown) => {
        responses.push({ ok, payload });
      },
    } as unknown as GatewayRequestHandlerOptions);

    expect(responses).toEqual([
      {
        ok: false,
        payload: { error: "confirmed true required before running a ComfyUI workflow" },
      },
    ]);
  });

  it("resolves ComfyUI status paths from the default agent workspace", async () => {
    const recorder = createApiRecorder({
      config: {
        agents: {
          list: [{ id: "side" }, { id: "artist", default: true }],
        },
      },
    });
    entry.register(recorder.api);

    const method = recorder.gatewayMethods.find((item) => item.method === "comfyui.status");
    const responses: Array<{ ok: boolean; payload?: unknown }> = [];
    await method?.handler({
      params: {},
      respond: (ok: boolean, payload: unknown) => {
        responses.push({ ok, payload });
      },
    } as unknown as GatewayRequestHandlerOptions);

    expect(recorder.resolveAgentWorkspaceDir).toHaveBeenCalledWith(recorder.api.config, "artist");
    expect(responses).toEqual([
      {
        ok: true,
        payload: {
          baseUrl: "http://127.0.0.1:8188",
          workflowsDir: "/tmp/artist-workspace/.crawclaw/comfyui/workflows",
          outputDir: "/tmp/artist-workspace/.crawclaw/comfyui/outputs",
        },
      },
    ]);
  });

  it("uses explicit workspaceDir params for ComfyUI status", async () => {
    const recorder = createApiRecorder();
    entry.register(recorder.api);

    const method = recorder.gatewayMethods.find((item) => item.method === "comfyui.status");
    const responses: Array<{ ok: boolean; payload?: unknown }> = [];
    await method?.handler({
      params: { workspaceDir: "/tmp/explicit-workspace" },
      respond: (ok: boolean, payload: unknown) => {
        responses.push({ ok, payload });
      },
    } as unknown as GatewayRequestHandlerOptions);

    expect(recorder.resolveAgentWorkspaceDir).not.toHaveBeenCalled();
    expect(responses).toEqual([
      {
        ok: true,
        payload: {
          baseUrl: "http://127.0.0.1:8188",
          workflowsDir: "/tmp/explicit-workspace/.crawclaw/comfyui/workflows",
          outputDir: "/tmp/explicit-workspace/.crawclaw/comfyui/outputs",
        },
      },
    ]);
  });

  it("registers comfyui_workflow as an optional tool", () => {
    const recorder = createApiRecorder();

    entry.register(recorder.api);

    expect(recorder.tools).toHaveLength(1);
    expect(recorder.tools[0]?.opts).toMatchObject({
      name: "comfyui_workflow",
      optional: true,
    });
  });

  it("requires plugin approval before running a ComfyUI workflow", async () => {
    const recorder = createApiRecorder();
    entry.register(recorder.api);

    const hook = recorder.hooks.find((item) => item.event === "before_tool_call");
    const result = await hook?.handler({
      toolName: "comfyui_workflow",
      params: { action: "run", workflowId: "demo" },
    });

    expect(result).toMatchObject({
      requireApproval: {
        title: "Run ComfyUI workflow",
        severity: "warning",
        timeoutBehavior: "deny",
      },
    });
  });

  it("does not request approval for non-run actions", async () => {
    const recorder = createApiRecorder();
    entry.register(recorder.api);

    const hook = recorder.hooks.find((item) => item.event === "before_tool_call");
    const result = await hook?.handler({
      toolName: "comfyui_workflow",
      params: { action: "inspect" },
    });

    expect(result).toBeUndefined();
  });
});

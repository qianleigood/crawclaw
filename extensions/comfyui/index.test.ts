import { describe, expect, it } from "vitest";
import entry from "./index.js";
import type { CrawClawPluginApi } from "./runtime-api.js";

function createApiRecorder() {
  const tools: Array<{ tool: unknown; opts?: Record<string, unknown> }> = [];
  const hooks: Array<{ event: string; handler: (event: unknown) => unknown; opts?: unknown }> = [];
  const api = {
    id: "comfyui",
    name: "ComfyUI",
    source: "test",
    registrationMode: "full",
    config: {},
    pluginConfig: {},
    runtime: {},
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerTool(tool: unknown, opts?: Record<string, unknown>) {
      tools.push({ tool, opts });
    },
    on(event: string, handler: (event: unknown) => unknown, opts?: unknown) {
      hooks.push({ event, handler, opts });
    },
  } as unknown as CrawClawPluginApi;
  return { api, tools, hooks };
}

describe("comfyui plugin entry", () => {
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

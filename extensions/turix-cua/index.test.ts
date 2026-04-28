import { describe, expect, it } from "vitest";
import entry from "./index.js";
import type { CrawClawPluginApi } from "./runtime-api.js";

function createApiRecorder() {
  const tools: Array<{ tool: unknown; opts?: Record<string, unknown> }> = [];
  const hooks: Array<{ event: string; handler: (event: unknown) => unknown; opts?: unknown }> = [];
  const api = {
    id: "turix-cua",
    name: "TuriX CUA",
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

describe("turix-cua plugin entry", () => {
  it("registers turix_desktop_run as an optional tool", () => {
    const recorder = createApiRecorder();

    entry.register(recorder.api);

    expect(recorder.tools).toHaveLength(1);
    expect(recorder.tools[0]?.opts).toMatchObject({
      name: "turix_desktop_run",
      optional: true,
    });
  });

  it("requires approval for desktop run mode", async () => {
    const recorder = createApiRecorder();
    entry.register(recorder.api);

    const hook = recorder.hooks.find((item) => item.event === "before_tool_call");
    const result = await hook?.handler({
      toolName: "turix_desktop_run",
      params: { task: "Open Calculator", mode: "run" },
    });

    expect(result).toMatchObject({
      requireApproval: {
        title: "Run desktop automation with TuriX",
        severity: "critical",
        timeoutBehavior: "deny",
      },
    });
  });

  it("treats a missing mode as run mode for approval safety", async () => {
    const recorder = createApiRecorder();
    entry.register(recorder.api);

    const hook = recorder.hooks.find((item) => item.event === "before_tool_call");
    const result = await hook?.handler({
      toolName: "turix_desktop_run",
      params: { task: "Open Calculator" },
    });

    expect(result).toMatchObject({
      requireApproval: {
        timeoutBehavior: "deny",
      },
    });
  });

  it("does not request approval for plan mode", async () => {
    const recorder = createApiRecorder();
    entry.register(recorder.api);

    const hook = recorder.hooks.find((item) => item.event === "before_tool_call");
    const result = await hook?.handler({
      toolName: "turix_desktop_run",
      params: { task: "Open Calculator", mode: "plan" },
    });

    expect(result).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";
import type { CrawClawPluginApi } from "./runtime-api.js";

const runtimeApiMocks = vi.hoisted(() => ({
  createBrowserTool: vi.fn(() => ({
    name: "browser",
    description: "browser",
    parameters: { type: "object", properties: {} },
    execute: vi.fn(),
  })),
}));

vi.mock("./runtime-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime-api.js")>();
  return {
    ...actual,
    createBrowserTool: runtimeApiMocks.createBrowserTool,
  };
});

import browserPlugin from "./index.js";

function createApi() {
  const registerTool = vi.fn();
  const api = createTestPluginApi({
    id: "browser",
    name: "Browser",
    source: "test",
    config: {},
    runtime: {} as CrawClawPluginApi["runtime"],
    registerTool,
  }) as CrawClawPluginApi;
  return { api, registerTool };
}

describe("browser plugin", () => {
  it("forwards per-session browser options into the tool factory", () => {
    const { api, registerTool } = createApi();
    browserPlugin.register(api);

    const tool = registerTool.mock.calls[0]?.[0];
    if (typeof tool !== "function") {
      throw new Error("expected browser plugin to register a tool factory");
    }

    tool({
      sessionKey: "agent:main:webchat:direct:123",
      browser: {
        sandboxBridgeUrl: "http://127.0.0.1:9999",
        sandboxPinchTabUrl: "http://127.0.0.1:9867",
        allowHostControl: true,
      },
    });

    expect(runtimeApiMocks.createBrowserTool).toHaveBeenCalledWith({
      sandboxBridgeUrl: "http://127.0.0.1:9999",
      sandboxPinchTabUrl: "http://127.0.0.1:9867",
      allowHostControl: true,
      agentSessionKey: "agent:main:webchat:direct:123",
    });
  });
});

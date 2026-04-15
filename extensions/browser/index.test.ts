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

const serviceMocks = vi.hoisted(() => ({
  ensureManagedPinchTabService: vi.fn(async () => {}),
  stopManagedPinchTabService: vi.fn(async () => {}),
}));

vi.mock("./runtime-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime-api.js")>();
  return {
    ...actual,
    createBrowserTool: runtimeApiMocks.createBrowserTool,
  };
});

vi.mock("./src/pinchtab/pinchtab-managed-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./src/pinchtab/pinchtab-managed-service.js")>();
  return {
    ...actual,
    ensureManagedPinchTabService: serviceMocks.ensureManagedPinchTabService,
    stopManagedPinchTabService: serviceMocks.stopManagedPinchTabService,
  };
});

import browserPlugin from "./index.js";

function createApi() {
  const registerTool = vi.fn();
  const registerService = vi.fn();
  const api = createTestPluginApi({
    id: "browser",
    name: "Browser",
    source: "test",
    config: {},
    runtime: {} as CrawClawPluginApi["runtime"],
    registerTool,
    registerService,
  }) as CrawClawPluginApi;
  return { api, registerTool, registerService };
}

describe("browser plugin", () => {
  it("registers the managed PinchTab runtime service", async () => {
    const { api, registerService } = createApi();
    browserPlugin.register(api);

    const service = registerService.mock.calls[0]?.[0];
    expect(service?.id).toBe("browser-pinchtab-runtime");

    await service.start({
      config: { marker: "cfg" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    expect(serviceMocks.ensureManagedPinchTabService).toHaveBeenCalledWith({
      config: { marker: "cfg" },
      logger: expect.any(Object),
    });

    await service.stop();
    expect(serviceMocks.stopManagedPinchTabService).toHaveBeenCalledTimes(1);
  });

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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";
import type { CrawClawPluginApi } from "crawclaw/plugin-sdk/plugin-entry";

const runtimeMocks = vi.hoisted(() => ({
  registerFeishuCliCli: vi.fn(),
  registerFeishuCliTools: vi.fn(),
  handleFeishuCliStatusGatewayRequest: vi.fn(),
}));

vi.mock("./src/cli.js", () => ({
  registerFeishuCliCli: runtimeMocks.registerFeishuCliCli,
}));

vi.mock("./src/tools.js", () => ({
  registerFeishuCliTools: runtimeMocks.registerFeishuCliTools,
}));

vi.mock("./src/gateway.js", () => ({
  handleFeishuCliStatusGatewayRequest: runtimeMocks.handleFeishuCliStatusGatewayRequest,
}));

import feishuCliPlugin from "./index.js";

function createApi(pluginConfig?: Record<string, unknown>) {
  const registerCli = vi.fn();
  const registerGatewayMethod = vi.fn();
  const registerTool = vi.fn();
  const api = createTestPluginApi({
    id: "feishu-cli",
    name: "Feishu CLI",
    source: "test",
    config: {},
    pluginConfig,
    runtime: {} as CrawClawPluginApi["runtime"],
    registerCli,
    registerGatewayMethod,
    registerTool,
  }) as CrawClawPluginApi;
  return {
    api,
    registerCli,
    registerGatewayMethod,
    registerTool,
  };
}

describe("feishu-cli plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers cli and gateway surfaces, plus tools when enabled", () => {
    const { api, registerCli, registerGatewayMethod } = createApi();
    feishuCliPlugin.register(api);

    expect(registerCli).toHaveBeenCalledTimes(1);
    expect(registerGatewayMethod).toHaveBeenCalledWith(
      "feishu.cli.status",
      expect.any(Function),
      expect.objectContaining({ scope: "operator.read" }),
    );
    expect(runtimeMocks.registerFeishuCliTools).toHaveBeenCalledTimes(1);
  });

  it("skips tool registration when config disables the plugin", () => {
    const { api } = createApi({ enabled: false });
    feishuCliPlugin.register(api);

    expect(runtimeMocks.registerFeishuCliTools).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserConfigMocks = vi.hoisted(() => ({
  resolveBrowserConfig: vi.fn(() => ({
    enabled: true,
    controlPort: 18791,
    profiles: {},
    defaultProfile: "crawclaw",
  })),
  resolveProfile: vi.fn((resolved: Record<string, unknown>, name: string) => {
    const profile = (resolved.profiles as Record<string, Record<string, unknown>> | undefined)?.[
      name
    ];
    if (!profile) {
      return null;
    }
    return {
      name,
      driver: "crawclaw",
      cdpPort: 18792,
      cdpUrl: "http://127.0.0.1:18792",
      cdpHost: "127.0.0.1",
      cdpIsLoopback: true,
      color: "#FF4500",
    };
  }),
}));
vi.mock("./browser/config.js", () => browserConfigMocks);

const nodesUtilsMocks = vi.hoisted(() => ({
  listNodes: vi.fn(async (..._args: unknown[]): Promise<Array<Record<string, unknown>>> => []),
}));
vi.mock("../../../src/agents/tools/nodes-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/agents/tools/nodes-utils.js")>(
    "../../../src/agents/tools/nodes-utils.js",
  );
  return {
    ...actual,
    listNodes: nodesUtilsMocks.listNodes,
  };
});

const gatewayMocks = vi.hoisted(() => ({
  callGatewayTool: vi.fn(async () => ({
    ok: true,
    payload: { result: { ok: true, running: true } },
  })),
}));
vi.mock("../../../src/agents/tools/gateway.js", () => gatewayMocks);

const configMocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({ browser: {} })),
}));
vi.mock("crawclaw/plugin-sdk/config-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crawclaw/plugin-sdk/config-runtime")>();
  return {
    ...actual,
    loadConfig: configMocks.loadConfig,
  };
});

const toolCommonMocks = vi.hoisted(() => ({
  imageResultFromFile: vi.fn(),
}));
vi.mock("../../../src/agents/tools/common.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/agents/tools/common.js")>(
    "../../../src/agents/tools/common.js",
  );
  return {
    ...actual,
    imageResultFromFile: toolCommonMocks.imageResultFromFile,
  };
});

import { __testing as browserToolTesting, createBrowserTool } from "./browser-tool.js";
import { __testing as pinchTabClientTesting } from "./pinchtab/pinchtab-client.js";
import { __testing as pinchTabExecutorTesting } from "./pinchtab/pinchtab-executor.js";
import { __testing as pinchTabStateTesting } from "./pinchtab/pinchtab-state.js";

function setResolvedBrowserProfiles(
  profiles: Record<string, Record<string, unknown>>,
  defaultProfile = "crawclaw",
) {
  browserConfigMocks.resolveBrowserConfig.mockReturnValue({
    enabled: true,
    controlPort: 18791,
    profiles,
    defaultProfile,
  });
}

describe("browser tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMocks.loadConfig.mockReturnValue({ browser: {} });
    browserConfigMocks.resolveBrowserConfig.mockReturnValue({
      enabled: true,
      controlPort: 18791,
      profiles: {},
      defaultProfile: "crawclaw",
    });
    nodesUtilsMocks.listNodes.mockResolvedValue([]);
    toolCommonMocks.imageResultFromFile.mockResolvedValue({
      content: [{ type: "image", data: "x", mimeType: "image/png" }],
      details: { ok: true },
    });
    browserToolTesting.setDepsForTest({
      loadConfig: configMocks.loadConfig as never,
      listNodes: nodesUtilsMocks.listNodes as never,
      callGatewayTool: gatewayMocks.callGatewayTool as never,
      imageResultFromFile: toolCommonMocks.imageResultFromFile as never,
    });
    pinchTabClientTesting.setDepsForTest({ fetchImpl: vi.fn() as never });
    pinchTabExecutorTesting.setDepsForTest(null);
    pinchTabStateTesting.reset();
  });

  afterEach(() => {
    browserToolTesting.setDepsForTest(null);
    pinchTabClientTesting.setDepsForTest(null);
    pinchTabExecutorTesting.setDepsForTest(null);
    pinchTabStateTesting.reset();
  });

  it("uses PinchTab for host snapshot by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_1", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_1", url: "https://example.com" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ nodes: [{ ref: "e1", role: "button", name: "Go" }] }), {
          status: 200,
        }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const tool = createBrowserTool();
    await tool.execute?.("call-1", { action: "open", target: "host", url: "https://example.com" });
    const result = await tool.execute?.("call-2", { action: "snapshot", target: "host" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:9867/tabs/tab_1/snapshot",
      expect.any(Object),
    );
    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("<<<EXTERNAL_UNTRUSTED_CONTENT"),
    });
  });

  it("requires sandbox PinchTab URL for sandbox route", async () => {
    const tool = createBrowserTool({
      sandboxBridgeUrl: "http://127.0.0.1:9999",
      sandboxCdpUrl: "http://127.0.0.1:9222",
    });

    await expect(
      tool.execute?.("call-1", {
        action: "open",
        url: "https://example.com",
      }),
    ).rejects.toThrow("Sandbox PinchTab URL is unavailable.");
  });

  it("uses PinchTab for sandbox route when sandbox PinchTab URL is provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_sbx_1", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_sbx_1", url: "https://example.com" }), {
          status: 200,
        }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });
    configMocks.loadConfig.mockReturnValue({
      browser: {
        provider: "pinchtab",
        pinchtab: { baseUrl: "http://127.0.0.1:9867" },
      },
    });

    const tool = createBrowserTool({
      sandboxBridgeUrl: "http://127.0.0.1:9999",
      sandboxCdpUrl: "http://127.0.0.1:9222",
      sandboxPinchTabUrl: "http://127.0.0.1:19867",
    });
    const result = await tool.execute?.("call-1", {
      action: "open",
      url: "https://example.com",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:19867/instances/launch",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:19867/instances/inst_sbx_1/tabs/open",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.details).toMatchObject({
      ok: true,
      instanceId: "inst_sbx_1",
      tabId: "tab_sbx_1",
    });
  });

  it("returns configured profiles on host without calling legacy browser runtime", async () => {
    setResolvedBrowserProfiles({
      crawclaw: {},
      work: {},
    });

    const tool = createBrowserTool();
    const result = await tool.execute?.("call-1", { action: "profiles" });

    expect(result?.details).toEqual({
      profiles: [{ name: "crawclaw" }, { name: "work" }],
    });
  });

  it("supports url alias for open on host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_alias", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_alias", url: "https://example.com" }), {
          status: 200,
        }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const tool = createBrowserTool({ agentSessionKey: "agent:main:main" });
    await tool.execute?.("call-1", { action: "open", url: "https://example.com" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9867/instances/inst_alias/tabs/open",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses PinchTab for host open when browser.provider=pinchtab", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_1", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_1", url: "https://example.com" }), { status: 200 }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });
    configMocks.loadConfig.mockReturnValue({
      browser: {
        provider: "pinchtab",
        pinchtab: { baseUrl: "http://127.0.0.1:9867" },
      },
    });

    const tool = createBrowserTool();
    const result = await tool.execute?.("call-1", { action: "open", url: "https://example.com" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9867/instances/launch",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9867/instances/inst_1/tabs/open",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result?.details).toMatchObject({ ok: true, instanceId: "inst_1", tabId: "tab_1" });
  });

  it("uses PinchTab for host status when browser.provider=pinchtab", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, status: "ok" }), { status: 200 }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });
    configMocks.loadConfig.mockReturnValue({
      browser: {
        provider: "pinchtab",
        pinchtab: { baseUrl: "http://127.0.0.1:9867", token: "secret" },
      },
    });

    const tool = createBrowserTool();
    const result = await tool.execute?.("call-1", { action: "status", target: "host" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9867/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
          "X-Bridge-Token": "secret",
        }),
      }),
    );
    expect(result?.details).toMatchObject({ ok: true, running: false });
  });

  it("runs batch steps sequentially", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_batch", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_batch", url: "https://example.com" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ nodes: [{ ref: "e1", role: "button", name: "Go" }] }), {
          status: 200,
        }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const tool = createBrowserTool({ agentSessionKey: "agent:main:main" });
    const result = await tool.execute?.("call-1", {
      action: "batch",
      target: "host",
      steps: [
        { action: "open", url: "https://example.com" },
        { action: "snapshot", snapshotFormat: "ai" },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result?.details).toMatchObject({ ok: true, count: 2 });
  });

  it("supports cookies action on host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_cookie", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_cookie", url: "https://example.com" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ cookies: [{ name: "session", value: "abc" }] }), {
          status: 200,
        }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const tool = createBrowserTool({ agentSessionKey: "agent:main:main" });
    await tool.execute?.("call-0", { action: "open", target: "host", url: "https://example.com" });
    const result = await tool.execute?.("call-1", {
      action: "cookies",
      target: "host",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:9867/tabs/tab_cookie/cookies",
      expect.any(Object),
    );
    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("session"),
    });
  });

  it("supports flattened act params without targetId on host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_act", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_act", url: "https://example.com" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const tool = createBrowserTool();
    await tool.execute?.("call-0", { action: "open", url: "https://example.com" });
    await tool.execute?.("call-1", {
      action: "act",
      kind: "type",
      ref: "@e1",
      text: "Hello",
      timeoutMs: 5000,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:9867/tabs/tab_act/action",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects act requests that still depend on targetId on host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_target", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_target", url: "https://example.com" }), {
          status: 200,
        }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });
    const tool = createBrowserTool();
    await tool.execute?.("call-0", { action: "open", url: "https://example.com" });

    await expect(
      tool.execute?.("call-1", {
        action: "act",
        request: { kind: "click", ref: "@e1", targetId: "tab-1" },
      }),
    ).rejects.toThrow();
  });

  it("wraps tabs output as external content on host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_tabs", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: "tab_tabs", title: "Example", url: "https://example.com" }]),
          {
            status: 200,
          },
        ),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const tool = createBrowserTool();
    const result = await tool.execute?.("call-1", { action: "tabs" });

    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("<<<EXTERNAL_UNTRUSTED_CONTENT"),
    });
    expect(result?.details).toMatchObject({ ok: true });
  });

  it("wraps console output as external content on host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_console", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: '{"messages":[{"type":"log","text":"hello"}]}' }), {
          status: 200,
        }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const tool = createBrowserTool();
    const result = await tool.execute?.("call-1", { action: "console" });

    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("<<<EXTERNAL_UNTRUSTED_CONTENT"),
    });
    expect(result?.details).toMatchObject({ ok: true });
  });

  it("routes to node proxy when target=node", async () => {
    nodesUtilsMocks.listNodes.mockResolvedValue([
      {
        nodeId: "node-1",
        displayName: "Browser Node",
        connected: true,
        caps: ["browser"],
        commands: ["browser.proxy"],
      },
    ]);

    const tool = createBrowserTool();
    await tool.execute?.("call-1", { action: "status", target: "node" });

    expect(gatewayMocks.callGatewayTool).toHaveBeenCalledWith(
      "node.invoke",
      { timeoutMs: 25000 },
      expect.objectContaining({
        nodeId: "node-1",
        command: "browser.proxy",
      }),
    );
  });
});

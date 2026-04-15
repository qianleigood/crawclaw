import { beforeEach, describe, expect, it, vi } from "vitest";

const configMocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({
    browser: {},
    nodeHost: { browserProxy: { enabled: true, allowProfiles: [] as string[] } },
  })),
}));

const browserConfigMocks = vi.hoisted(() => ({
  resolveBrowserConfig: vi.fn(() => ({
    enabled: true,
    defaultProfile: "crawclaw",
  })),
}));

vi.mock("../core-api.js", async () => ({
  ...(await vi.importActual<object>("../core-api.js")),
  detectMime: vi.fn(async () => "image/png"),
  loadConfig: configMocks.loadConfig,
  resolveBrowserConfig: browserConfigMocks.resolveBrowserConfig,
}));

let runBrowserProxyCommand: typeof import("./invoke-browser.js").runBrowserProxyCommand;
let pinchTabClientTesting: typeof import("../pinchtab/pinchtab-client.js").__testing;
let pinchTabStateTesting: typeof import("../pinchtab/pinchtab-state.js").__testing;

describe("runBrowserProxyCommand", () => {
  beforeEach(async () => {
    vi.resetModules();
    configMocks.loadConfig.mockReset().mockReturnValue({
      browser: {},
      nodeHost: { browserProxy: { enabled: true, allowProfiles: [] as string[] } },
    });
    browserConfigMocks.resolveBrowserConfig.mockReset().mockReturnValue({
      enabled: true,
      defaultProfile: "crawclaw",
    });
    ({ runBrowserProxyCommand } = await import("./invoke-browser.js"));
    ({ __testing: pinchTabClientTesting } = await import("../pinchtab/pinchtab-client.js"));
    ({ __testing: pinchTabStateTesting } = await import("../pinchtab/pinchtab-state.js"));
    pinchTabClientTesting.setDepsForTest(null);
    pinchTabStateTesting.reset();
  });

  it("uses PinchTab for supported proxy requests by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_1", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_1", url: "https://example.com" }), { status: 200 }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const raw = await runBrowserProxyCommand(
      JSON.stringify({
        method: "POST",
        path: "/tabs/open",
        profile: "crawclaw",
        body: { url: "https://example.com" },
        timeoutMs: 50,
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9867/instances/inst_1/tabs/open",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(raw)).toEqual({
      result: { ok: true, instanceId: "inst_1", tabId: "tab_1", url: "https://example.com" },
    });
  });

  it("supports cookies through the node proxy", async () => {
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
    await runBrowserProxyCommand(
      JSON.stringify({
        method: "POST",
        path: "/tabs/open",
        profile: "crawclaw",
        body: { url: "https://example.com" },
        timeoutMs: 50,
      }),
    );

    const raw = await runBrowserProxyCommand(
      JSON.stringify({
        method: "GET",
        path: "/cookies",
        profile: "crawclaw",
        timeoutMs: 50,
      }),
    );

    expect(JSON.parse(raw)).toEqual({
      result: { cookies: [{ name: "session", value: "abc" }] },
    });
  });

  it("supports batch form fill primitives through /act", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_fill", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_fill", url: "https://example.com" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });
    await runBrowserProxyCommand(
      JSON.stringify({
        method: "POST",
        path: "/tabs/open",
        profile: "crawclaw",
        body: { url: "https://example.com" },
        timeoutMs: 50,
      }),
    );

    const raw = await runBrowserProxyCommand(
      JSON.stringify({
        method: "POST",
        path: "/act",
        profile: "crawclaw",
        body: {
          kind: "fill",
          fields: [
            { ref: "@name", value: "Alice" },
            { ref: "@email", value: "alice@example.com" },
          ],
        },
        timeoutMs: 50,
      }),
    );

    expect(JSON.parse(raw)).toEqual({ result: { ok: true, count: 2 } });
  });

  it("rejects unsupported legacy proxy paths instead of falling back", async () => {
    await expect(
      runBrowserProxyCommand(
        JSON.stringify({
          method: "POST",
          path: "/profiles/create",
          body: { name: "poc", cdpUrl: "http://127.0.0.1:9222" },
          timeoutMs: 50,
        }),
      ),
    ).rejects.toThrow(
      "UNAVAILABLE: browser.proxy path not supported by PinchTab runtime: POST /profiles/create",
    );
  });

  it("rejects unauthorized profiles before invoking the PinchTab proxy", async () => {
    configMocks.loadConfig.mockReturnValue({
      browser: {},
      nodeHost: { browserProxy: { enabled: true, allowProfiles: ["crawclaw"] } },
    });

    await expect(
      runBrowserProxyCommand(
        JSON.stringify({
          method: "GET",
          path: "/snapshot",
          query: { profile: "user" },
          timeoutMs: 50,
        }),
      ),
    ).rejects.toThrow("INVALID_REQUEST: browser profile not allowed");
  });

  it("still blocks persistent profile mutation when allowProfiles is configured", async () => {
    configMocks.loadConfig.mockReturnValue({
      browser: {},
      nodeHost: { browserProxy: { enabled: true, allowProfiles: ["crawclaw"] } },
    });

    await expect(
      runBrowserProxyCommand(
        JSON.stringify({
          method: "DELETE",
          path: "/profiles/poc",
          timeoutMs: 50,
        }),
      ),
    ).rejects.toThrow(
      "INVALID_REQUEST: browser.proxy cannot mutate persistent browser profiles when allowProfiles is configured",
    );
  });

  it("uses PinchTab auth headers when configured", async () => {
    configMocks.loadConfig.mockReturnValue({
      browser: {
        provider: "pinchtab",
        pinchtab: { baseUrl: "http://127.0.0.1:9867", token: "secret" },
      },
      nodeHost: { browserProxy: { enabled: true, allowProfiles: [] as string[] } },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "inst_1", status: "starting" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "tab_1", url: "https://example.com" }), { status: 200 }),
      );
    pinchTabClientTesting.setDepsForTest({ fetchImpl: fetchMock as never });

    const raw = await runBrowserProxyCommand(
      JSON.stringify({
        method: "POST",
        path: "/tabs/open",
        profile: "crawclaw",
        body: { url: "https://example.com" },
        timeoutMs: 50,
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9867/instances/launch",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
          "X-Bridge-Token": "secret",
        }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9867/instances/inst_1/tabs/open",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(raw)).toEqual({
      result: { ok: true, instanceId: "inst_1", tabId: "tab_1", url: "https://example.com" },
    });
  });
});

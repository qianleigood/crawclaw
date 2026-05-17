import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { captureEnv } from "../test-utils/env.js";
import {
  loadConfigMock as loadConfig,
  pickPrimaryLanIPv4Mock as pickPrimaryLanIPv4,
  pickPrimaryTailnetIPv4Mock as pickPrimaryTailnetIPv4,
  resolveGatewayPortMock as resolveGatewayPort,
} from "./gateway-connection.test-mocks.js";

let fetchCalls: Array<{
  url: string;
  init?: RequestInit;
  options?: { tlsFingerprint?: string };
}> = [];
let fetchMode: "ok" | "http-error" | "hang" = "ok";
let gatewayMethods: string[] | undefined = ["health", "secrets.resolve"];

const { __testing, buildGatewayConnectionDetails, callGateway, callGatewayCli, callGatewayScoped } =
  await import("./call.js");

function resetGatewayCallMocks() {
  loadConfig.mockClear();
  resolveGatewayPort.mockClear();
  pickPrimaryTailnetIPv4.mockClear();
  pickPrimaryLanIPv4.mockClear();
  fetchCalls = [];
  fetchMode = "ok";
  gatewayMethods = ["health", "secrets.resolve"];
  const loadConfigForTests = loadConfig as unknown as () => CrawClawConfig;
  const resolveGatewayPortForTests = resolveGatewayPort as unknown as (
    cfg?: CrawClawConfig,
    env?: NodeJS.ProcessEnv,
  ) => number;
  __testing.setDepsForTests({
    fetch: async (url: string, init?: RequestInit, options?: { tlsFingerprint?: string }) => {
      fetchCalls.push({ url, init, options });
      if (fetchMode === "hang") {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("This operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      if (fetchMode === "http-error") {
        return {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          json: async () => ({ ok: false, error: "unavailable" }),
        } as Response;
      }
      const body = readFetchBody({ init });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          ok: true,
          result:
            body.method === "system.status" ? { gatewayMethods } : { ok: true, status: "started" },
        }),
      } as Response;
    },
    loadConfig: loadConfigForTests,
    resolveGatewayPort: resolveGatewayPortForTests,
  });
}

function readFetchBody(call: { init?: RequestInit }): { method?: string; params?: unknown } {
  if (typeof call.init?.body !== "string") {
    return {};
  }
  return JSON.parse(call.init.body) as { method?: string; params?: unknown };
}

function lastFetchCall(): {
  url: string;
  init?: RequestInit;
  options?: { tlsFingerprint?: string };
} {
  const call = fetchCalls.at(-1);
  if (!call) {
    throw new Error("expected gateway HTTP fetch call");
  }
  return call;
}

function lastFetchCredential(): string | undefined {
  return (lastFetchCall().init?.headers as Record<string, string> | undefined)?.[
    "x-crawclaw-gateway-token"
  ];
}

function gatewayRpcUrl(gatewayUrl: string): string {
  const parsed = new URL(gatewayUrl);
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  parsed.pathname = "/api/gateway/rpc";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function setGatewayNetworkDefaults(port = 18789) {
  resolveGatewayPort.mockReturnValue(port);
  pickPrimaryTailnetIPv4.mockReturnValue(undefined);
}

function setLocalLoopbackGatewayConfig(port = 18789) {
  loadConfig.mockReturnValue({ gateway: { mode: "local", bind: "loopback" } });
  setGatewayNetworkDefaults(port);
}

function makeRemotePasswordGatewayConfig(remotePassword: string, localPassword = "from-config") {
  return {
    gateway: {
      mode: "remote",
      remote: { url: "wss://remote.example:18789", password: remotePassword },
      auth: { password: localPassword },
    },
  };
}

describe("callGateway url resolution", () => {
  const envSnapshot = captureEnv([
    "CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS",
    "CRAWCLAW_GATEWAY_URL",
    "CRAWCLAW_GATEWAY_TOKEN",
  ]);

  beforeEach(() => {
    envSnapshot.restore();
    delete process.env.CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS;
    delete process.env.CRAWCLAW_GATEWAY_URL;
    delete process.env.CRAWCLAW_GATEWAY_TOKEN;
    resetGatewayCallMocks();
  });

  afterEach(() => {
    envSnapshot.restore();
    __testing.resetDepsForTests();
  });

  it.each([
    {
      label: "keeps loopback when local bind is auto even if tailnet is present",
      tailnetIp: "100.64.0.1",
    },
    {
      label: "falls back to loopback when local bind is auto without tailnet IP",
      tailnetIp: undefined,
    },
  ])("local auto-bind: $label", async ({ tailnetIp }) => {
    loadConfig.mockReturnValue({ gateway: { mode: "local", bind: "auto" } });
    resolveGatewayPort.mockReturnValue(18800);
    pickPrimaryTailnetIPv4.mockReturnValue(tailnetIp);

    await callGateway({ method: "health" });

    expect(lastFetchCall().url).toBe("http://127.0.0.1:18800/api/gateway/rpc");
  });

  it.each([
    {
      label: "tailnet with TLS",
      gateway: { mode: "local", bind: "tailnet", tls: { enabled: true } },
      tailnetIp: "100.64.0.1",
      lanIp: undefined,
      expectedUrl: "wss://127.0.0.1:18800",
    },
    {
      label: "tailnet without TLS",
      gateway: { mode: "local", bind: "tailnet" },
      tailnetIp: "100.64.0.1",
      lanIp: undefined,
      expectedUrl: "ws://127.0.0.1:18800",
    },
    {
      label: "lan with TLS",
      gateway: { mode: "local", bind: "lan", tls: { enabled: true } },
      tailnetIp: undefined,
      lanIp: "192.168.1.42",
      expectedUrl: "wss://127.0.0.1:18800",
    },
    {
      label: "lan without TLS",
      gateway: { mode: "local", bind: "lan" },
      tailnetIp: undefined,
      lanIp: "192.168.1.42",
      expectedUrl: "ws://127.0.0.1:18800",
    },
    {
      label: "lan without discovered LAN IP",
      gateway: { mode: "local", bind: "lan" },
      tailnetIp: undefined,
      lanIp: undefined,
      expectedUrl: "ws://127.0.0.1:18800",
    },
  ])("uses loopback for $label", async ({ gateway, tailnetIp, lanIp, expectedUrl }) => {
    loadConfig.mockReturnValue({ gateway });
    resolveGatewayPort.mockReturnValue(18800);
    pickPrimaryTailnetIPv4.mockReturnValue(tailnetIp);
    pickPrimaryLanIPv4.mockReturnValue(lanIp);

    await callGateway({ method: "health" });

    expect(lastFetchCall().url).toBe(gatewayRpcUrl(expectedUrl));
  });

  it("uses url override in remote mode even when remote url is missing", async () => {
    loadConfig.mockReturnValue({
      gateway: { mode: "remote", bind: "loopback", remote: {} },
    });
    resolveGatewayPort.mockReturnValue(18789);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);

    await callGateway({
      method: "health",
      url: "wss://override.example/ws",
      token: "explicit-token",
    });

    expect(lastFetchCall().url).toBe("https://override.example/api/gateway/rpc");
    expect(lastFetchCredential()).toBe("explicit-token");
  });

  it("uses CRAWCLAW_GATEWAY_URL env override in remote mode when remote URL is missing", async () => {
    loadConfig.mockReturnValue({
      gateway: { mode: "remote", bind: "loopback", remote: {} },
    });
    resolveGatewayPort.mockReturnValue(18789);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);
    process.env.CRAWCLAW_GATEWAY_URL = "wss://gateway-in-container.internal:9443/ws";
    process.env.CRAWCLAW_GATEWAY_TOKEN = "env-token";

    await callGateway({
      method: "health",
    });

    expect(lastFetchCall().url).toBe("https://gateway-in-container.internal:9443/api/gateway/rpc");
    expect(lastFetchCredential()).toBe("env-token");
  });

  it("uses env URL override credentials without resolving local password SecretRefs", async () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        auth: {
          mode: "password",
          password: { source: "env", provider: "default", id: "MISSING_LOCAL_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);
    resolveGatewayPort.mockReturnValue(18789);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);
    process.env.CRAWCLAW_GATEWAY_URL = "wss://gateway-in-container.internal:9443/ws";
    process.env.CRAWCLAW_GATEWAY_TOKEN = "env-token";

    await callGateway({
      method: "health",
    });

    expect(lastFetchCall().url).toBe("https://gateway-in-container.internal:9443/api/gateway/rpc");
    expect(lastFetchCredential()).toBe("env-token");
  });

  it("uses remote tlsFingerprint with env URL override", async () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        remote: {
          url: "wss://remote.example:9443/ws",
          tlsFingerprint: "remote-fingerprint",
        },
      },
    });
    setGatewayNetworkDefaults(18789);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);
    process.env.CRAWCLAW_GATEWAY_URL = "wss://gateway-in-container.internal:9443/ws";
    process.env.CRAWCLAW_GATEWAY_TOKEN = "env-token";
    const fetchCalls: Array<{
      url: string;
      init?: RequestInit;
      options?: { tlsFingerprint?: string };
    }> = [];
    __testing.setDepsForTests({
      loadConfig: loadConfig as unknown as () => CrawClawConfig,
      resolveGatewayPort: resolveGatewayPort as unknown as (
        cfg?: CrawClawConfig,
        env?: NodeJS.ProcessEnv,
      ) => number,
      fetch: async (url: string, init?: RequestInit, options?: { tlsFingerprint?: string }) => {
        fetchCalls.push({ url, init, options });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ ok: true, result: { ok: true } }),
        } as Response;
      },
    } as never);

    await callGateway({
      method: "health",
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://gateway-in-container.internal:9443/api/gateway/rpc");
    expect(fetchCalls[0]?.options?.tlsFingerprint).toBe("remote-fingerprint");
  });

  it("does not apply remote tlsFingerprint for CLI url override", async () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        remote: {
          url: "wss://remote.example:9443/ws",
          tlsFingerprint: "remote-fingerprint",
        },
      },
    });
    setGatewayNetworkDefaults(18789);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);

    await callGateway({
      method: "health",
      url: "wss://override.example:9443/ws",
      token: "explicit-token",
    });

    expect(lastFetchCall().options?.tlsFingerprint).toBeUndefined();
  });

  it.each([
    {
      label: "default caller",
      call: () => callGateway({ method: "health" }),
    },
    {
      label: "explicit CLI caller",
      call: () => callGatewayCli({ method: "health" }),
    },
  ])("uses Rust HTTP RPC for $label", async ({ call }) => {
    setLocalLoopbackGatewayConfig();
    await call();
    expect(lastFetchCall().url).toBe("http://127.0.0.1:18789/api/gateway/rpc");
  });

  it("accepts explicit scope wrappers without using a WebSocket client path", async () => {
    setLocalLoopbackGatewayConfig();

    await callGatewayScoped({ method: "health", scopes: ["operator.read"] });
    expect(lastFetchCall().url).toBe("http://127.0.0.1:18789/api/gateway/rpc");

    await callGatewayScoped({ method: "health", scopes: [] });
    expect(lastFetchCall().url).toBe("http://127.0.0.1:18789/api/gateway/rpc");
  });

  it("uses Rust HTTP RPC by default when no WebSocket client override is installed", async () => {
    setLocalLoopbackGatewayConfig(18800);
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    __testing.setDepsForTests({
      loadConfig: loadConfig as unknown as () => CrawClawConfig,
      resolveGatewayPort: resolveGatewayPort as unknown as (
        cfg?: CrawClawConfig,
        env?: NodeJS.ProcessEnv,
      ) => number,
      fetch: async (url: string | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ ok: true, result: { ok: true } }),
        } as Response;
      },
    } as never);

    const result = await callGateway({ method: "health", token: "rpc-token" });

    expect(result).toEqual({ ok: true });
    expect(fetchCalls).toHaveLength(1);
    const fetchCall = fetchCalls[0];
    if (!fetchCall?.init || typeof fetchCall.init.body !== "string") {
      throw new Error("expected HTTP RPC fetch call with a string body");
    }
    const headers = fetchCall.init.headers as Record<string, string>;
    expect(fetchCall.url).toBe("http://127.0.0.1:18800/api/gateway/rpc");
    expect(fetchCall.init.method).toBe("POST");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-crawclaw-gateway-token"]).toBe("rpc-token");
    expect(JSON.parse(fetchCall.init.body)).toMatchObject({
      method: "health",
      params: {},
    });
  });
});

describe("buildGatewayConnectionDetails", () => {
  beforeEach(() => {
    resetGatewayCallMocks();
  });

  it("uses explicit url overrides and omits bind details", () => {
    setLocalLoopbackGatewayConfig(18800);
    pickPrimaryTailnetIPv4.mockReturnValue("100.64.0.1");

    const details = buildGatewayConnectionDetails({
      url: "wss://example.com/ws",
    });

    expect(details.url).toBe("wss://example.com/ws");
    expect(details.urlSource).toBe("cli --url");
    expect(details.bindDetail).toBeUndefined();
    expect(details.remoteFallbackNote).toBeUndefined();
    expect(details.message).toContain("Gateway target: wss://example.com/ws");
    expect(details.message).toContain("Source: cli --url");
  });

  it("emits a remote fallback note when remote url is missing", () => {
    loadConfig.mockReturnValue({
      gateway: { mode: "remote", bind: "loopback", remote: {} },
    });
    resolveGatewayPort.mockReturnValue(18789);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);

    const details = buildGatewayConnectionDetails();

    expect(details.url).toBe("ws://127.0.0.1:18789");
    expect(details.urlSource).toBe("missing gateway.remote.url (fallback local)");
    expect(details.bindDetail).toBe("Bind: loopback");
    expect(details.remoteFallbackNote).toContain(
      "gateway.mode=remote but gateway.remote.url is missing",
    );
    expect(details.message).toContain("Gateway target: ws://127.0.0.1:18789");
  });

  it.each([
    {
      label: "with TLS",
      gateway: { mode: "local", bind: "lan", tls: { enabled: true } },
      expectedUrl: "wss://127.0.0.1:18800",
    },
    {
      label: "without TLS",
      gateway: { mode: "local", bind: "lan" },
      expectedUrl: "ws://127.0.0.1:18800",
    },
  ])("uses loopback URL for bind=lan $label", ({ gateway, expectedUrl }) => {
    loadConfig.mockReturnValue({ gateway });
    resolveGatewayPort.mockReturnValue(18800);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);
    pickPrimaryLanIPv4.mockReturnValue("10.0.0.5");

    const details = buildGatewayConnectionDetails();

    expect(details.url).toBe(expectedUrl);
    expect(details.urlSource).toBe("local loopback");
    expect(details.bindDetail).toBe("Bind: lan");
  });

  it("prefers remote url when configured", () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "tailnet",
        remote: { url: "wss://remote.example.com/ws" },
      },
    });
    resolveGatewayPort.mockReturnValue(18800);
    pickPrimaryTailnetIPv4.mockReturnValue("100.64.0.9");

    const details = buildGatewayConnectionDetails();

    expect(details.url).toBe("wss://remote.example.com/ws");
    expect(details.urlSource).toBe("config gateway.remote.url");
    expect(details.bindDetail).toBeUndefined();
    expect(details.remoteFallbackNote).toBeUndefined();
  });

  it("uses env CRAWCLAW_GATEWAY_URL when set", () => {
    loadConfig.mockReturnValue({ gateway: { mode: "local", bind: "loopback" } });
    resolveGatewayPort.mockReturnValue(18800);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);
    const prevUrl = process.env.CRAWCLAW_GATEWAY_URL;
    try {
      process.env.CRAWCLAW_GATEWAY_URL = "wss://browser-gateway.local:9443/ws";

      const details = buildGatewayConnectionDetails();

      expect(details.url).toBe("wss://browser-gateway.local:9443/ws");
      expect(details.urlSource).toBe("env CRAWCLAW_GATEWAY_URL");
      expect(details.bindDetail).toBeUndefined();
    } finally {
      if (prevUrl === undefined) {
        delete process.env.CRAWCLAW_GATEWAY_URL;
      } else {
        process.env.CRAWCLAW_GATEWAY_URL = prevUrl;
      }
    }
  });

  it("falls back to the default config loader when test deps drift", () => {
    loadConfig.mockReturnValue({ gateway: { mode: "local", bind: "loopback" } });
    resolveGatewayPort.mockReturnValue(18800);
    __testing.setDepsForTests({
      loadConfig: {} as never,
    });

    const details = buildGatewayConnectionDetails();

    expect(details.url).toBe("ws://127.0.0.1:18800");
    expect(details.urlSource).toBe("local loopback");
  });

  it("throws for insecure ws:// remote URLs (CWE-319)", () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        remote: { url: "ws://remote.example.com:18789" },
      },
    });
    resolveGatewayPort.mockReturnValue(18789);
    pickPrimaryTailnetIPv4.mockReturnValue(undefined);

    let thrown: unknown;
    try {
      buildGatewayConnectionDetails();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("SECURITY ERROR");
    expect((thrown as Error).message).toContain("plaintext ws://");
    expect((thrown as Error).message).toContain("wss://");
    expect((thrown as Error).message).toContain("Tailscale Serve/Funnel");
    expect((thrown as Error).message).toContain("crawclaw doctor --fix");
  });

  it("allows ws:// private remote URLs only when CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS=1", () => {
    process.env.CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS = "1";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        remote: { url: "ws://10.0.0.8:18789" },
      },
    });
    resolveGatewayPort.mockReturnValue(18789);

    const details = buildGatewayConnectionDetails();

    expect(details.url).toBe("ws://10.0.0.8:18789");
    expect(details.urlSource).toBe("config gateway.remote.url");
  });

  it("allows ws:// hostname remote URLs when CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS=1", () => {
    process.env.CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS = "1";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        remote: { url: "ws://crawclaw-gateway.ai:18789" },
      },
    });
    resolveGatewayPort.mockReturnValue(18789);

    const details = buildGatewayConnectionDetails();

    expect(details.url).toBe("ws://crawclaw-gateway.ai:18789");
    expect(details.urlSource).toBe("config gateway.remote.url");
  });

  it("allows ws:// for loopback addresses in local mode", () => {
    setLocalLoopbackGatewayConfig();

    const details = buildGatewayConnectionDetails();

    expect(details.url).toBe("ws://127.0.0.1:18789");
  });
});

describe("callGateway error details", () => {
  beforeEach(() => {
    resetGatewayCallMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes connection details when HTTP RPC returns an error response", async () => {
    fetchMode = "http-error";
    setLocalLoopbackGatewayConfig();

    let err: Error | null = null;
    try {
      await callGateway({ method: "health" });
    } catch (caught) {
      err = caught as Error;
    }

    expect(err?.message).toContain("gateway HTTP RPC failed (503 Service Unavailable)");
    expect(err?.message).toContain("Gateway target: ws://127.0.0.1:18789");
    expect(err?.message).toContain("Source: local loopback");
    expect(err?.message).toContain("Bind: loopback");
  });

  it("includes connection details on timeout", async () => {
    fetchMode = "hang";
    setLocalLoopbackGatewayConfig();

    vi.useFakeTimers();
    let errMessage = "";
    const promise = callGateway({ method: "health", timeoutMs: 5 }).catch((caught) => {
      errMessage = caught instanceof Error ? caught.message : String(caught);
    });

    await vi.advanceTimersByTimeAsync(5);
    await promise;

    expect(errMessage).toContain("gateway timeout after 5ms");
    expect(errMessage).toContain("Gateway target: ws://127.0.0.1:18789");
    expect(errMessage).toContain("Source: local loopback");
    expect(errMessage).toContain("Bind: loopback");
  });

  it("does not overflow very large timeout values", async () => {
    setLocalLoopbackGatewayConfig();

    await expect(callGateway({ method: "health", timeoutMs: 2_592_010_000 })).resolves.toEqual({
      ok: true,
      status: "started",
    });
  });

  it("posts the requested method through HTTP RPC", async () => {
    setLocalLoopbackGatewayConfig();

    await callGateway({ method: "health", timeoutMs: 45_000 });

    expect(readFetchBody(lastFetchCall()).method).toBe("health");
  });

  it("uses Rust HTTP RPC by default for expectFinal requests", async () => {
    setLocalLoopbackGatewayConfig();

    await callGateway({ method: "health", expectFinal: true });

    expect(fetchCalls).toHaveLength(1);
  });

  it("fails fast when remote mode is missing remote url", async () => {
    loadConfig.mockReturnValue({
      gateway: { mode: "remote", bind: "loopback", remote: {} },
    });
    await expect(
      callGateway({
        method: "health",
        timeoutMs: 10,
      }),
    ).rejects.toThrow("gateway remote mode misconfigured");
  });

  it("fails before request when a required gateway method is missing", async () => {
    setLocalLoopbackGatewayConfig();
    gatewayMethods = ["health"];
    await expect(
      callGateway({
        method: "secrets.resolve",
        requiredMethods: ["secrets.resolve"],
      }),
    ).rejects.toThrow(/does not support required method "secrets\.resolve"/i);
  });
});

describe("callGateway url override auth requirements", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv([
      "CRAWCLAW_GATEWAY_TOKEN",
      "CRAWCLAW_GATEWAY_PASSWORD",
      "CRAWCLAW_GATEWAY_URL",
    ]);
    resetGatewayCallMocks();
    delete process.env.CRAWCLAW_GATEWAY_TOKEN;
    delete process.env.CRAWCLAW_GATEWAY_PASSWORD;
    delete process.env.CRAWCLAW_GATEWAY_URL;
    setGatewayNetworkDefaults(18789);
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("throws when url override is set without explicit credentials", async () => {
    process.env.CRAWCLAW_GATEWAY_TOKEN = "env-token";
    process.env.CRAWCLAW_GATEWAY_PASSWORD = "env-password";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        auth: { token: "local-token", password: "local-password" },
      },
    });

    await expect(
      callGateway({ method: "health", url: "wss://override.example/ws" }),
    ).rejects.toThrow("explicit credentials");
  });

  it("throws when env URL override is set without env credentials", async () => {
    process.env.CRAWCLAW_GATEWAY_URL = "wss://override.example/ws";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        auth: { token: "local-token", password: "local-password" },
      },
    });

    await expect(callGateway({ method: "health" })).rejects.toThrow("explicit credentials");
  });
});

describe("callGateway password resolution", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;
  const explicitAuthCases = [
    {
      label: "password",
      authKey: "password", // pragma: allowlist secret
      envKey: "CRAWCLAW_GATEWAY_PASSWORD",
      envValue: "from-env",
      configValue: "from-config",
      explicitValue: "explicit-password",
    },
    {
      label: "token",
      authKey: "token", // pragma: allowlist secret
      envKey: "CRAWCLAW_GATEWAY_TOKEN",
      envValue: "env-token",
      configValue: "local-token",
      explicitValue: "explicit-token",
    },
  ] as const;

  beforeEach(() => {
    envSnapshot = captureEnv([
      "CRAWCLAW_GATEWAY_PASSWORD",
      "CRAWCLAW_GATEWAY_TOKEN",
      "LOCAL_REMOTE_FALLBACK_TOKEN",
      "LOCAL_REF_PASSWORD",
      "REMOTE_REF_TOKEN",
      "REMOTE_REF_PASSWORD",
    ]);
    resetGatewayCallMocks();
    delete process.env.CRAWCLAW_GATEWAY_PASSWORD;
    delete process.env.CRAWCLAW_GATEWAY_TOKEN;
    delete process.env.LOCAL_REMOTE_FALLBACK_TOKEN;
    delete process.env.LOCAL_REF_PASSWORD;
    delete process.env.REMOTE_REF_TOKEN;
    delete process.env.REMOTE_REF_PASSWORD;
    setGatewayNetworkDefaults(18789);
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it.each([
    {
      label: "uses local config password when env is unset",
      envPassword: undefined,
      config: {
        gateway: {
          mode: "local",
          bind: "loopback",
          auth: { password: "secret" },
        },
      },
      expectedPassword: "secret",
    },
    {
      label: "prefers env password over local config password",
      envPassword: "from-env",
      config: {
        gateway: {
          mode: "local",
          bind: "loopback",
          auth: { password: "from-config" },
        },
      },
      expectedPassword: "from-env",
    },
    {
      label: "uses remote password in remote mode when env is unset",
      envPassword: undefined,
      config: makeRemotePasswordGatewayConfig("remote-secret"),
      expectedPassword: "remote-secret",
    },
    {
      label: "prefers env password over remote password in remote mode",
      envPassword: "from-env",
      config: makeRemotePasswordGatewayConfig("remote-secret"),
      expectedPassword: "from-env",
    },
  ])("$label", async ({ envPassword, config, expectedPassword }) => {
    if (envPassword !== undefined) {
      process.env.CRAWCLAW_GATEWAY_PASSWORD = envPassword;
    }
    loadConfig.mockReturnValue(config);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe(expectedPassword);
  });

  it("resolves gateway.auth.password SecretInput refs for gateway calls", async () => {
    process.env.LOCAL_REF_PASSWORD = "resolved-local-ref-password"; // pragma: allowlist secret
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        bind: "loopback",
        auth: {
          mode: "password",
          password: { source: "env", provider: "default", id: "LOCAL_REF_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("resolved-local-ref-password");
  });

  it("does not resolve local password ref when env password takes precedence", async () => {
    process.env.CRAWCLAW_GATEWAY_PASSWORD = "from-env";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        bind: "loopback",
        auth: {
          mode: "password",
          password: { source: "env", provider: "default", id: "MISSING_LOCAL_REF_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("from-env");
  });

  it("does not resolve local password ref when token auth can win", async () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        bind: "loopback",
        auth: {
          mode: "token",
          token: "token-auth",
          password: { source: "env", provider: "default", id: "MISSING_LOCAL_REF_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("token-auth");
  });

  it("resolves local password ref before unresolved local token ref can block auth", async () => {
    process.env.LOCAL_FALLBACK_PASSWORD = "resolved-local-fallback-password"; // pragma: allowlist secret
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        bind: "loopback",
        auth: {
          token: { source: "env", provider: "default", id: "MISSING_LOCAL_REF_TOKEN" },
          password: { source: "env", provider: "default", id: "LOCAL_FALLBACK_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("resolved-local-fallback-password"); // pragma: allowlist secret
  });

  it("fails closed when unresolved local token SecretRef would otherwise fall back to remote token", async () => {
    process.env.LOCAL_REMOTE_FALLBACK_TOKEN = "resolved-local-remote-fallback-token";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        bind: "loopback",
        auth: {
          mode: "token",
          token: { source: "env", provider: "default", id: "MISSING_LOCAL_REF_TOKEN" },
        },
        remote: {
          token: { source: "env", provider: "default", id: "LOCAL_REMOTE_FALLBACK_TOKEN" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await expect(callGateway({ method: "health" })).rejects.toThrow("gateway.auth.token");
  });

  it.each(["none", "trusted-proxy"] as const)(
    "ignores unresolved local password ref when auth mode is %s",
    async (mode) => {
      loadConfig.mockReturnValue({
        gateway: {
          mode: "local",
          bind: "loopback",
          auth: {
            mode,
            password: { source: "env", provider: "default", id: "MISSING_LOCAL_REF_PASSWORD" },
          },
        },
        secrets: {
          providers: {
            default: { source: "env" },
          },
        },
      } as unknown as CrawClawConfig);

      await callGateway({ method: "health" });

      expect(lastFetchCredential()).toBeUndefined();
    },
  );

  it("does not resolve local password ref when remote password is already configured", async () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        auth: {
          mode: "password",
          password: { source: "env", provider: "default", id: "MISSING_LOCAL_REF_PASSWORD" },
        },
        remote: {
          url: "wss://remote.example:18789",
          password: "remote-secret",
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("remote-secret");
  });

  it("resolves gateway.remote.token SecretInput refs when remote token is required", async () => {
    process.env.REMOTE_REF_TOKEN = "resolved-remote-ref-token";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        auth: {},
        remote: {
          url: "wss://remote.example:18789",
          token: { source: "env", provider: "default", id: "REMOTE_REF_TOKEN" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("resolved-remote-ref-token");
  });

  it("resolves gateway.remote.password SecretInput refs when remote password is required", async () => {
    process.env.REMOTE_REF_PASSWORD = "resolved-remote-ref-password"; // pragma: allowlist secret
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        auth: {},
        remote: {
          url: "wss://remote.example:18789",
          password: { source: "env", provider: "default", id: "REMOTE_REF_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("resolved-remote-ref-password");
  });

  it("does not resolve remote token ref when remote password already wins", async () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        auth: {},
        remote: {
          url: "wss://remote.example:18789",
          token: { source: "env", provider: "default", id: "MISSING_REMOTE_TOKEN" },
          password: "remote-password", // pragma: allowlist secret
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("remote-password");
  });

  it("resolves remote token ref before unresolved remote password ref can block auth", async () => {
    process.env.REMOTE_REF_TOKEN = "resolved-remote-ref-token";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        auth: {},
        remote: {
          url: "wss://remote.example:18789",
          token: { source: "env", provider: "default", id: "REMOTE_REF_TOKEN" },
          password: { source: "env", provider: "default", id: "MISSING_REMOTE_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("resolved-remote-ref-token");
  });

  it("does not resolve remote password ref when remote token already wins", async () => {
    loadConfig.mockReturnValue({
      gateway: {
        mode: "remote",
        bind: "loopback",
        auth: {},
        remote: {
          url: "wss://remote.example:18789",
          token: "remote-token",
          password: { source: "env", provider: "default", id: "MISSING_REMOTE_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("remote-token");
  });

  it("resolves remote token refs on local-mode calls when fallback token can win", async () => {
    process.env.LOCAL_FALLBACK_REMOTE_TOKEN = "resolved-local-fallback-remote-token";
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        bind: "loopback",
        auth: {},
        remote: {
          token: { source: "env", provider: "default", id: "LOCAL_FALLBACK_REMOTE_TOKEN" },
          password: { source: "env", provider: "default", id: "MISSING_REMOTE_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    } as unknown as CrawClawConfig);

    await callGateway({ method: "health" });

    expect(lastFetchCredential()).toBe("resolved-local-fallback-remote-token");
  });

  it.each(["none", "trusted-proxy"] as const)(
    "does not resolve remote refs on non-remote gateway calls when auth mode is %s",
    async (mode) => {
      loadConfig.mockReturnValue({
        gateway: {
          mode: "local",
          bind: "loopback",
          auth: { mode },
          remote: {
            url: "wss://remote.example:18789",
            token: { source: "env", provider: "default", id: "MISSING_REMOTE_TOKEN" },
            password: { source: "env", provider: "default", id: "MISSING_REMOTE_PASSWORD" },
          },
        },
        secrets: {
          providers: {
            default: { source: "env" },
          },
        },
      } as unknown as CrawClawConfig);

      await callGateway({ method: "health" });

      expect(lastFetchCredential()).toBeUndefined();
    },
  );

  it.each(explicitAuthCases)("uses explicit $label when url override is set", async (testCase) => {
    process.env[testCase.envKey] = testCase.envValue;
    const auth = { [testCase.authKey]: testCase.configValue } as {
      password?: string;
      token?: string;
    };
    loadConfig.mockReturnValue({
      gateway: {
        mode: "local",
        auth,
      },
    });

    await callGateway({
      method: "health",
      url: "wss://override.example/ws",
      [testCase.authKey]: testCase.explicitValue,
    });

    expect(lastFetchCredential()).toBe(testCase.explicitValue);
  });
});

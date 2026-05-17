import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchState = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; init?: RequestInit; options?: { tlsFingerprint?: string } }>,
}));

const { __testing, clampProbeTimeoutMs, probeGateway } = await import("./probe.js");

function readProbeFetchMethod(call: { init?: RequestInit }): string | undefined {
  if (typeof call.init?.body !== "string") {
    throw new Error("expected probe fetch call body to be a string");
  }
  return (JSON.parse(call.init.body) as { method?: string }).method;
}

describe("probeGateway", () => {
  beforeEach(() => {
    fetchState.calls = [];
    __testing.setFetchForTests(
      async (url: string, init?: RequestInit, options?: { tlsFingerprint?: string }) => {
        fetchState.calls.push({ url, init, options });
        const requestUrl = new URL(url);
        if (requestUrl.pathname === "/health") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ ok: true }),
          } as Response;
        }
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            ok: true,
            result: body.method === "system-presence" ? [] : {},
          }),
        } as Response;
      },
    );
  });

  afterEach(() => {
    __testing.resetDepsForTests();
  });

  it("clamps probe timeout to timer-safe bounds", () => {
    expect(clampProbeTimeoutMs(1)).toBe(250);
    expect(clampProbeTimeoutMs(2_000)).toBe(2_000);
    expect(clampProbeTimeoutMs(3_000_000_000)).toBe(2_147_483_647);
  });
  it("uses Rust HTTP RPC for full detail probes by default", async () => {
    const result = await probeGateway({
      url: "ws://127.0.0.1:18789",
      auth: { token: "secret" },
      timeoutMs: 1_000,
    });

    expect(fetchState.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/gateway/rpc",
      "/api/gateway/rpc",
      "/api/gateway/rpc",
      "/api/gateway/rpc",
    ]);
    expect(fetchState.calls.map(readProbeFetchMethod)).toEqual([
      "health",
      "status",
      "system-presence",
      "config.get",
    ]);
    expect(
      (fetchState.calls[0]?.init?.headers as Record<string, string>)?.["x-crawclaw-gateway-token"],
    ).toBe("secret");
    expect(result.ok).toBe(true);
  });

  it("skips detail RPCs for lightweight reachability probes", async () => {
    const result = await probeGateway({
      url: "ws://127.0.0.1:18789",
      timeoutMs: 1_000,
      includeDetails: false,
    });

    expect(result.ok).toBe(true);
    expect(fetchState.calls.map((call) => new URL(call.url).pathname)).toEqual(["/health"]);
  });

  it("uses token auth for authenticated lightweight probes", async () => {
    const result = await probeGateway({
      url: "ws://127.0.0.1:18789",
      auth: { token: "secret" },
      timeoutMs: 1_000,
      includeDetails: false,
    });

    expect(result.ok).toBe(true);
    expect(fetchState.calls).toHaveLength(1);
    expect(
      (fetchState.calls[0]?.init?.headers as Record<string, string>)?.["x-crawclaw-gateway-token"],
    ).toBe("secret");
  });

  it("fetches only presence for presence-only probes", async () => {
    const result = await probeGateway({
      url: "ws://127.0.0.1:18789",
      timeoutMs: 1_000,
      detailLevel: "presence",
    });

    expect(result.ok).toBe(true);
    expect(fetchState.calls.map(readProbeFetchMethod)).toEqual(["system-presence"]);
    expect(result.health).toBeNull();
    expect(result.status).toBeNull();
    expect(result.configSnapshot).toBeNull();
  });

  it("passes through tls fingerprints for secure daemon probes", async () => {
    await probeGateway({
      url: "wss://gateway.example/ws",
      auth: { token: "secret" },
      tlsFingerprint: "sha256:abc",
      timeoutMs: 1_000,
      includeDetails: false,
    });

    expect(fetchState.calls).toHaveLength(1);
    expect(fetchState.calls[0]?.url).toBe("https://gateway.example/health");
    expect(fetchState.calls[0]?.options?.tlsFingerprint).toBe("sha256:abc");
  });

  it("surfaces pinned HTTP probe failures", async () => {
    __testing.setFetchForTests(async () => {
      throw new Error("gateway tls fingerprint mismatch");
    });

    const result = await probeGateway({
      url: "wss://gateway.example/ws",
      auth: { token: "secret" },
      tlsFingerprint: "sha256:abc",
      timeoutMs: 5_000,
      includeDetails: false,
    });

    expect(result).toMatchObject({
      ok: false,
      error: "gateway tls fingerprint mismatch",
      close: null,
    });
    expect(fetchState.calls).toEqual([]);
  });
});

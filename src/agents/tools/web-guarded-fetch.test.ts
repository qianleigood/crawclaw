import { afterEach, describe, expect, it, vi } from "vitest";
import * as fetchGuardModule from "../../infra/net/fetch-guard.js";
import { withStrictWebToolsEndpoint, withTrustedWebToolsEndpoint } from "./web-guarded-fetch.js";

describe("web-guarded-fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses trusted SSRF policy for trusted web tools endpoints", async () => {
    const fetchSpy = vi.spyOn(fetchGuardModule, "fetchWithSsrFGuard").mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://example.com",
      release: async () => {},
    });

    await withTrustedWebToolsEndpoint({ url: "https://example.com" }, async () => undefined);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        policy: expect.objectContaining({
          dangerouslyAllowPrivateNetwork: true,
          allowRfc2544BenchmarkRange: true,
        }),
        mode: fetchGuardModule.GUARDED_FETCH_MODE.TRUSTED_ENV_PROXY,
      }),
    );
  });

  it("keeps strict endpoint policy unchanged", async () => {
    const fetchSpy = vi.spyOn(fetchGuardModule, "fetchWithSsrFGuard").mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://example.com",
      release: async () => {},
    });

    await withStrictWebToolsEndpoint({ url: "https://example.com" }, async () => undefined);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
      }),
    );
    const call = fetchSpy.mock.calls[0]?.[0];
    expect(call?.policy).toBeUndefined();
    expect(call?.mode).toBe(fetchGuardModule.GUARDED_FETCH_MODE.STRICT);
  });
});

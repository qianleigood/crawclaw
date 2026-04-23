import { afterEach, describe, expect, it, vi } from "vitest";
import { clearServerInfoCache, fetchBlueBubblesServerInfo } from "./probe.js";
import { _setFetchGuardForTesting } from "./types.js";

describe("fetchBlueBubblesServerInfo", () => {
  afterEach(() => {
    clearServerInfoCache();
    _setFetchGuardForTesting(null);
  });

  it("does not reuse server info when the same account points at different credentials", async () => {
    const fetchMock = vi.fn(async ({ url }: { url: string }) => {
      const rawUrl = String(url);
      const version = rawUrl.includes("server-two.example") ? "two" : "one";
      return {
        response: new Response(JSON.stringify({ data: { server_version: version } }), {
          status: 200,
        }),
        release: async () => {},
      };
    });
    _setFetchGuardForTesting(fetchMock as never);

    const first = await fetchBlueBubblesServerInfo({
      accountId: "acct-1",
      baseUrl: "https://server-one.example",
      password: "password-one", // pragma: allowlist secret
    });
    const second = await fetchBlueBubblesServerInfo({
      accountId: "acct-1",
      baseUrl: "https://server-two.example",
      password: "password-two", // pragma: allowlist secret
    });

    expect(first?.server_version).toBe("one");
    expect(second?.server_version).toBe("two");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccessToken } from "./client.js";
import type { ResolvedDingTalkAccount } from "./types.js";

function makeAccount(overrides: Partial<ResolvedDingTalkAccount>): ResolvedDingTalkAccount {
  return {
    accountId: "default",
    enabled: true,
    clientId: "client-1",
    clientSecret: "secret-1", // pragma: allowlist secret
    tokenSource: "config",
    allowFrom: [],
    groupPolicy: "open",
    groupAllowFrom: [],
    groups: {},
    ...overrides,
  };
}

describe("getAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reuse tokens across accounts with the same clientId and different secrets", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { appSecret?: string };
      return new Response(
        JSON.stringify({
          accessToken: `token:${body.appSecret ?? "missing"}`,
          expireIn: 7200,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getAccessToken(
      makeAccount({ accountId: "acct-a", clientId: "shared-client", clientSecret: "secret-a" }), // pragma: allowlist secret
    );
    const second = await getAccessToken(
      makeAccount({ accountId: "acct-b", clientId: "shared-client", clientSecret: "secret-b" }), // pragma: allowlist secret
    );

    expect(first).toBe("token:secret-a"); // pragma: allowlist secret
    expect(second).toBe("token:secret-b"); // pragma: allowlist secret
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ssrf from "../../infra/net/ssrf.js";
import { type FetchMock, withFetchPreconnect } from "../../test-utils/fetch-mock.js";
import { makeFetchHeaders } from "./web-fetch.test-harness.js";

const lookupMock = vi.fn();
const resolvePinnedHostnameWithPolicy = ssrf.resolvePinnedHostnameWithPolicy;

function redirectResponse(location: string): Response {
  return {
    ok: false,
    status: 302,
    headers: makeFetchHeaders({ location }),
    body: { cancel: vi.fn() },
  } as unknown as Response;
}

function textResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    headers: makeFetchHeaders({ "content-type": "text/plain" }),
    text: async () => body,
  } as unknown as Response;
}

function setMockFetch(
  impl: FetchMock = async (_input: RequestInfo | URL, _init?: RequestInit) => textResponse(""),
) {
  const fetchSpy = vi.fn<FetchMock>(impl);
  global.fetch = withFetchPreconnect(fetchSpy);
  return fetchSpy;
}

async function createWebFetchToolForTest() {
  const { createWebFetchTool } = await import("./web-tools.js");
  return createWebFetchTool({
    config: {
      plugins: {
        entries: {
          "scrapling-fetch": {
            enabled: false,
          },
        },
      },
      tools: {
        web: {
          fetch: {
            cacheTtlMinutes: 0,
          },
        },
      },
    },
  });
}

describe("web_fetch default network policy", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    lookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === "localhost") {
        return [{ address: "127.0.0.1", family: 4 }];
      }
      if (hostname === "127.0.0.1") {
        return [{ address: "127.0.0.1", family: 4 }];
      }
      if (hostname === "::ffff:127.0.0.1") {
        return [{ address: "::ffff:127.0.0.1", family: 6 }];
      }
      return [{ address: "93.184.216.34", family: 4 }];
    });
    vi.spyOn(ssrf, "resolvePinnedHostnameWithPolicy").mockImplementation((hostname, options) =>
      resolvePinnedHostnameWithPolicy(hostname, {
        lookupFn: lookupMock,
        policy: options?.policy,
      }),
    );
  });

  afterEach(() => {
    global.fetch = priorFetch;
    lookupMock.mockClear();
    vi.restoreAllMocks();
  });

  it("allows localhost hostnames by default", async () => {
    const fetchSpy = setMockFetch().mockResolvedValue(textResponse("ok"));
    const tool = await createWebFetchToolForTest();

    const result = await tool?.execute?.("call", { url: "http://localhost/test" });
    expect(result?.details).toMatchObject({
      status: 200,
      extractor: "raw",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows private IP literals by default", async () => {
    const fetchSpy = setMockFetch().mockResolvedValue(textResponse("ok"));
    const tool = await createWebFetchToolForTest();

    const cases = ["http://127.0.0.1/test", "http://[::ffff:127.0.0.1]/"] as const;
    for (const url of cases) {
      const result = await tool?.execute?.("call", { url });
      expect(result?.details).toMatchObject({
        status: 200,
        extractor: "raw",
      });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(cases.length);
    expect(lookupMock).toHaveBeenCalledTimes(cases.length);
  });

  it("allows hosts whose DNS resolves to private addresses", async () => {
    lookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === "public.test") {
        return [{ address: "93.184.216.34", family: 4 }];
      }
      return [{ address: "10.0.0.5", family: 4 }];
    });

    const fetchSpy = setMockFetch().mockResolvedValue(textResponse("ok"));
    const tool = await createWebFetchToolForTest();

    const result = await tool?.execute?.("call", { url: "https://private.test/resource" });
    expect(result?.details).toMatchObject({
      status: 200,
      extractor: "raw",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows redirects to private hosts by default", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    const fetchSpy = setMockFetch()
      .mockResolvedValueOnce(redirectResponse("http://127.0.0.1/secret"))
      .mockResolvedValueOnce(textResponse("ok"));
    const tool = await createWebFetchToolForTest();

    const result = await tool?.execute?.("call", { url: "https://example.com" });
    expect(result?.details).toMatchObject({
      status: 200,
      extractor: "raw",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("allows benchmark-range addresses used by fake-ip DNS", async () => {
    lookupMock.mockResolvedValue([{ address: "198.18.0.173", family: 4 }]);

    setMockFetch().mockResolvedValue(textResponse("ok"));
    const tool = await createWebFetchToolForTest();

    const result = await tool?.execute?.("call", { url: "https://openai.com" });
    expect(result?.details).toMatchObject({
      status: 200,
      extractor: "raw",
    });
  });
});

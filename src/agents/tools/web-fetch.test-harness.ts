import { afterEach, beforeEach, vi } from "vitest";
import * as ssrf from "../../infra/net/ssrf.js";

export function makeFetchHeaders(map: Record<string, string>): {
  get: (key: string) => string | null;
} {
  return {
    get: (key) => map[key.toLowerCase()] ?? null,
  };
}

export function installWebFetchSsrfHarness() {
  const lookupMock = vi.fn();
  const resolvePinnedHostnameWithPolicy = ssrf.resolvePinnedHostnameWithPolicy;
  const priorFetch = global.fetch;

  beforeEach(() => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.spyOn(ssrf, "resolvePinnedHostnameWithPolicy").mockImplementation((hostname) =>
      resolvePinnedHostnameWithPolicy(hostname, { lookupFn: lookupMock }),
    );
  });

  afterEach(() => {
    global.fetch = priorFetch;
    lookupMock.mockReset();
    vi.restoreAllMocks();
  });
}

export function createBaseWebFetchToolConfig(opts?: { maxResponseBytes?: number }): {
  config: {
    plugins: {
      entries: {
        "scrapling-fetch": {
          enabled: boolean;
        };
      };
    };
    tools: {
      web: {
        fetch: {
          cacheTtlMinutes: number;
          maxResponseBytes?: number;
        };
      };
    };
  };
} {
  return {
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
            ...(opts?.maxResponseBytes ? { maxResponseBytes: opts.maxResponseBytes } : {}),
          },
        },
      },
    },
  };
}

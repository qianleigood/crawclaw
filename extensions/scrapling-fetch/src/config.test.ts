import { describe, expect, it } from "vitest";
import {
  buildScraplingFetchEndpoint,
  resolveScraplingFetchPluginConfig,
  resolveScraplingFetchBaseUrl,
  SCRAPLING_FETCH_DEFAULT_BASE_URL,
  SCRAPLING_FETCH_DEFAULT_BOOTSTRAP_PACKAGES,
  SCRAPLING_FETCH_DEFAULT_FETCH_PATH,
  SCRAPLING_FETCH_DEFAULT_STARTUP_TIMEOUT_MS,
  SCRAPLING_FETCH_DEFAULT_TIMEOUT_SECONDS,
} from "./config.js";

describe("resolveScraplingFetchPluginConfig", () => {
  it("returns managed-runtime defaults when plugin config is absent", () => {
    const resolved = resolveScraplingFetchPluginConfig(undefined as never);

    expect(resolved.webFetch.timeoutSeconds).toBe(SCRAPLING_FETCH_DEFAULT_TIMEOUT_SECONDS);
    expect(resolved.webFetch.onlyMainContent).toBe(true);
    expect(resolved.service.enabled).toBe(true);
    expect(resolved.service.mode).toBe("python-http");
    expect(resolved.service.baseUrl).toBe(SCRAPLING_FETCH_DEFAULT_BASE_URL);
    expect(resolved.service.bootstrap).toBe(true);
    expect(resolved.service.bootstrapPackages).toEqual([
      ...SCRAPLING_FETCH_DEFAULT_BOOTSTRAP_PACKAGES,
    ]);
    expect(resolved.service.startupTimeoutMs).toBe(SCRAPLING_FETCH_DEFAULT_STARTUP_TIMEOUT_MS);
    expect(resolved.service.fetchPath).toBe(SCRAPLING_FETCH_DEFAULT_FETCH_PATH);
    expect(resolveScraplingFetchBaseUrl(resolved)).toBe(SCRAPLING_FETCH_DEFAULT_BASE_URL);
  });

  it("normalizes plugin-owned overrides", () => {
    const resolved = resolveScraplingFetchPluginConfig({
      plugins: {
        entries: {
          "scrapling-fetch": {
            config: {
              webFetch: {
                timeoutSeconds: 42,
                onlyMainContent: false,
              },
              service: {
                enabled: false,
                baseUrl: "http://127.0.0.1:9999",
                command: "python",
                args: ["-m", "scrapling_service"],
                bootstrap: false,
                bootstrapPackages: ["Scrapling==0.4.4", "patchright==1.58.2"],
                startupTimeoutMs: 999,
                fetchPath: "fetch-v2",
              },
            },
          },
        },
      },
    } as never);

    expect(resolved.webFetch.timeoutSeconds).toBe(42);
    expect(resolved.webFetch.onlyMainContent).toBe(false);
    expect(resolved.service.enabled).toBe(false);
    expect(resolved.service.baseUrl).toBe("http://127.0.0.1:9999");
    expect(resolved.service.command).toBe("python");
    expect(resolved.service.args).toEqual(["-m", "scrapling_service"]);
    expect(resolved.service.bootstrap).toBe(false);
    expect(resolved.service.bootstrapPackages).toEqual(["Scrapling==0.4.4", "patchright==1.58.2"]);
    expect(resolved.service.startupTimeoutMs).toBe(999);
    expect(resolved.service.fetchPath).toBe("/fetch-v2");
  });

  it("falls back to pinned package defaults when bootstrapPackages is empty", () => {
    const resolved = resolveScraplingFetchPluginConfig({
      plugins: {
        entries: {
          "scrapling-fetch": {
            config: {
              service: {
                bootstrapPackages: [" ", ""],
              },
            },
          },
        },
      },
    } as never);

    expect(resolved.service.bootstrapPackages).toEqual([
      ...SCRAPLING_FETCH_DEFAULT_BOOTSTRAP_PACKAGES,
    ]);
  });

  it("builds sidecar endpoints from base URL and path", () => {
    expect(buildScraplingFetchEndpoint("http://127.0.0.1:32119", "/fetch")).toBe(
      "http://127.0.0.1:32119/fetch",
    );
  });
});

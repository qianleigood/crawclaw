import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import {
  nativeBundledWebFetchProvidersForPlugin,
  nativeBundledWebSearchProvidersForPlugin,
} from "./native-bundled-web-providers.js";

const callGateway = vi.hoisted(() =>
  vi.fn(async (request: { params?: { tool?: string; input?: unknown } }) => ({
    input: request.params?.input,
    tool: request.params?.tool,
  })),
);

vi.mock("../gateway/call.js", () => ({
  callGateway,
}));

describe("native bundled web providers", () => {
  beforeEach(() => {
    callGateway.mockClear();
  });

  it("routes open-websearch provider tools through the Rust runtime worker", async () => {
    const [provider] = nativeBundledWebSearchProvidersForPlugin("open-websearch");
    const config = {
      plugins: {
        entries: {
          "open-websearch": {
            enabled: true,
            config: { webSearch: { baseUrl: "http://127.0.0.1:3210" } },
          },
        },
      },
    } as CrawClawConfig;

    const tool = provider?.createTool({ config, searchConfig: {} });
    await tool?.execute({
      query: "rust native plugin",
      count: 3,
      engines: ["duckduckgo"],
      timeoutSeconds: 5,
    });

    expect(callGateway).toHaveBeenCalledWith({
      method: "tools.invoke",
      params: {
        tool: "web_search",
        input: {
          query: "rust native plugin",
          count: 3,
          engines: ["duckduckgo"],
          timeoutSeconds: 5,
          pluginConfig: { webSearch: { baseUrl: "http://127.0.0.1:3210" } },
        },
      },
    });
  });

  it("routes scrapling-fetch provider tools through the Rust runtime worker", async () => {
    const [provider] = nativeBundledWebFetchProvidersForPlugin("scrapling-fetch");
    const config = {
      plugins: {
        entries: {
          "scrapling-fetch": {
            enabled: true,
            config: { webFetch: { timeoutSeconds: 20 } },
          },
        },
      },
    } as CrawClawConfig;

    const tool = provider?.createTool({ config, fetchConfig: {} });
    await tool?.execute({
      url: "https://example.com",
      output: "markdown",
      render: "auto",
      mainContentOnly: true,
      timeoutSeconds: 10,
    });

    expect(callGateway).toHaveBeenCalledWith({
      method: "tools.invoke",
      params: {
        tool: "web_fetch",
        input: {
          url: "https://example.com",
          output: "markdown",
          extractMode: undefined,
          detail: undefined,
          render: "auto",
          extract: undefined,
          maxChars: undefined,
          timeoutSeconds: 10,
          mainContentOnly: true,
          waitUntil: undefined,
          waitFor: undefined,
          sessionId: undefined,
          pluginConfig: { webFetch: { timeoutSeconds: 20 } },
        },
      },
    });
  });
});

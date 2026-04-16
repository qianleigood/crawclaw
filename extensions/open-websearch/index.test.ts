import type { CrawClawPluginApi } from "crawclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";

const daemonMocks = vi.hoisted(() => ({
  startManagedOpenWebSearchDaemonService: vi.fn(async () => "http://127.0.0.1:3210"),
  stopManagedOpenWebSearchDaemonService: vi.fn(async () => {}),
}));

const providerMocks = vi.hoisted(() => ({
  createOpenWebSearchProvider: vi.fn(() => ({ id: "open-websearch" })),
}));

vi.mock("crawclaw/plugin-sdk/open-websearch-runtime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("crawclaw/plugin-sdk/open-websearch-runtime")>();
  return {
    ...actual,
    startManagedOpenWebSearchDaemonService: daemonMocks.startManagedOpenWebSearchDaemonService,
    stopManagedOpenWebSearchDaemonService: daemonMocks.stopManagedOpenWebSearchDaemonService,
    createOpenWebSearchProvider: providerMocks.createOpenWebSearchProvider,
  };
});

import openWebSearchPlugin from "./index.js";

function createApi() {
  const registerService = vi.fn();
  const registerWebSearchProvider = vi.fn();
  const api = createTestPluginApi({
    id: "open-websearch",
    name: "Open-WebSearch Plugin",
    source: "test",
    config: {},
    runtime: {} as CrawClawPluginApi["runtime"],
    registerService,
    registerWebSearchProvider,
  }) as CrawClawPluginApi;
  return { api, registerService, registerWebSearchProvider };
}

describe("open-websearch plugin", () => {
  it("registers the provider and gateway-managed daemon service", async () => {
    const { api, registerService, registerWebSearchProvider } = createApi();

    openWebSearchPlugin.register(api);

    expect(providerMocks.createOpenWebSearchProvider).toHaveBeenCalledTimes(1);
    expect(registerWebSearchProvider).toHaveBeenCalledWith({ id: "open-websearch" });

    const service = registerService.mock.calls[0]?.[0];
    expect(service?.id).toBe("open-websearch-daemon");

    await service.start({ config: { marker: "cfg" } });
    expect(daemonMocks.startManagedOpenWebSearchDaemonService).toHaveBeenCalledWith({
      config: { marker: "cfg" },
    });

    await service.stop({ config: { marker: "cfg" } });
    expect(daemonMocks.stopManagedOpenWebSearchDaemonService).toHaveBeenCalledWith({
      config: { marker: "cfg" },
    });
  });
});

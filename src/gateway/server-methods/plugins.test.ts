import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildPluginSnapshotReport: vi.fn(),
  installPluginWithRustLifecycle: vi.fn(),
  setPluginEnabledWithRustLifecycle: vi.fn(),
}));

vi.mock("../../plugins/status.js", () => ({
  buildPluginSnapshotReport: mocks.buildPluginSnapshotReport,
}));

vi.mock("../../plugins/rust-lifecycle.js", () => ({
  installPluginWithRustLifecycle: mocks.installPluginWithRustLifecycle,
  setPluginEnabledWithRustLifecycle: mocks.setPluginEnabledWithRustLifecycle,
}));

import { coreGatewayHandlers } from "../legacy-ts-gateway-handlers.js";

describe("gateway plugins.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the runtime plugin snapshot", async () => {
    mocks.buildPluginSnapshotReport.mockReturnValue({
      workspaceDir: "/tmp/workspace",
      plugins: [
        {
          id: "browser",
          name: "@crawclaw/browser-plugin",
          status: "loaded",
          origin: "bundled",
          source: "/tmp/browser/index.ts",
          enabled: true,
          toolNames: [],
          hookNames: [],
          channelIds: [],
          cliBackendIds: [],
          providerIds: [],
          speechProviderIds: [],
          mediaUnderstandingProviderIds: [],
          webFetchProviderIds: [],
          webSearchProviderIds: [],
          gatewayMethods: [],
          cliCommands: [],
          services: [],
          commands: [],
          httpRoutes: 0,
          hookCount: 0,
          configSchema: true,
        },
      ],
      diagnostics: [],
    });

    const respond = vi.fn();
    const handler = coreGatewayHandlers["plugins.list"];

    expect(handler).toBeTypeOf("function");
    if (!handler) {
      return;
    }

    await handler({
      req: { type: "req", id: "req-1", method: "plugins.list", params: {} },
      params: {},
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(mocks.buildPluginSnapshotReport).toHaveBeenCalledWith();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        workspaceDir: "/tmp/workspace",
        plugins: [
          expect.objectContaining({
            id: "browser",
            name: "@crawclaw/browser-plugin",
            status: "loaded",
            configSchema: true,
          }),
        ],
        diagnostics: [],
      }),
      undefined,
    );
  });

  it("maps snapshot failures to UNAVAILABLE", async () => {
    mocks.buildPluginSnapshotReport.mockImplementation(() => {
      throw new Error("boom");
    });

    const respond = vi.fn();
    const handler = coreGatewayHandlers["plugins.list"];

    expect(handler).toBeTypeOf("function");
    if (!handler) {
      return;
    }

    await handler({
      req: { type: "req", id: "req-1", method: "plugins.list", params: {} },
      params: {},
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: expect.stringContaining("boom"),
      }),
    );
  });

  it("enables plugins through the Rust lifecycle helper", async () => {
    mocks.setPluginEnabledWithRustLifecycle.mockResolvedValue({
      ok: true,
      value: {
        id: "browser",
        enabled: true,
      },
    });

    const respond = vi.fn();
    const handler = coreGatewayHandlers["plugins.enable"];

    expect(handler).toBeTypeOf("function");
    if (!handler) {
      return;
    }

    await handler({
      req: {
        type: "req",
        id: "req-2",
        method: "plugins.enable",
        params: { id: "browser", baseHash: "cfg-1" },
      },
      params: { id: "browser", baseHash: "cfg-1" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(mocks.setPluginEnabledWithRustLifecycle).toHaveBeenCalledWith({
      id: "browser",
      enabled: true,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        id: "browser",
        enabled: true,
      },
      undefined,
    );
  });

  it("disables plugins through the Rust lifecycle helper", async () => {
    mocks.setPluginEnabledWithRustLifecycle.mockResolvedValue({
      ok: true,
      value: {
        id: "browser",
        enabled: false,
      },
    });

    const respond = vi.fn();
    const handler = coreGatewayHandlers["plugins.disable"];

    expect(handler).toBeTypeOf("function");
    if (!handler) {
      return;
    }

    await handler({
      req: {
        type: "req",
        id: "req-3",
        method: "plugins.disable",
        params: { id: "browser" },
      },
      params: { id: "browser" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(mocks.setPluginEnabledWithRustLifecycle).toHaveBeenCalledWith({
      id: "browser",
      enabled: false,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        id: "browser",
        enabled: false,
      },
      undefined,
    );
  });

  it("installs plugins through the Rust lifecycle helper", async () => {
    mocks.installPluginWithRustLifecycle.mockResolvedValue({
      ok: true,
      value: {
        pluginId: "matrix",
        warnings: [],
        requiresRestart: true,
        installSource: "npm",
      },
    });

    const respond = vi.fn();
    const handler = coreGatewayHandlers["plugins.install"];

    expect(handler).toBeTypeOf("function");
    if (!handler) {
      return;
    }

    await handler({
      req: {
        type: "req",
        id: "req-4",
        method: "plugins.install",
        params: { raw: "@crawclaw/matrix", baseHash: "cfg-1" },
      },
      params: { raw: "@crawclaw/matrix", baseHash: "cfg-1" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(mocks.installPluginWithRustLifecycle).toHaveBeenCalledWith({
      raw: "@crawclaw/matrix",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        pluginId: "matrix",
        warnings: [],
        requiresRestart: true,
        installSource: "npm",
      },
      undefined,
    );
  });
});

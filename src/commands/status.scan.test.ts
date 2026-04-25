import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyStatusScanDefaults,
  createStatusScanSharedMocks,
  createStatusScanConfig,
  createStatusSummary,
  loadStatusScanModuleForTest,
  withTemporaryEnv,
} from "./status.scan.test-helpers.js";

const mocks = {
  ...createStatusScanSharedMocks("status-scan"),
  buildChannelsTable: vi.fn(),
  callGateway: vi.fn(),
};

let originalForceStderr: boolean;
let loggingStateRef: typeof import("../logging/state.js").loggingState;
let scanStatus: typeof import("./status.scan.js").scanStatus;

beforeEach(async () => {
  vi.clearAllMocks();
  configureScanStatus();
  ({ scanStatus } = await loadStatusScanModuleForTest(mocks));
  ({ loggingState: loggingStateRef } = await import("../logging/state.js"));
  originalForceStderr = loggingStateRef.forceConsoleToStderr;
  loggingStateRef.forceConsoleToStderr = false;
});

afterEach(() => {
  loggingStateRef.forceConsoleToStderr = originalForceStderr;
});

function configureScanStatus(
  options: {
    hasConfiguredChannels?: boolean;
    sourceConfig?: ReturnType<typeof createStatusScanConfig>;
    resolvedConfig?: ReturnType<typeof createStatusScanConfig>;
    summary?: ReturnType<typeof createStatusSummary>;
    update?: false;
    gatewayProbe?: false;
  } = {},
) {
  const sourceConfig = options.sourceConfig ?? createStatusScanConfig();
  const resolvedConfig = options.resolvedConfig ?? sourceConfig;

  applyStatusScanDefaults(mocks, {
    hasConfiguredChannels: options.hasConfiguredChannels,
    sourceConfig,
    resolvedConfig,
    summary: options.summary,
    update: options.update,
    gatewayProbe: options.gatewayProbe,
  });
  mocks.buildChannelsTable.mockResolvedValue({
    rows: [],
    details: [],
  });
  mocks.callGateway.mockResolvedValue(null);
}

describe("scanStatus", () => {
  const reachableGatewayProbe = {
    ok: true,
    url: "ws://127.0.0.1:18789",
    connectLatencyMs: 12,
    error: null,
    close: null,
    health: null,
    status: null,
    presence: null,
    configSnapshot: null,
  };

  it("passes sourceConfig into buildChannelsTable for summary-mode status output", async () => {
    configureScanStatus({
      sourceConfig: createStatusScanConfig({
        marker: "source",
        plugins: { enabled: false },
      }),
      resolvedConfig: createStatusScanConfig({
        marker: "resolved",
        plugins: { enabled: false },
      }),
      summary: createStatusSummary({ linkChannel: { linked: false } }),
    });

    await scanStatus({ json: false }, {} as never);

    expect(mocks.buildChannelsTable).toHaveBeenCalledWith(
      expect.objectContaining({ marker: "resolved" }),
      expect.objectContaining({
        sourceConfig: expect.objectContaining({ marker: "source" }),
      }),
    );
  });

  it("skips channel plugin preload for status --json with no channel config", async () => {
    configureScanStatus({
      sourceConfig: createStatusScanConfig({
        plugins: { enabled: false },
      }),
      resolvedConfig: createStatusScanConfig({
        plugins: { enabled: false },
      }),
    });

    await scanStatus({ json: true, all: true }, {} as never);

    expect(mocks.ensurePluginRegistryLoaded).not.toHaveBeenCalled();
  });

  it("skips plugin compatibility loading for status --json when the config file is missing", async () => {
    configureScanStatus({
      sourceConfig: createStatusScanConfig({
        plugins: { enabled: true },
      }),
      resolvedConfig: createStatusScanConfig({
        plugins: { enabled: true },
      }),
    });

    await scanStatus({ json: true, all: true }, {} as never);

    expect(mocks.buildPluginCompatibilityNotices).not.toHaveBeenCalled();
  });

  it("skips plugin compatibility loading for status --json even with configured channels", async () => {
    configureScanStatus({
      hasConfiguredChannels: true,
      sourceConfig: createStatusScanConfig({
        channels: { discord: {} },
      }),
      resolvedConfig: createStatusScanConfig({
        channels: { discord: {} },
      }),
    });

    await scanStatus({ json: true, all: true }, {} as never);

    expect(mocks.buildPluginCompatibilityNotices).not.toHaveBeenCalled();
  });

  it("skips gateway and update probes on cold-start status paths", async () => {
    configureScanStatus({
      sourceConfig: createStatusScanConfig({
        plugins: { enabled: false },
      }),
      resolvedConfig: createStatusScanConfig({
        plugins: { enabled: false },
      }),
      update: false,
      gatewayProbe: false,
    });

    await scanStatus({ json: true }, {} as never);
    await scanStatus({ json: false }, {} as never);

    expect(mocks.getUpdateCheckResult).not.toHaveBeenCalled();
    expect(mocks.probeGateway).not.toHaveBeenCalled();
  });

  it("preloads configured channel plugins for status --json when channel config exists", async () => {
    configureScanStatus({
      hasConfiguredChannels: true,
      sourceConfig: createStatusScanConfig({
        plugins: { enabled: false },
        channels: { telegram: { enabled: false } },
      }),
      resolvedConfig: createStatusScanConfig({
        plugins: { enabled: false },
        channels: { telegram: { enabled: false } },
      }),
      summary: createStatusSummary({ linkChannel: { linked: false } }),
    });

    await scanStatus({ json: true, all: true }, {} as never);

    expect(mocks.ensurePluginRegistryLoaded).toHaveBeenCalledWith({
      scope: "configured-channels",
      preferSetupRuntimeForChannelPlugins: true,
    });
    // Verify plugin logs were routed to stderr during loading and restored after
    expect(loggingStateRef.forceConsoleToStderr).toBe(false);
    expect(mocks.probeGateway).toHaveBeenCalledWith(
      expect.objectContaining({ detailLevel: "presence" }),
    );
    expect(mocks.callGateway).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "channels.status" }),
    );
  });

  it("keeps default status --json off the live gateway probe path", async () => {
    configureScanStatus({
      hasConfiguredChannels: true,
      sourceConfig: createStatusScanConfig({
        plugins: { enabled: false },
        channels: { telegram: { enabled: false } },
      }),
      resolvedConfig: createStatusScanConfig({
        plugins: { enabled: false },
        channels: { telegram: { enabled: false } },
      }),
      summary: createStatusSummary({ linkChannel: { linked: false } }),
      gatewayProbe: false,
    });

    await scanStatus({ json: true }, {} as never);

    expect(mocks.ensurePluginRegistryLoaded).not.toHaveBeenCalled();
    expect(mocks.getUpdateCheckResult).not.toHaveBeenCalled();
    expect(mocks.getStatusSummary).not.toHaveBeenCalled();
    expect(mocks.probeGateway).not.toHaveBeenCalled();
  });

  it("preloads configured channel plugins for status --json when channel auth is env-only", async () => {
    configureScanStatus({
      hasConfiguredChannels: true,
      sourceConfig: createStatusScanConfig({
        plugins: { enabled: false },
      }),
      resolvedConfig: createStatusScanConfig({
        plugins: { enabled: false },
      }),
      summary: createStatusSummary({ linkChannel: { linked: false } }),
    });

    await withTemporaryEnv({ MATRIX_ACCESS_TOKEN: "token" }, async () => {
      await scanStatus({ json: true, all: true }, {} as never);
    });

    expect(mocks.ensurePluginRegistryLoaded).toHaveBeenCalledWith({
      scope: "configured-channels",
      preferSetupRuntimeForChannelPlugins: true,
    });
  });

  it("captures Feishu CLI user status separately during status --json scans", async () => {
    configureScanStatus({
      hasConfiguredChannels: true,
      sourceConfig: createStatusScanConfig({
        channels: { feishu: { enabled: true } },
      }),
      resolvedConfig: createStatusScanConfig({
        channels: { feishu: { enabled: true } },
      }),
      gatewayProbe: reachableGatewayProbe as never,
    });
    mocks.callGateway.mockResolvedValue({
      identity: "user",
      installed: true,
      authOk: true,
      status: "ready",
      version: "1.0.7",
    });

    const result = await scanStatus({ json: true, all: true }, {} as never);

    expect(result.feishuCli).toEqual({
      supported: true,
      error: null,
      status: expect.objectContaining({
        identity: "user",
        status: "ready",
        version: "1.0.7",
      }),
    });
    expect(mocks.callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "feishu.cli.status",
      }),
    );
  });
});

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
  ...createStatusScanSharedMocks("status-fast-json"),
  callGateway: vi.fn(),
  getStatusCommandSecretTargetIds: vi.fn(() => []),
};

let originalForceStderr: boolean;
let loggingStateRef: typeof import("../logging/state.js").loggingState;
let scanStatusJsonFast: typeof import("./status.scan.fast-json.js").scanStatusJsonFast;

beforeEach(async () => {
  vi.clearAllMocks();
  applyStatusScanDefaults(mocks, {
    sourceConfig: createStatusScanConfig(),
    resolvedConfig: createStatusScanConfig(),
    summary: createStatusSummary({ byAgent: [] }),
  });
  mocks.getStatusCommandSecretTargetIds.mockReturnValue([]);
  mocks.callGateway.mockResolvedValue(null);
  ({ scanStatusJsonFast } = await loadStatusScanModuleForTest(mocks, { fastJson: true }));
  ({ loggingState: loggingStateRef } = await import("../logging/state.js"));
  originalForceStderr = loggingStateRef.forceConsoleToStderr;
  loggingStateRef.forceConsoleToStderr = false;
});

afterEach(() => {
  loggingStateRef.forceConsoleToStderr = originalForceStderr;
});

describe("scanStatusJsonFast", () => {
  const reachableGatewayProbe = {
    ok: true,
    url: "ws://127.0.0.1:18789",
    connectLatencyMs: 10,
    error: null,
    close: null,
    health: null,
    status: null,
    presence: null,
    configSnapshot: null,
  };

  it("routes plugin logs to stderr during deferred plugin loading", async () => {
    mocks.hasPotentialConfiguredChannels.mockReturnValue(true);
    const config = createStatusScanConfig({
      channels: { telegram: { token: "test-token" } },
    });
    applyStatusScanDefaults(mocks, {
      hasConfiguredChannels: true,
      sourceConfig: config,
      resolvedConfig: config,
      summary: createStatusSummary({ byAgent: [] }),
    });

    let stderrDuringLoad = false;
    mocks.ensurePluginRegistryLoaded.mockImplementation(() => {
      stderrDuringLoad = loggingStateRef.forceConsoleToStderr;
    });

    await scanStatusJsonFast({}, {} as never);

    expect(mocks.ensurePluginRegistryLoaded).toHaveBeenCalled();
    expect(stderrDuringLoad).toBe(true);
    expect(loggingStateRef.forceConsoleToStderr).toBe(false);
  });

  it("skips plugin compatibility loading even when configured channels are present", async () => {
    mocks.hasPotentialConfiguredChannels.mockReturnValue(true);
    const config = createStatusScanConfig({
      channels: { telegram: { token: "test-token" } },
    });
    applyStatusScanDefaults(mocks, {
      hasConfiguredChannels: true,
      sourceConfig: config,
      resolvedConfig: config,
      summary: createStatusSummary({ byAgent: [] }),
    });

    await scanStatusJsonFast({}, {} as never);

    expect(mocks.buildPluginCompatibilityNotices).not.toHaveBeenCalled();
  });

  it("skips gateway and update probes on cold-start status --json", async () => {
    await withTemporaryEnv(
      {
        VITEST: undefined,
        VITEST_POOL_ID: undefined,
        NODE_ENV: undefined,
      },
      async () => {
        await scanStatusJsonFast({}, {} as never);
      },
    );

    expect(mocks.getUpdateCheckResult).not.toHaveBeenCalled();
    expect(mocks.probeGateway).not.toHaveBeenCalled();
  });

  it("captures Feishu CLI support status during the fast JSON scan", async () => {
    const config = createStatusScanConfig();
    applyStatusScanDefaults(mocks, {
      sourceConfig: config,
      resolvedConfig: config,
      summary: createStatusSummary({ byAgent: [] }),
      gatewayProbe: reachableGatewayProbe as never,
    });
    mocks.callGateway?.mockRejectedValueOnce(new Error("unknown method: feishu.cli.status"));

    const result = await scanStatusJsonFast({}, {} as never);

    expect(result.feishuCli).toEqual({
      supported: false,
      status: null,
      error: null,
    });
  });
});

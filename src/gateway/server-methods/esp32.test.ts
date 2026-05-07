import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext, GatewayRequestHandlerOptions, RespondFn } from "./types.js";

const hoisted = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  getEsp32PluginRuntimeMock: vi.fn(),
  getEsp32ServiceMock: vi.fn(),
  isEsp32PluginEnabledMock: vi.fn(),
  issueEsp32PairingSessionMock: vi.fn(),
  listEsp32PairingSessionsMock: vi.fn(),
  revokeEsp32PairingSessionMock: vi.fn(),
  readEsp32PluginConfigFromCrawClawConfigMock: vi.fn(),
  listDevicePairingMock: vi.fn(),
  approveDevicePairingMock: vi.fn(),
  rejectDevicePairingMock: vi.fn(),
  removePairedDeviceMock: vi.fn(),
  getPairedDeviceMock: vi.fn(),
  hasEffectivePairedDeviceRoleMock: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: hoisted.loadConfigMock,
}));

vi.mock("@crawclaw/esp32/api.js", () => ({
  ESP32_DEVICE_ROLE: "esp32",
  ESP32_HARDWARE_TARGET: "ESP32-S3-BOX-3",
  getEsp32PluginRuntime: hoisted.getEsp32PluginRuntimeMock,
  getEsp32Service: hoisted.getEsp32ServiceMock,
  isEsp32PluginEnabled: hoisted.isEsp32PluginEnabledMock,
  issueEsp32PairingSession: hoisted.issueEsp32PairingSessionMock,
  listEsp32PairingSessions: hoisted.listEsp32PairingSessionsMock,
  revokeEsp32PairingSession: hoisted.revokeEsp32PairingSessionMock,
  readEsp32PluginConfigFromCrawClawConfig: hoisted.readEsp32PluginConfigFromCrawClawConfigMock,
}));

vi.mock("../../infra/device-pairing.js", () => ({
  listDevicePairing: hoisted.listDevicePairingMock,
  approveDevicePairing: hoisted.approveDevicePairingMock,
  rejectDevicePairing: hoisted.rejectDevicePairingMock,
  removePairedDevice: hoisted.removePairedDeviceMock,
  getPairedDevice: hoisted.getPairedDeviceMock,
  hasEffectivePairedDeviceRole: hoisted.hasEffectivePairedDeviceRoleMock,
}));

async function loadHandlers() {
  const mod = await import("./esp32.js");
  return mod.esp32Handlers;
}

function createContext(): GatewayRequestContext {
  return {
    deps: {} as GatewayRequestContext["deps"],
    cron: {} as GatewayRequestContext["cron"],
    cronStorePath: "",
    loadGatewayModelCatalog: async () => [],
    getHealthCache: () => null,
    refreshHealthSnapshot: async () => ({}) as never,
    logHealth: { error() {} },
    logGateway: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    } as unknown as GatewayRequestContext["logGateway"],
    incrementPresenceVersion: () => 0,
    getHealthVersion: () => 0,
    broadcast() {},
    broadcastToConnIds() {},
    nodeSendToSession() {},
    nodeSendToAllSubscribed() {},
    nodeSubscribe() {},
    nodeUnsubscribe() {},
    nodeUnsubscribeAll() {},
    hasConnectedMobileNode: () => false,
    nodeRegistry: {} as GatewayRequestContext["nodeRegistry"],
    agentRunSeq: new Map(),
    chatAbortControllers: new Map(),
    chatAbortedRuns: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    chatDeltaLastBroadcastLen: new Map(),
    addChatRun() {},
    removeChatRun() {
      return undefined;
    },
    subscribeSessionEvents() {},
    unsubscribeSessionEvents() {},
    subscribeSessionMessageEvents() {},
    unsubscribeSessionMessageEvents() {},
    unsubscribeAllSessionEvents() {},
    getSessionEventSubscriberConnIds: () => new Set(),
    registerToolEventRecipient() {},
    dedupe: new Map(),
    wizardSessions: new Map(),
    findRunningWizard: () => null,
    purgeWizardSession() {},
    getRuntimeSnapshot: () =>
      ({}) as GatewayRequestContext["getRuntimeSnapshot"] extends () => infer T ? T : never,
    startChannel: async () => {},
    stopChannel: async () => {},
    markChannelLoggedOut() {},
    wizardRunner: async () => {},
    broadcastVoiceWakeChanged() {},
    disconnectClientsForDevice() {},
  };
}

function createOptions(
  method: string,
  params: Record<string, unknown>,
): {
  respond: RespondFn;
  payloads: Array<{ ok: boolean; payload?: unknown; error?: unknown }>;
  options: GatewayRequestHandlerOptions;
} {
  const payloads: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond: RespondFn = (ok, payload, error) => {
    payloads.push({ ok, payload, error });
  };
  return {
    respond,
    payloads,
    options: {
      req: { type: "req", id: "1", method, params },
      params,
      client: {
        connect: {
          role: "operator",
          scopes: ["operator.read", "operator.write", "operator.admin"],
        } as never,
      },
      isWebchatConnect: () => false,
      respond,
      context: createContext(),
    },
  };
}

describe("esp32 gateway handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hoisted.loadConfigMock.mockReturnValue({ plugins: { entries: { esp32: { enabled: true } } } });
    hoisted.isEsp32PluginEnabledMock.mockReturnValue(true);
    hoisted.getEsp32PluginRuntimeMock.mockReturnValue({
      state: {
        resolveStateDir: () => "/tmp/crawclaw-state",
      },
    });
    hoisted.readEsp32PluginConfigFromCrawClawConfigMock.mockReturnValue({
      broker: { bindHost: "0.0.0.0", port: 1883, advertisedHost: "127.0.0.1" },
      udp: { bindHost: "0.0.0.0", port: 1884, advertisedHost: "127.0.0.1" },
      renderer: { model: "openai/gpt-5.4-mini" },
      tts: { provider: "qwen3-tts", target: "voice-note" },
      tools: { allowlist: ["display.*"], highRiskRequiresApproval: true },
    });
  });

  it("returns esp32 status and filters non-esp32 pairing entries", async () => {
    const handlers = await loadHandlers();
    hoisted.listEsp32PairingSessionsMock.mockResolvedValue([
      {
        pairId: "pair-1",
        username: "pair:pair-1",
        name: "desk",
        hardwareTarget: "ESP32-S3-BOX-3",
        issuedAtMs: 10,
        expiresAtMs: 20,
      },
    ]);
    hoisted.listDevicePairingMock.mockResolvedValue({
      pending: [
        {
          requestId: "req-esp32",
          deviceId: "esp32-1",
          publicKey: "fingerprint-1",
          deviceFamily: "ESP32-S3-BOX-3",
          clientMode: "mqtt-udp",
          ts: 100,
        },
        {
          requestId: "req-other",
          deviceId: "other-1",
          publicKey: "fingerprint-2",
          deviceFamily: "other",
          clientMode: "other",
          ts: 50,
        },
      ],
      paired: [
        {
          deviceId: "esp32-1",
          publicKey: "fingerprint-1",
          deviceFamily: "ESP32-S3-BOX-3",
          clientMode: "mqtt-udp",
          approvedAtMs: 200,
        },
      ],
    });
    hoisted.getEsp32ServiceMock.mockReturnValue({
      listStoredDevices: vi.fn().mockResolvedValue([
        {
          deviceId: "esp32-1",
          name: "Desk",
          fingerprint: "fingerprint-1",
          capabilities: { display: { width: 320, height: 240, color: true } },
          lastSeenAtMs: 300,
        },
      ]),
      listOnlineDevices: vi.fn().mockReturnValue([
        {
          deviceId: "esp32-1",
          capabilities: { tools: [{ name: "display.text" }] },
          lastSeenAtMs: 400,
        },
      ]),
    });
    hoisted.hasEffectivePairedDeviceRoleMock.mockReturnValue(false);

    const { options, payloads } = createOptions("esp32.status.get", {});
    await handlers["esp32.status.get"](options);

    expect(payloads[0]?.ok).toBe(true);
    expect(payloads[0]?.payload).toMatchObject({
      counts: {
        activePairingSessions: 1,
        pendingRequests: 1,
        pairedDevices: 1,
        onlineDevices: 1,
      },
      activePairingSessions: [
        expect.objectContaining({
          pairId: "pair-1",
        }),
      ],
    });
  });

  it("revokes an esp32 device and drops the stored profile", async () => {
    const handlers = await loadHandlers();
    const removeStoredDevice = vi.fn().mockResolvedValue(true);
    hoisted.getEsp32ServiceMock.mockReturnValue({
      removeStoredDevice,
    });
    hoisted.removePairedDeviceMock.mockResolvedValue({ deviceId: "esp32-1" });

    const { options, payloads } = createOptions("esp32.devices.revoke", { deviceId: "esp32-1" });
    await handlers["esp32.devices.revoke"](options);

    expect(payloads[0]?.ok).toBe(true);
    expect(hoisted.removePairedDeviceMock).toHaveBeenCalledWith("esp32-1", "/tmp/crawclaw-state");
    expect(removeStoredDevice).toHaveBeenCalledWith("esp32-1");
  });

  it("revokes an active esp32 pairing session", async () => {
    const handlers = await loadHandlers();
    hoisted.revokeEsp32PairingSessionMock.mockResolvedValue(true);

    const { options, payloads } = createOptions("esp32.pairing.session.revoke", {
      pairId: "pair-1",
    });
    await handlers["esp32.pairing.session.revoke"](options);

    expect(payloads[0]?.ok).toBe(true);
    expect(payloads[0]?.payload).toEqual({ pairId: "pair-1" });
    expect(hoisted.revokeEsp32PairingSessionMock).toHaveBeenCalledWith(
      "/tmp/crawclaw-state",
      "pair-1",
    );
  });
});

import {
  ESP32_DEVICE_ROLE,
  ESP32_HARDWARE_TARGET,
  getEsp32PluginRuntime,
  getEsp32Service,
  isEsp32PluginEnabled,
  issueEsp32PairingSession,
  listEsp32PairingSessions,
  readEsp32PluginConfigFromCrawClawConfig,
  revokeEsp32PairingSession,
} from "@crawclaw/esp32/api.js";
import { loadConfig } from "../../config/config.js";
import {
  approveDevicePairing,
  getPairedDevice,
  hasEffectivePairedDeviceRole,
  listDevicePairing,
  rejectDevicePairing,
  removePairedDevice,
} from "../../infra/device-pairing.js";
import type { PairedDevice } from "../../infra/device-pairing.js";
import {
  ErrorCodes,
  errorShape,
  validateEsp32DeviceCommandSendParams,
  validateEsp32DeviceGetParams,
  validateEsp32DeviceRevokeParams,
  validateEsp32DevicesListParams,
  validateEsp32PairingRequestApproveParams,
  validateEsp32PairingRequestRejectParams,
  validateEsp32PairingSessionRevokeParams,
  validateEsp32PairingRequestsListParams,
  validateEsp32PairingStartParams,
  validateEsp32StatusGetParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

function isEsp32PendingRequest(request: {
  role?: string;
  roles?: string[];
  deviceFamily?: string;
  clientMode?: string;
}): boolean {
  const roles = new Set(
    [request.role, ...(request.roles ?? [])].filter((value): value is string => !!value),
  );
  return (
    roles.has(ESP32_DEVICE_ROLE) ||
    request.deviceFamily === ESP32_HARDWARE_TARGET ||
    request.clientMode === "mqtt-udp"
  );
}

function isEsp32PairedDevice(
  device: Pick<PairedDevice, "role" | "roles" | "tokens"> & {
    deviceFamily?: string;
    clientMode?: string;
  },
): boolean {
  return (
    hasEffectivePairedDeviceRole(device, ESP32_DEVICE_ROLE) ||
    device.deviceFamily === ESP32_HARDWARE_TARGET ||
    device.clientMode === "mqtt-udp"
  );
}

function resolveEsp32StateDir(): string | null {
  return getEsp32PluginRuntime()?.state.resolveStateDir() ?? null;
}

async function buildEsp32Overview(baseDir: string) {
  const service = getEsp32Service();
  const pairing = await listDevicePairing(baseDir);
  const storedDevices = await service?.listStoredDevices();
  const storedById = new Map((storedDevices ?? []).map((device) => [device.deviceId, device]));
  const onlineById = new Map(
    (service?.listOnlineDevices() ?? []).map((device) => [device.deviceId, device]),
  );
  const pending = pairing.pending
    .filter((request) => isEsp32PendingRequest(request))
    .map((request) => {
      const stored = storedById.get(request.deviceId);
      return {
        requestId: request.requestId,
        deviceId: request.deviceId,
        name: request.displayName ?? stored?.name,
        fingerprint: request.publicKey || stored?.fingerprint,
        hardwareTarget:
          request.deviceFamily ?? stored?.capabilities.hardwareTarget ?? ESP32_HARDWARE_TARGET,
        clientMode: request.clientMode ?? "mqtt-udp",
        requestedAtMs: request.ts,
        capabilities: stored?.capabilities ?? {},
      };
    });
  const paired = pairing.paired
    .filter((device) => isEsp32PairedDevice(device))
    .map((device) => {
      const stored = storedById.get(device.deviceId);
      const online = onlineById.get(device.deviceId);
      return {
        deviceId: device.deviceId,
        name: device.displayName ?? stored?.name,
        fingerprint: device.publicKey || stored?.fingerprint,
        hardwareTarget:
          device.deviceFamily ?? stored?.capabilities.hardwareTarget ?? ESP32_HARDWARE_TARGET,
        clientMode: device.clientMode ?? "mqtt-udp",
        online: Boolean(online),
        lastSeenAtMs: online?.lastSeenAtMs ?? stored?.lastSeenAtMs,
        approvedAtMs: device.approvedAtMs,
        capabilities: online?.capabilities ?? stored?.capabilities ?? {},
      };
    });
  return { pending, paired };
}

function requireEsp32Service() {
  const service = getEsp32Service();
  if (!service) {
    return {
      ok: false as const,
      error: errorShape(ErrorCodes.UNAVAILABLE, "ESP32 plugin service is not running"),
    };
  }
  return { ok: true as const, service };
}

export const esp32Handlers: GatewayRequestHandlers = {
  "esp32.status.get": async ({ params, respond }) => {
    if (!assertValidParams(params, validateEsp32StatusGetParams, "esp32.status.get", respond)) {
      return;
    }
    const cfg = loadConfig();
    const esp32Config = readEsp32PluginConfigFromCrawClawConfig(cfg);
    const stateDir = resolveEsp32StateDir();
    const sessions = stateDir ? await listEsp32PairingSessions(stateDir) : [];
    const overview = stateDir ? await buildEsp32Overview(stateDir) : { pending: [], paired: [] };
    respond(
      true,
      {
        enabled: isEsp32PluginEnabled(cfg),
        serviceRunning: Boolean(getEsp32Service()),
        broker: esp32Config.broker,
        udp: esp32Config.udp,
        renderer: esp32Config.renderer,
        tts: esp32Config.tts,
        tools: esp32Config.tools,
        counts: {
          activePairingSessions: sessions.length,
          pendingRequests: overview.pending.length,
          pairedDevices: overview.paired.length,
          onlineDevices: overview.paired.filter((device) => device.online).length,
        },
        activePairingSessions: sessions.map((session) => ({
          pairId: session.pairId,
          username: session.username,
          name: session.name,
          hardwareTarget: session.hardwareTarget,
          issuedAtMs: session.issuedAtMs,
          expiresAtMs: session.expiresAtMs,
        })),
      },
      undefined,
    );
  },
  "esp32.pairing.start": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateEsp32PairingStartParams, "esp32.pairing.start", respond)
    ) {
      return;
    }
    const cfg = loadConfig();
    if (!isEsp32PluginEnabled(cfg)) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "ESP32 plugin is disabled"));
      return;
    }
    const stateDir = resolveEsp32StateDir();
    if (!stateDir) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "ESP32 plugin runtime is unavailable"),
      );
      return;
    }
    const p = params as { name?: string; ttlMs?: number };
    const session = await issueEsp32PairingSession({
      stateDir,
      name: p.name,
      ttlMs: p.ttlMs ?? 5 * 60 * 1000,
    });
    const esp32Config = readEsp32PluginConfigFromCrawClawConfig(cfg);
    respond(
      true,
      {
        pairId: session.pairId,
        username: session.username,
        pairCode: session.password,
        name: session.name,
        hardwareTarget: session.hardwareTarget,
        issuedAtMs: session.issuedAtMs,
        expiresAtMs: session.expiresAtMs,
        broker: {
          host: esp32Config.broker.advertisedHost ?? esp32Config.broker.bindHost,
          port: esp32Config.broker.port,
        },
        udp: {
          host: esp32Config.udp.advertisedHost ?? esp32Config.udp.bindHost,
          port: esp32Config.udp.port,
        },
        profile: session.profile,
      },
      undefined,
    );
  },
  "esp32.pairing.requests.list": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateEsp32PairingRequestsListParams,
        "esp32.pairing.requests.list",
        respond,
      )
    ) {
      return;
    }
    const stateDir = resolveEsp32StateDir();
    if (!stateDir) {
      respond(true, { items: [] }, undefined);
      return;
    }
    const overview = await buildEsp32Overview(stateDir);
    respond(true, { items: overview.pending }, undefined);
  },
  "esp32.pairing.session.revoke": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateEsp32PairingSessionRevokeParams,
        "esp32.pairing.session.revoke",
        respond,
      )
    ) {
      return;
    }
    const p = params as { pairId: string };
    const stateDir = resolveEsp32StateDir();
    if (!stateDir) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "ESP32 plugin runtime is unavailable"),
      );
      return;
    }
    const revoked = await revokeEsp32PairingSession(stateDir, p.pairId);
    if (!revoked) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown pairId"));
      return;
    }
    respond(true, { pairId: p.pairId }, undefined);
  },
  "esp32.pairing.request.approve": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateEsp32PairingRequestApproveParams,
        "esp32.pairing.request.approve",
        respond,
      )
    ) {
      return;
    }
    const p = params as { requestId: string };
    const stateDir = resolveEsp32StateDir();
    if (!stateDir) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "ESP32 plugin runtime is unavailable"),
      );
      return;
    }
    const callerScopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
    const approved = await approveDevicePairing(p.requestId, { callerScopes }, stateDir);
    if (!approved) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
      return;
    }
    if (approved.status === "forbidden") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `missing scope: ${approved.missingScope}`),
      );
      return;
    }
    respond(true, { requestId: approved.requestId, deviceId: approved.device.deviceId }, undefined);
  },
  "esp32.pairing.request.reject": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateEsp32PairingRequestRejectParams,
        "esp32.pairing.request.reject",
        respond,
      )
    ) {
      return;
    }
    const p = params as { requestId: string };
    const stateDir = resolveEsp32StateDir();
    if (!stateDir) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "ESP32 plugin runtime is unavailable"),
      );
      return;
    }
    const rejected = await rejectDevicePairing(p.requestId, stateDir);
    if (!rejected) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
      return;
    }
    respond(true, rejected, undefined);
  },
  "esp32.devices.list": async ({ params, respond }) => {
    if (!assertValidParams(params, validateEsp32DevicesListParams, "esp32.devices.list", respond)) {
      return;
    }
    const stateDir = resolveEsp32StateDir();
    if (!stateDir) {
      respond(true, { items: [] }, undefined);
      return;
    }
    const overview = await buildEsp32Overview(stateDir);
    respond(true, { items: overview.paired }, undefined);
  },
  "esp32.devices.get": async ({ params, respond }) => {
    if (!assertValidParams(params, validateEsp32DeviceGetParams, "esp32.devices.get", respond)) {
      return;
    }
    const p = params as { deviceId: string };
    const stateDir = resolveEsp32StateDir();
    if (!stateDir) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "ESP32 plugin runtime is unavailable"),
      );
      return;
    }
    const paired = await getPairedDevice(p.deviceId, stateDir);
    if (!paired || !isEsp32PairedDevice(paired)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown ESP32 device"));
      return;
    }
    const service = getEsp32Service();
    const stored = await service?.getStoredDevice(p.deviceId);
    const online = service?.listOnlineDevices().find((device) => device.deviceId === p.deviceId);
    respond(
      true,
      {
        deviceId: paired.deviceId,
        name: paired.displayName ?? stored?.name,
        fingerprint: paired.publicKey || stored?.fingerprint,
        hardwareTarget:
          paired.deviceFamily ?? stored?.capabilities.hardwareTarget ?? ESP32_HARDWARE_TARGET,
        clientMode: paired.clientMode ?? "mqtt-udp",
        online: Boolean(online),
        lastSeenAtMs: online?.lastSeenAtMs ?? stored?.lastSeenAtMs,
        approvedAtMs: paired.approvedAtMs,
        capabilities: online?.capabilities ?? stored?.capabilities ?? {},
        paired,
      },
      undefined,
    );
  },
  "esp32.devices.revoke": async ({ params, respond, context }) => {
    if (
      !assertValidParams(params, validateEsp32DeviceRevokeParams, "esp32.devices.revoke", respond)
    ) {
      return;
    }
    const p = params as { deviceId: string };
    const stateDir = resolveEsp32StateDir();
    if (!stateDir) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "ESP32 plugin runtime is unavailable"),
      );
      return;
    }
    const removed = await removePairedDevice(p.deviceId, stateDir);
    if (!removed) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown deviceId"));
      return;
    }
    await getEsp32Service()?.removeStoredDevice(p.deviceId);
    respond(true, removed, undefined);
    queueMicrotask(() => {
      context.disconnectClientsForDevice?.(removed.deviceId);
    });
  },
  "esp32.devices.command.send": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateEsp32DeviceCommandSendParams,
        "esp32.devices.command.send",
        respond,
      )
    ) {
      return;
    }
    const serviceState = requireEsp32Service();
    if (!serviceState.ok) {
      respond(false, undefined, serviceState.error);
      return;
    }
    const p = params as { deviceId: string; text: string };
    const result = await serviceState.service.sendDisplayText({
      deviceId: p.deviceId,
      text: p.text,
    });
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
      return;
    }
    respond(true, { ok: true }, undefined);
  },
};

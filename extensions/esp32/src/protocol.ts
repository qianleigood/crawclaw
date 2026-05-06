import type { Esp32Affect, Esp32DeviceCapabilities } from "./types.js";

export const ESP32_MQTT_PREFIX = "crawclaw/esp32";

export type Esp32PairingHelloMessage = {
  deviceId: string;
  fingerprint?: string;
  name?: string;
  capabilities?: Esp32DeviceCapabilities;
};

export type Esp32DeviceHelloMessage = Esp32PairingHelloMessage & {
  udp?: {
    host?: string;
    port?: number;
  };
};

export type Esp32TextInputMessage = {
  text: string;
  sessionId?: string;
};

export type Esp32ToolResultMessage = {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type Esp32OutboundMessage =
  | { type: "state"; state: string; affect?: Esp32Affect }
  | { type: "reply"; spokenText: string; displayText: string; affect: Esp32Affect; audio?: unknown }
  | Record<string, unknown>;

export function parseJsonObject(text: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text.toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizePairingHello(
  raw: Record<string, unknown>,
): Esp32PairingHelloMessage | null {
  const deviceId = readString(raw.deviceId);
  if (!deviceId) {
    return null;
  }
  return {
    deviceId,
    ...(readString(raw.fingerprint) ? { fingerprint: readString(raw.fingerprint) } : {}),
    ...(readString(raw.name) ? { name: readString(raw.name) } : {}),
    ...(raw.capabilities && typeof raw.capabilities === "object" && !Array.isArray(raw.capabilities)
      ? { capabilities: raw.capabilities as Esp32DeviceCapabilities }
      : {}),
  };
}

export function normalizeDeviceHello(raw: Record<string, unknown>): Esp32DeviceHelloMessage | null {
  const base = normalizePairingHello(raw);
  if (!base) {
    return null;
  }
  const udp = raw.udp && typeof raw.udp === "object" ? (raw.udp as Record<string, unknown>) : null;
  return {
    ...base,
    ...(udp
      ? {
          udp: {
            ...(readString(udp.host) ? { host: readString(udp.host) } : {}),
            ...(readNumber(udp.port) ? { port: readNumber(udp.port) } : {}),
          },
        }
      : {}),
  };
}

export function normalizeTextInput(raw: Record<string, unknown>): Esp32TextInputMessage | null {
  const text = readString(raw.text);
  if (!text) {
    return null;
  }
  return {
    text,
    ...(readString(raw.sessionId) ? { sessionId: readString(raw.sessionId) } : {}),
  };
}

export function normalizeToolResult(raw: Record<string, unknown>): Esp32ToolResultMessage | null {
  const requestId = readString(raw.requestId);
  if (!requestId) {
    return null;
  }
  return {
    requestId,
    ok: raw.ok === true,
    result: raw.result,
    ...(readString(raw.error) ? { error: readString(raw.error) } : {}),
  };
}

export function deviceCommandTopic(deviceId: string): string {
  return `${ESP32_MQTT_PREFIX}/devices/${deviceId}/command`;
}

export function deviceStatusTopic(deviceId: string): string {
  return `${ESP32_MQTT_PREFIX}/devices/${deviceId}/status`;
}

export function pairingStatusTopic(pairId: string): string {
  return `${ESP32_MQTT_PREFIX}/pair/${pairId}/status`;
}

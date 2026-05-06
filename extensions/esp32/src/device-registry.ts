import { randomUUID } from "node:crypto";
import type { Esp32DeviceCapabilities, Esp32DeviceToolRisk, Esp32ToolCallResult } from "./types.js";

type PendingToolCall = {
  deviceId: string;
  resolve: (result: Esp32ToolCallResult) => void;
  timeout: NodeJS.Timeout;
};

type RegisteredDevice = {
  deviceId: string;
  capabilities: Esp32DeviceCapabilities;
  lastSeenAtMs: number;
};

type Esp32DeviceRegistryDeps = {
  publish: (deviceId: string, payload: Record<string, unknown>) => void;
  now?: () => number;
};

export type Esp32DeviceToolCallParams = {
  deviceId: string;
  toolName: string;
  args: Record<string, unknown>;
  allowlist: readonly string[];
  highRiskRequiresApproval: boolean;
  timeoutMs: number;
};

function matchesAllowlist(toolName: string, allowlist: readonly string[]): boolean {
  for (const entry of allowlist) {
    const normalized = entry.trim();
    if (normalized === "*" || normalized === toolName) {
      return true;
    }
    if (normalized.endsWith(".*") && toolName.startsWith(normalized.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

function inferRiskFromName(toolName: string): Esp32DeviceToolRisk {
  if (/^(?:gpio|relay|servo|door)\./.test(toolName)) {
    return "high";
  }
  if (/^(?:volume|mute|sensor)\./.test(toolName)) {
    return "medium";
  }
  if (/^(?:display|led|audio)\./.test(toolName)) {
    return "low";
  }
  return "high";
}

export class Esp32DeviceRegistry {
  private readonly publish: Esp32DeviceRegistryDeps["publish"];
  private readonly now: () => number;
  private readonly devices = new Map<string, RegisteredDevice>();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();

  constructor(deps: Esp32DeviceRegistryDeps) {
    this.publish = deps.publish;
    this.now = deps.now ?? Date.now;
  }

  registerDevice(params: { deviceId: string; capabilities?: Esp32DeviceCapabilities }): void {
    this.devices.set(params.deviceId, {
      deviceId: params.deviceId,
      capabilities: params.capabilities ?? {},
      lastSeenAtMs: this.now(),
    });
  }

  listDevices(): RegisteredDevice[] {
    return [...this.devices.values()].toSorted((left, right) =>
      left.deviceId.localeCompare(right.deviceId),
    );
  }

  resolveToolRisk(deviceId: string, toolName: string): Esp32DeviceToolRisk {
    const declared = this.devices
      .get(deviceId)
      ?.capabilities.tools?.find((tool) => tool.name === toolName)?.risk;
    return declared ?? inferRiskFromName(toolName);
  }

  async callTool(params: Esp32DeviceToolCallParams): Promise<Esp32ToolCallResult> {
    const device = this.devices.get(params.deviceId);
    if (!device) {
      return { ok: false, error: `ESP32 device is not online: ${params.deviceId}` };
    }
    if (!matchesAllowlist(params.toolName, params.allowlist)) {
      return { ok: false, error: `ESP32 tool is not allowlisted: ${params.toolName}` };
    }
    const risk = this.resolveToolRisk(params.deviceId, params.toolName);
    if (risk === "high" && params.highRiskRequiresApproval) {
      return { ok: false, error: `High-risk ESP32 tool requires approval: ${params.toolName}` };
    }

    const requestId = randomUUID();
    return await new Promise<Esp32ToolCallResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingToolCalls.delete(requestId);
        resolve({ ok: false, error: `ESP32 tool timed out: ${params.toolName}` });
      }, params.timeoutMs);
      timeout.unref?.();
      this.pendingToolCalls.set(requestId, {
        deviceId: params.deviceId,
        resolve,
        timeout,
      });
      this.publish(params.deviceId, {
        type: "tools.call",
        requestId,
        name: params.toolName,
        args: params.args,
      });
    });
  }

  resolveToolResult(params: {
    deviceId: string;
    requestId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }): boolean {
    const pending = this.pendingToolCalls.get(params.requestId);
    if (!pending || pending.deviceId !== params.deviceId) {
      return false;
    }
    clearTimeout(pending.timeout);
    this.pendingToolCalls.delete(params.requestId);
    pending.resolve(
      params.ok
        ? { ok: true, result: params.result }
        : { ok: false, error: params.error || "ESP32 tool failed" },
    );
    return true;
  }
}

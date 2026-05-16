import type { CrawClawConfig } from "../config/config.js";
import { buildGatewayConnectionDetails, callGateway } from "../gateway/call.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";
import type { DoctorMemoryHealthSummary } from "./doctor-memory-health.js";
import { formatHealthCheckFailure } from "./health-format.js";
import { healthCommand } from "./health.js";

export type GatewayMemoryProbe = {
  checked: boolean;
  ready: boolean;
  error?: string;
  memoryHealth?: DoctorMemoryHealthSummary;
};

type GatewayDoctorMemoryStatusPayload = {
  agentId: string;
  memoryHealth: DoctorMemoryHealthSummary;
};

export async function checkGatewayHealth(params: {
  runtime: RuntimeEnv;
  cfg: CrawClawConfig;
  timeoutMs?: number;
}) {
  const gatewayDetails = buildGatewayConnectionDetails({ config: params.cfg });
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0 ? params.timeoutMs : 10_000;
  let healthOk = false;
  try {
    await healthCommand({ json: false, timeoutMs, config: params.cfg }, params.runtime);
    healthOk = true;
  } catch (err) {
    const message = String(err);
    if (message.includes("gateway closed")) {
      note("Gateway not running.", "Gateway");
      note(gatewayDetails.message, "Gateway connection");
    } else {
      params.runtime.error(formatHealthCheckFailure(err));
    }
  }

  return { healthOk };
}

export async function probeGatewayMemoryStatus(params: {
  cfg: CrawClawConfig;
  timeoutMs?: number;
}): Promise<GatewayMemoryProbe> {
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0 ? params.timeoutMs : 8_000;
  try {
    const payload = await callGateway<GatewayDoctorMemoryStatusPayload>({
      method: "doctor.memory.status",
      timeoutMs,
      config: params.cfg,
    });
    return {
      checked: true,
      ready: payload.memoryHealth.overall !== "error",
      error:
        payload.memoryHealth.overall === "error"
          ? "gateway memory health reported errors"
          : undefined,
      memoryHealth: payload.memoryHealth,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      checked: true,
      ready: false,
      error: `gateway memory probe unavailable: ${message}`,
    };
  }
}

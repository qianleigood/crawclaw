import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { resolveDoctorMemoryHealth, type DoctorMemoryHealthSummary } from "../../commands/doctor-memory-health.js";
import type { GatewayRequestHandlers } from "./types.js";

export type DoctorMemoryStatusPayload = {
  agentId: string;
  memoryHealth: DoctorMemoryHealthSummary;
};

export const doctorHandlers: GatewayRequestHandlers = {
  "doctor.memory.status": async ({ respond }) => {
    const cfg = loadConfig();
    const agentId = resolveDefaultAgentId(cfg);
    const memoryHealth = await resolveDoctorMemoryHealth(cfg);
    const payload: DoctorMemoryStatusPayload = {
      agentId,
      memoryHealth,
    };
    respond(true, payload, undefined);
  },
};

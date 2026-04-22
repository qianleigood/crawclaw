import { readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions, type GatewayCallOptions } from "./gateway.js";

const DEFAULT_CRON_TIMEOUT_MS = 60_000;

export type CronGatewayCaller = typeof callGatewayTool;

export function resolveCronGatewayOptions(params: Record<string, unknown>): GatewayCallOptions {
  return {
    ...readGatewayCallOptions(params),
    timeoutMs:
      typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
        ? params.timeoutMs
        : DEFAULT_CRON_TIMEOUT_MS,
  };
}

export function readCronJobId(params: Record<string, unknown>): string {
  const id = readStringParam(params, "jobId") ?? readStringParam(params, "id");
  if (!id) {
    throw new Error("jobId required (id accepted for backward compatibility)");
  }
  return id;
}

export function readCronRunMode(params: Record<string, unknown>): "due" | "force" {
  return params.runMode === "due" || params.runMode === "force" ? params.runMode : "force";
}

export function readCronWakeMode(params: Record<string, unknown>): "now" {
  const mode = readStringParam(params, "mode");
  if (mode && mode.trim() !== "now") {
    throw new Error('mode must be "now"');
  }
  return "now";
}

export async function getCronStatus<T = Record<string, unknown>>(
  callGateway: CronGatewayCaller,
  gatewayOpts: GatewayCallOptions,
): Promise<T> {
  return await callGateway<T>("cron.status", gatewayOpts, {});
}

export async function listCronJobs<T = Record<string, unknown>>(
  callGateway: CronGatewayCaller,
  gatewayOpts: GatewayCallOptions,
  includeDisabled: boolean,
): Promise<T> {
  return await callGateway<T>("cron.list", gatewayOpts, { includeDisabled });
}

export async function addCronJob<T = Record<string, unknown>>(
  callGateway: CronGatewayCaller,
  gatewayOpts: GatewayCallOptions,
  job: unknown,
): Promise<T> {
  return await callGateway<T>("cron.add", gatewayOpts, job);
}

export async function updateCronJob<T = Record<string, unknown>>(
  callGateway: CronGatewayCaller,
  gatewayOpts: GatewayCallOptions,
  id: string,
  patch: unknown,
): Promise<T> {
  return await callGateway<T>("cron.update", gatewayOpts, { id, patch });
}

export async function removeCronJob<T = Record<string, unknown>>(
  callGateway: CronGatewayCaller,
  gatewayOpts: GatewayCallOptions,
  id: string,
): Promise<T> {
  return await callGateway<T>("cron.remove", gatewayOpts, { id });
}

export async function runCronJob<T = Record<string, unknown>>(
  callGateway: CronGatewayCaller,
  gatewayOpts: GatewayCallOptions,
  id: string,
  mode: "due" | "force",
): Promise<T> {
  return await callGateway<T>("cron.run", gatewayOpts, { id, mode });
}

export async function listCronRuns<T = Record<string, unknown>>(
  callGateway: CronGatewayCaller,
  gatewayOpts: GatewayCallOptions,
  id: string,
): Promise<T> {
  return await callGateway<T>("cron.runs", gatewayOpts, { id });
}

export async function wakeGateway<T = Record<string, unknown>>(
  callGateway: CronGatewayCaller,
  gatewayOpts: GatewayCallOptions,
  mode: "now",
  text: string,
): Promise<T> {
  return await callGateway<T>("wake", gatewayOpts, { mode, text }, { expectFinal: false });
}

import { existsSync } from "node:fs";
import { hasPotentialConfiguredChannels } from "../channels/config-presence.js";
import { resolveConfigPath } from "../config/paths.js";
import type { CrawClawConfig } from "../config/types.js";
import { resolveOsSummary } from "../infra/os-summary.js";
import type { RuntimeEnv } from "../runtime.js";
import type { StatusScanResult } from "./status.scan.js";
import { scanStatusJsonCore } from "./status.scan.json-core.js";
let configIoModulePromise: Promise<typeof import("../config/io.js")> | undefined;
let commandSecretTargetsModulePromise:
  | Promise<typeof import("../cli/command-secret-targets.js")>
  | undefined;
let commandSecretGatewayModulePromise:
  | Promise<typeof import("../cli/command-secret-gateway.js")>
  | undefined;

function loadConfigIoModule() {
  configIoModulePromise ??= import("../config/io.js");
  return configIoModulePromise;
}

function loadCommandSecretTargetsModule() {
  commandSecretTargetsModulePromise ??= import("../cli/command-secret-targets.js");
  return commandSecretTargetsModulePromise;
}

function loadCommandSecretGatewayModule() {
  commandSecretGatewayModulePromise ??= import("../cli/command-secret-gateway.js");
  return commandSecretGatewayModulePromise;
}

function shouldSkipMissingConfigFastPath(): boolean {
  return (
    process.env.VITEST === "true" ||
    process.env.VITEST_POOL_ID !== undefined ||
    process.env.NODE_ENV === "test"
  );
}

function isMissingConfigColdStart(): boolean {
  return !shouldSkipMissingConfigFastPath() && !existsSync(resolveConfigPath(process.env));
}

async function readStatusSourceConfig(): Promise<CrawClawConfig> {
  if (!shouldSkipMissingConfigFastPath() && !existsSync(resolveConfigPath(process.env))) {
    return {};
  }
  const { readBestEffortConfig } = await loadConfigIoModule();
  return await readBestEffortConfig();
}

async function resolveStatusConfig(params: {
  sourceConfig: CrawClawConfig;
  commandName: "status --json";
}): Promise<{ resolvedConfig: CrawClawConfig; diagnostics: string[] }> {
  if (!shouldSkipMissingConfigFastPath() && !existsSync(resolveConfigPath(process.env))) {
    return { resolvedConfig: params.sourceConfig, diagnostics: [] };
  }
  const [{ resolveCommandSecretRefsViaGateway }, { getStatusCommandSecretTargetIds }] =
    await Promise.all([loadCommandSecretGatewayModule(), loadCommandSecretTargetsModule()]);
  return await resolveCommandSecretRefsViaGateway({
    config: params.sourceConfig,
    commandName: params.commandName,
    targetIds: getStatusCommandSecretTargetIds(),
    mode: "read_only_status",
  });
}

export async function scanStatusJsonFast(
  opts: {
    timeoutMs?: number;
    all?: boolean;
  },
  _runtime: RuntimeEnv,
): Promise<StatusScanResult> {
  const coldStart = isMissingConfigColdStart();
  const loadedRaw = await readStatusSourceConfig();
  const { resolvedConfig: cfg, diagnostics: secretDiagnostics } = await resolveStatusConfig({
    sourceConfig: loadedRaw,
    commandName: "status --json",
  });
  return await scanStatusJsonCore({
    coldStart,
    cfg,
    sourceConfig: loadedRaw,
    secretDiagnostics,
    hasConfiguredChannels: hasPotentialConfiguredChannels(cfg),
    opts,
    resolveOsSummary,
  });
}

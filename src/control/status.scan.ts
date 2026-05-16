import { readBestEffortConfig, type CrawClawConfig } from "../config/config.js";
import { resolveOsSummary } from "../infra/os-summary.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveCommandSecretRefsViaGateway } from "../terminal/command-secret-gateway.js";
import { scanStatusJsonCore } from "./status.scan.json-core.js";
import type { StatusScanResult } from "./status.types.js";

async function resolveStatusConfig(commandName: string): Promise<{
  config: CrawClawConfig;
  sourceConfig: CrawClawConfig;
  secretDiagnostics: string[];
}> {
  const sourceConfig = await readBestEffortConfig();
  const resolved = await resolveCommandSecretRefsViaGateway({
    config: sourceConfig,
    commandName,
    targetIds: new Set(),
    mode: "read_only_status",
  });
  return {
    config: resolved.resolvedConfig,
    sourceConfig,
    secretDiagnostics: resolved.diagnostics,
  };
}

export async function scanStatus(
  opts: { json?: boolean; timeoutMs?: number; all?: boolean; deep?: boolean },
  runtime?: RuntimeEnv,
): Promise<StatusScanResult> {
  void runtime;
  const { config, sourceConfig, secretDiagnostics } = await resolveStatusConfig(
    opts.json ? "status --json" : "status",
  );
  return scanStatusJsonCore({
    coldStart: false,
    cfg: config,
    sourceConfig,
    secretDiagnostics,
    opts,
    resolveOsSummary,
  });
}

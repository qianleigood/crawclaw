import { existsSync } from "node:fs";
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
let channelConfigPresenceModulePromise:
  | Promise<typeof import("../channels/config-presence.js")>
  | undefined;

const IGNORED_CHANNEL_CONFIG_KEYS = new Set(["defaults", "modelByChannel"]);

const CHANNEL_ENV_PREFIXES = [
  "BLUEBUBBLES_",
  "DISCORD_",
  "GOOGLECHAT_",
  "IRC_",
  "LINE_",
  "MATRIX_",
  "MSTEAMS_",
  "SIGNAL_",
  "SLACK_",
  "TELEGRAM_",
  "WHATSAPP_",
  "ZALOUSER_",
  "ZALO_",
] as const;

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

function loadChannelConfigPresenceModule() {
  channelConfigPresenceModulePromise ??= import("../channels/config-presence.js");
  return channelConfigPresenceModulePromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasMeaningfulChannelConfig(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Object.keys(value).some((key) => key !== "enabled");
}

function hasStatusJsonChannelHint(
  cfg: CrawClawConfig | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const channels = isRecord(cfg?.channels) ? cfg.channels : null;
  if (channels) {
    for (const [key, value] of Object.entries(channels)) {
      if (!IGNORED_CHANNEL_CONFIG_KEYS.has(key) && hasMeaningfulChannelConfig(value)) {
        return true;
      }
    }
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    if (
      key === "TELEGRAM_BOT_TOKEN" ||
      CHANNEL_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      return true;
    }
  }
  return false;
}

async function hasStatusJsonConfiguredChannels(params: {
  cfg: CrawClawConfig;
  coldStart: boolean;
}): Promise<boolean> {
  const hasChannelHint = hasStatusJsonChannelHint(params.cfg);
  if (params.coldStart || !hasChannelHint) {
    return hasChannelHint;
  }
  const { hasPotentialConfiguredChannels } = await loadChannelConfigPresenceModule();
  return hasPotentialConfiguredChannels(params.cfg);
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
  const { readConfigFileSnapshot } = await loadConfigIoModule();
  const snapshot = await readConfigFileSnapshot();
  return snapshot.runtimeConfig;
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
    deep?: boolean;
  },
  _runtime: RuntimeEnv,
): Promise<StatusScanResult> {
  const coldStart = isMissingConfigColdStart();
  const loadedRaw = await readStatusSourceConfig();
  const { resolvedConfig: cfg, diagnostics: secretDiagnostics } = await resolveStatusConfig({
    sourceConfig: loadedRaw,
    commandName: "status --json",
  });
  const hasConfiguredChannels = await hasStatusJsonConfiguredChannels({ cfg, coldStart });
  return await scanStatusJsonCore({
    coldStart,
    cfg,
    sourceConfig: loadedRaw,
    secretDiagnostics,
    hasConfiguredChannels,
    opts,
    resolveOsSummary,
  });
}

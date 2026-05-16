import { listSecretTargetRegistryEntries } from "../secrets/target-registry.js";

function idsByPrefix(prefixes: readonly string[]): string[] {
  return listSecretTargetRegistryEntries()
    .map((entry) => entry.id)
    .filter((id) => prefixes.some((prefix) => id.startsWith(prefix)))
    .toSorted();
}

function idsByPredicate(predicate: (id: string) => boolean): string[] {
  return listSecretTargetRegistryEntries()
    .map((entry) => entry.id)
    .filter(predicate)
    .toSorted();
}

const WEB_PLUGIN_SECRET_TARGETS = idsByPredicate((id) =>
  /^plugins\.entries\.[^.]+\.config\.(webSearch|webFetch)\.apiKey$/.test(id),
);

const COMMAND_SECRET_TARGETS = {
  qrRemote: ["gateway.remote.token", "gateway.remote.password"],
  models: idsByPrefix(["models.providers."]),
  agentRuntime: idsByPrefix([
    "models.providers.",
    "skills.entries.",
    "messages.tts.",
    "tools.web.search",
  ]).concat(WEB_PLUGIN_SECRET_TARGETS),
  status: [],
  securityAudit: idsByPrefix(["gateway.auth.", "gateway.remote."]),
} as const;

function toTargetIdSet(values: readonly string[]): Set<string> {
  return new Set(values);
}

export function getQrRemoteCommandSecretTargetIds(): Set<string> {
  return toTargetIdSet(COMMAND_SECRET_TARGETS.qrRemote);
}

export function getModelsCommandSecretTargetIds(): Set<string> {
  return toTargetIdSet(COMMAND_SECRET_TARGETS.models);
}

export function getAgentRuntimeCommandSecretTargetIds(): Set<string> {
  return toTargetIdSet(COMMAND_SECRET_TARGETS.agentRuntime);
}

export function getStatusCommandSecretTargetIds(): Set<string> {
  return toTargetIdSet(COMMAND_SECRET_TARGETS.status);
}

export function getSecurityAuditCommandSecretTargetIds(): Set<string> {
  return toTargetIdSet(COMMAND_SECRET_TARGETS.securityAudit);
}

export type JsonObject = Record<string, unknown>;

export type ExternalPluginCompatibility = {
  pluginApiRange?: string;
  builtWithCrawClawVersion?: string;
  pluginSdkVersion?: string;
  minGatewayVersion?: string;
};

export type ExternalPluginValidationIssue = {
  fieldPath: string;
  message: string;
};

export type ExternalCodePluginValidationResult = {
  compatibility?: ExternalPluginCompatibility;
  issues: ExternalPluginValidationIssue[];
};

export const EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS = [
  "crawclaw.compat.pluginApi",
  "crawclaw.build.crawclawVersion",
] as const;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCrawClawBlock(packageJson: unknown) {
  const root = isRecord(packageJson) ? packageJson : undefined;
  const crawclaw = isRecord(root?.crawclaw) ? root.crawclaw : undefined;
  const compat = isRecord(crawclaw?.compat) ? crawclaw.compat : undefined;
  const build = isRecord(crawclaw?.build) ? crawclaw.build : undefined;
  const install = isRecord(crawclaw?.install) ? crawclaw.install : undefined;
  return { root, crawclaw, compat, build, install };
}

export function normalizeExternalPluginCompatibility(
  packageJson: unknown,
): ExternalPluginCompatibility | undefined {
  const { root, compat, build, install } = readCrawClawBlock(packageJson);
  const version = getTrimmedString(root?.version);
  const minHostVersion = getTrimmedString(install?.minHostVersion);
  const compatibility: ExternalPluginCompatibility = {};

  const pluginApi = getTrimmedString(compat?.pluginApi);
  if (pluginApi) {
    compatibility.pluginApiRange = pluginApi;
  }

  const minGatewayVersion = getTrimmedString(compat?.minGatewayVersion) ?? minHostVersion;
  if (minGatewayVersion) {
    compatibility.minGatewayVersion = minGatewayVersion;
  }

  const builtWithCrawClawVersion = getTrimmedString(build?.crawclawVersion) ?? version;
  if (builtWithCrawClawVersion) {
    compatibility.builtWithCrawClawVersion = builtWithCrawClawVersion;
  }

  const pluginSdkVersion = getTrimmedString(build?.pluginSdkVersion);
  if (pluginSdkVersion) {
    compatibility.pluginSdkVersion = pluginSdkVersion;
  }

  return Object.keys(compatibility).length > 0 ? compatibility : undefined;
}

export function listMissingExternalCodePluginFieldPaths(packageJson: unknown): string[] {
  const { compat, build } = readCrawClawBlock(packageJson);
  const missing: string[] = [];
  if (!getTrimmedString(compat?.pluginApi)) {
    missing.push("crawclaw.compat.pluginApi");
  }
  if (!getTrimmedString(build?.crawclawVersion)) {
    missing.push("crawclaw.build.crawclawVersion");
  }
  return missing;
}

export function validateExternalCodePluginPackageJson(
  packageJson: unknown,
): ExternalCodePluginValidationResult {
  const issues = listMissingExternalCodePluginFieldPaths(packageJson).map((fieldPath) => ({
    fieldPath,
    message: `${fieldPath} is required for external code plugins published to ClawHub.`,
  }));
  return {
    compatibility: normalizeExternalPluginCompatibility(packageJson),
    issues,
  };
}

import path from "node:path";
import {
  resolveSafeInstallDir,
  safeDirName,
  safePathSegmentHashed,
} from "../infra/install-safe-path.js";
import { CONFIG_DIR } from "../utils.js";

export const PLUGIN_INSTALL_ERROR_CODE = {
  INVALID_NPM_SPEC: "invalid_npm_spec",
  INVALID_MIN_HOST_VERSION: "invalid_min_host_version",
  UNKNOWN_HOST_VERSION: "unknown_host_version",
  INCOMPATIBLE_HOST_VERSION: "incompatible_host_version",
  MISSING_CRAWCLAW_EXTENSIONS: "missing_crawclaw_extensions",
  EMPTY_CRAWCLAW_EXTENSIONS: "empty_crawclaw_extensions",
  NPM_PACKAGE_NOT_FOUND: "npm_package_not_found",
  PLUGIN_ID_MISMATCH: "plugin_id_mismatch",
  SECURITY_SCAN_BLOCKED: "security_scan_blocked",
  SECURITY_SCAN_FAILED: "security_scan_failed",
} as const;

export type PluginInstallErrorCode =
  (typeof PLUGIN_INSTALL_ERROR_CODE)[keyof typeof PLUGIN_INSTALL_ERROR_CODE];

function encodePluginInstallDirName(pluginId: string): string {
  const trimmed = pluginId.trim();
  if (!trimmed.includes("/")) {
    return safeDirName(trimmed);
  }
  return `@${safePathSegmentHashed(trimmed)}`;
}

export function resolvePluginInstallDir(pluginId: string, extensionsDir?: string): string {
  const base = extensionsDir ?? path.join(CONFIG_DIR, "plugins");
  const resolved = resolveSafeInstallDir({
    baseDir: base,
    id: pluginId,
    nameEncoder: encodePluginInstallDirName,
    invalidNameMessage: `invalid plugin id: ${pluginId}`,
  });
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  return resolved.path;
}

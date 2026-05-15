import { existsSync } from "node:fs";
import path from "node:path";
import type { CrawClawConfig } from "../../../config/config.js";
import { resolveBundledPluginWorkspaceSourcePath } from "../../../plugins/bundled-plugin-metadata.js";

export function resolveConfiguredAcpBackendId(cfg: CrawClawConfig): string {
  return cfg.acp?.backend?.trim() || "acpx";
}

export function resolveAcpInstallCommandHint(cfg: CrawClawConfig): string {
  const configured = cfg.acp?.runtime?.installCommand?.trim();
  if (configured) {
    return configured;
  }
  const workspaceDir = process.cwd();
  const backendId = resolveConfiguredAcpBackendId(cfg).toLowerCase();
  if (backendId === "acpx") {
    const workspaceLocalPath = resolveBundledPluginWorkspaceSourcePath({
      rootDir: workspaceDir,
      pluginId: backendId,
    });
    if (workspaceLocalPath && existsSync(workspaceLocalPath)) {
      return `Install local plugin from Desktop Settings → Plugins: ${workspaceLocalPath}`;
    }
    const workspaceExtensionPath = path.join(workspaceDir, "extensions", backendId);
    if (existsSync(workspaceExtensionPath)) {
      return `Install local plugin from Desktop Settings → Plugins: ${workspaceExtensionPath}`;
    }
    return "Install acpx from Desktop Settings → Plugins.";
  }
  return `Install and enable the plugin that provides ACP backend "${backendId}".`;
}

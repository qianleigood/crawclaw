import type { CrawClawConfig } from "../config/config.js";

export async function getActiveMemorySearchManager(params: {
  cfg: CrawClawConfig;
  agentId: string;
  purpose?: "default" | "status";
}) {
  void params;
  return {
    manager: null,
    error: "legacy local memory search is no longer supported",
  };
}

export function resolveActiveMemoryBackendConfig(params: { cfg: CrawClawConfig; agentId: string }) {
  void params;
  return null;
}

export async function closeActiveMemorySearchManagers(cfg?: CrawClawConfig): Promise<void> {
  void cfg;
}

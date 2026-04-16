import type { CacheGovernanceDescriptor } from "../cache/governance-types.js";
import { loadWorkspaceBootstrapFiles, type WorkspaceBootstrapFile } from "./workspace.js";

const cache = new Map<string, WorkspaceBootstrapFile[]>();

export const WORKSPACE_BOOTSTRAP_CACHE_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "agents.bootstrap-cache.workspace-files",
  module: "src/agents/bootstrap-cache.ts",
  category: "runtime_ttl",
  owner: "agent-kernel/workspace-bootstrap",
  key: "sessionKey",
  lifecycle:
    "Process-local bootstrap snapshot cache scoped to the active session key and reused until rollover, explicit clear, or process restart.",
  invalidation: [
    "clearBootstrapSnapshot(sessionKey) removes one session snapshot",
    "clearBootstrapSnapshotOnSessionRollover(...) clears on canonical session rollover",
    "clearAllBootstrapSnapshots() clears the entire cache",
  ],
  observability: ["getBootstrapSnapshotCacheMeta()"],
};

export async function getOrLoadBootstrapFiles(params: {
  workspaceDir: string;
  sessionKey: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const existing = cache.get(params.sessionKey);
  if (existing) {
    return existing;
  }

  const files = await loadWorkspaceBootstrapFiles(params.workspaceDir);
  cache.set(params.sessionKey, files);
  return files;
}

export function clearBootstrapSnapshot(sessionKey: string): void {
  cache.delete(sessionKey);
}

export function clearBootstrapSnapshotOnSessionRollover(params: {
  sessionKey?: string;
  previousSessionId?: string;
}): void {
  if (!params.sessionKey || !params.previousSessionId) {
    return;
  }

  clearBootstrapSnapshot(params.sessionKey);
}

export function clearAllBootstrapSnapshots(): void {
  cache.clear();
}

export function getBootstrapSnapshotCacheMeta(): {
  size: number;
} {
  return {
    size: cache.size,
  };
}

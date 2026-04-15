import type { CrawClawConfig } from "../../../../config/config.js";
import { getActiveMemorySearchManager } from "../../../../plugins/memory-runtime.js";
import { emitSessionTranscriptUpdate } from "../../../../sessions/transcript-events.js";
import { resolveSessionAgentId } from "../../../agent-scope.js";
import { resolveMemorySearchConfig } from "../../../memory-search.js";

function resolvePostCompactionIndexSyncMode(config?: CrawClawConfig): "off" | "async" | "await" {
  const mode = config?.agents?.defaults?.compaction?.postIndexSync;
  if (mode === "off" || mode === "async" || mode === "await") {
    return mode;
  }
  return "async";
}

async function runPostCompactionSessionMemorySync(params: {
  config?: CrawClawConfig;
  sessionKey?: string;
  sessionFile: string;
}): Promise<void> {
  const config = params.config;
  if (!config) {
    return;
  }
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return;
  }
  const agentId = resolveSessionAgentId({
    sessionKey,
    config,
  });
  const memorySearchConfig = resolveMemorySearchConfig(config, agentId);
  if (!memorySearchConfig?.sync.sessions.postCompactionForce) {
    return;
  }
  const activeManager = await getActiveMemorySearchManager({
    cfg: config,
    agentId,
  });
  const manager = activeManager as {
    manager?: { sync?: (params?: unknown) => Promise<void> } | null;
  };
  await manager.manager?.sync?.({
    reason: "post-compaction",
    sessionFiles: [params.sessionFile],
  });
}

function syncPostCompactionSessionMemory(params: {
  config?: CrawClawConfig;
  sessionKey?: string;
  sessionFile: string;
  mode: "off" | "async" | "await";
}): Promise<void> {
  if (params.mode === "off" || !params.config) {
    return Promise.resolve();
  }

  const syncTask = runPostCompactionSessionMemorySync({
    config: params.config,
    sessionKey: params.sessionKey,
    sessionFile: params.sessionFile,
  });
  if (params.mode === "await") {
    return syncTask;
  }
  void syncTask;
  return Promise.resolve();
}

export async function runPostCompactionSideEffects(params: {
  config?: CrawClawConfig;
  sessionKey?: string;
  sessionFile: string;
}): Promise<void> {
  const sessionFile = params.sessionFile.trim();
  if (!sessionFile) {
    return;
  }
  emitSessionTranscriptUpdate(sessionFile);
  await syncPostCompactionSessionMemory({
    config: params.config,
    sessionKey: params.sessionKey,
    sessionFile,
    mode: resolvePostCompactionIndexSyncMode(params.config),
  });
}

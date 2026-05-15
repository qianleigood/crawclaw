import { resolveAgentDir, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { resolveAgentIdentity } from "../../agents/identity.js";
import { resolveThinkingDefault } from "../../agents/model-selection.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { ensureAgentWorkspace } from "../../agents/workspace.js";
import { resolveSessionFilePath, resolveStorePath } from "../../config/sessions/paths.js";
import { loadSessionStore, saveSessionStore } from "../../config/sessions/store.js";
import { defineCachedValue } from "./runtime-cache.js";
import type { PluginRuntime } from "./types.js";

export function createRuntimeAgent(): PluginRuntime["agent"] {
  const agentRuntime = {
    defaults: {
      model: DEFAULT_MODEL,
      provider: DEFAULT_PROVIDER,
    },
    resolveAgentDir,
    resolveAgentWorkspaceDir,
    resolveAgentIdentity,
    resolveThinkingDefault,
    resolveAgentTimeoutMs,
    ensureAgentWorkspace,
  } satisfies Omit<PluginRuntime["agent"], "session"> &
    Partial<Pick<PluginRuntime["agent"], "session">>;

  defineCachedValue(agentRuntime, "session", () => ({
    resolveStorePath,
    loadSessionStore,
    saveSessionStore,
    resolveSessionFilePath,
  }));

  return agentRuntime as PluginRuntime["agent"];
}

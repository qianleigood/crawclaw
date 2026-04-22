import { runMainSessionWakeOnce as runMainSessionWakeOnceInternal } from "../../infra/main-session-wake-runner.js";
import { requestMainSessionWakeNow } from "../../infra/main-session-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { formatNativeDependencyHint } from "./native-deps.js";
import type { RunMainSessionWakeOnceOptions } from "./types-core.js";
import type { PluginRuntime } from "./types.js";

export function createRuntimeSystem(): PluginRuntime["system"] {
  return {
    enqueueSystemEvent,
    requestMainSessionWakeNow,
    runMainSessionWakeOnce: (opts?: RunMainSessionWakeOnceOptions) => {
      // Destructure to forward only the plugin-safe subset; prevent cfg/deps injection at runtime.
      const { reason, agentId, sessionKey, heartbeat } = opts ?? {};
      return runMainSessionWakeOnceInternal({
        reason,
        agentId,
        sessionKey,
        heartbeat: heartbeat ? { target: heartbeat.target } : undefined,
      });
    },
    runCommandWithTimeout,
    formatNativeDependencyHint,
  };
}

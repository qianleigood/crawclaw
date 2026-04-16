import type { CrawClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import {
  createInternalHookEvent,
  triggerInternalHook,
  type InternalHookEvent,
} from "../../hooks/internal-hooks.js";

export type ResetInternalHookAction = "new" | "reset";

export async function emitResetInternalHook(params: {
  action: ResetInternalHookAction;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  previousSessionEntry?: SessionEntry;
  commandSource: string;
  cfg: CrawClawConfig;
  senderId?: string;
  workspaceDir?: string;
}): Promise<InternalHookEvent> {
  const hookEvent = createInternalHookEvent("command", params.action, params.sessionKey ?? "", {
    sessionEntry: params.sessionEntry,
    previousSessionEntry: params.previousSessionEntry,
    commandSource: params.commandSource,
    senderId: params.senderId,
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  await triggerInternalHook(hookEvent);
  return hookEvent;
}

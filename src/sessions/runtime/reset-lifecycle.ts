import {
  buildSessionEndHookPayload,
  buildSessionStartHookPayload,
} from "../../auto-reply/reply/session-hooks.js";
import type { CrawClawConfig } from "../../config/config.js";
import type { HookRunner } from "../../plugins/hooks.js";

type SessionResetLifecycleHookRunner = Pick<
  HookRunner,
  "hasHooks" | "runSessionEnd" | "runSessionStart"
>;

export function emitSessionRolloverHooks(params: {
  hookRunner: SessionResetLifecycleHookRunner | undefined;
  isNewSession: boolean;
  sessionId: string;
  previousSessionId?: string;
  sessionKey: string;
  cfg: CrawClawConfig;
}): void {
  const hookRunner = params.hookRunner;
  if (!hookRunner || !params.isNewSession) {
    return;
  }

  if (params.previousSessionId && params.previousSessionId !== params.sessionId) {
    if (hookRunner.hasHooks("session_end")) {
      const payload = buildSessionEndHookPayload({
        sessionId: params.previousSessionId,
        sessionKey: params.sessionKey,
        cfg: params.cfg,
      });
      void hookRunner.runSessionEnd(payload.event, payload.context).catch(() => {});
    }
  }

  if (hookRunner.hasHooks("session_start")) {
    const payload = buildSessionStartHookPayload({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      cfg: params.cfg,
      resumedFrom: params.previousSessionId,
    });
    void hookRunner.runSessionStart(payload.event, payload.context).catch(() => {});
  }
}

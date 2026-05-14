import type { MsgContext } from "../../auto-reply/templating.js";

export function normalizeExplicitSessionKey(sessionKey: string, ctx: MsgContext): string {
  const normalized = sessionKey.trim().toLowerCase();
  void ctx;
  return normalized;
}

import { callGateway } from "../../../gateway/call.js";
import type { HandleCommandsParams } from "../commands-types.js";
import { SESSION_ID_RE } from "./shared.js";

async function resolveSessionKeyByToken(token: string): Promise<string | null> {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const attempts: Array<Record<string, string>> = [{ key: trimmed }];
  if (SESSION_ID_RE.test(trimmed)) {
    attempts.push({ sessionId: trimmed });
  }
  attempts.push({ label: trimmed });

  for (const params of attempts) {
    try {
      const resolved = await callGateway<{ key?: string }>({
        method: "sessions.resolve",
        params,
        timeoutMs: 8_000,
      });
      const key = typeof resolved?.key === "string" ? resolved.key.trim() : "";
      if (key) {
        return key;
      }
    } catch {
      // Try next resolver strategy.
    }
  }
  return null;
}

export function resolveBoundAcpThreadSessionKey(params: HandleCommandsParams): string | undefined {
  const commandTargetSessionKey =
    typeof params.ctx.CommandTargetSessionKey === "string"
      ? params.ctx.CommandTargetSessionKey.trim()
      : "";
  return commandTargetSessionKey || params.sessionKey || undefined;
}

export async function resolveAcpTargetSessionKey(params: {
  commandParams: HandleCommandsParams;
  token?: string;
}): Promise<{ ok: true; sessionKey: string } | { ok: false; error: string }> {
  const token = params.token?.trim() || "";
  if (token) {
    const resolved = await resolveSessionKeyByToken(token);
    if (!resolved) {
      return { ok: false, error: `Unable to resolve session target: ${token}` };
    }
    return { ok: true, sessionKey: resolved };
  }
  const fallback = resolveBoundAcpThreadSessionKey(params.commandParams);
  return fallback
    ? { ok: true, sessionKey: fallback }
    : { ok: false, error: "Missing session key." };
}

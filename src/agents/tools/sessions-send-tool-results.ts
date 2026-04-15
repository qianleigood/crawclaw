import crypto from "node:crypto";
import { jsonResult } from "./common.js";

type SessionsSendStatus = "accepted" | "ok" | "timeout" | "error" | "forbidden";

type SessionsSendResultParams = {
  runId?: string;
  status: SessionsSendStatus;
  error?: string;
  sessionKey?: string;
  reply?: string;
  delivery?: unknown;
};

export function buildSessionsSendResult(params: SessionsSendResultParams) {
  return jsonResult({
    runId: params.runId ?? crypto.randomUUID(),
    status: params.status,
    ...("error" in params ? { error: params.error } : {}),
    ...("sessionKey" in params ? { sessionKey: params.sessionKey } : {}),
    ...("reply" in params ? { reply: params.reply } : {}),
    ...("delivery" in params ? { delivery: params.delivery } : {}),
  });
}

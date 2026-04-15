import path from "node:path";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveStorePath,
} from "../../config/sessions.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import {
  resolveInternalSessionKey,
  stripToolMessages,
  type SessionListRow,
} from "./sessions-helpers.js";

type GatewayCaller = (params: {
  method: string;
  params?: Record<string, unknown>;
}) => Promise<{ messages?: Array<unknown> }>;

export function resolveTranscriptPath(params: {
  key: string;
  sessionId?: string;
  sessionFile?: string;
  storePath?: string;
}): string | undefined {
  if (!params.sessionId) {
    return undefined;
  }
  try {
    const agentId = resolveAgentIdFromSessionKey(params.key);
    const trimmedStorePath = params.storePath?.trim();
    let effectiveStorePath: string | undefined;
    if (trimmedStorePath && trimmedStorePath !== "(multiple)") {
      if (trimmedStorePath.includes("{agentId}") || trimmedStorePath.startsWith("~")) {
        effectiveStorePath = resolveStorePath(trimmedStorePath, { agentId });
      } else if (path.isAbsolute(trimmedStorePath)) {
        effectiveStorePath = trimmedStorePath;
      }
    }
    const filePathOpts = resolveSessionFilePathOptions({
      agentId,
      storePath: effectiveStorePath,
    });
    return resolveSessionFilePath(
      params.sessionId,
      params.sessionFile ? { sessionFile: params.sessionFile } : undefined,
      filePathOpts,
    );
  } catch {
    return undefined;
  }
}

export async function hydrateSessionListMessages(params: {
  rows: SessionListRow[];
  messageLimit: number;
  gatewayCall: GatewayCaller;
  alias: string;
  mainKey: string;
}): Promise<void> {
  if (params.messageLimit <= 0 || params.rows.length === 0) {
    return;
  }

  const historyTargets = params.rows.map((row) => ({
    row,
    resolvedKey: resolveInternalSessionKey({
      key: row.key,
      alias: params.alias,
      mainKey: params.mainKey,
    }),
  }));

  const maxConcurrent = Math.min(4, historyTargets.length);
  let index = 0;
  const worker = async () => {
    while (true) {
      const next = index;
      index += 1;
      if (next >= historyTargets.length) {
        return;
      }
      const target = historyTargets[next];
      const history = await params.gatewayCall({
        method: "chat.history",
        params: { sessionKey: target.resolvedKey, limit: params.messageLimit },
      });
      const rawMessages = Array.isArray(history?.messages) ? history.messages : [];
      const filtered = stripToolMessages(rawMessages);
      target.row.messages =
        filtered.length > params.messageLimit ? filtered.slice(-params.messageLimit) : filtered;
    }
  };

  await Promise.all(Array.from({ length: maxConcurrent }, () => worker()));
}

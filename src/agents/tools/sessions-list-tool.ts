import { Type } from "@sinclair/typebox";
import { type CrawClawConfig, loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringArrayParam } from "./common.js";
import {
  createSessionVisibilityGuard,
  classifySessionKind,
  deriveChannel,
  resolveSessionAccessPolicies,
  resolveDisplaySessionKey,
  resolveSessionToolContext,
  type SessionListRow,
} from "./sessions-helpers.js";
import { hydrateSessionListMessages, resolveTranscriptPath } from "./sessions-list-tool-ops.js";

const SessionsListToolSchema = Type.Object({
  kinds: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Number({ minimum: 1 })),
  activeMinutes: Type.Optional(Type.Number({ minimum: 1 })),
  messageLimit: Type.Optional(Type.Number({ minimum: 0 })),
});

type GatewayCaller = typeof callGateway;

export function createSessionsListTool(opts?: {
  agentSessionKey?: string;
  sandboxed?: boolean;
  config?: CrawClawConfig;
  callGateway?: GatewayCaller;
}): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_list",
    description: "List sessions with optional filters and last messages.",
    parameters: SessionsListToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const { cfg, mainKey, alias, effectiveRequesterKey, restrictToSpawned } =
        resolveSessionToolContext({
          config: opts?.config ?? loadConfig(),
          agentSessionKey: opts?.agentSessionKey,
          sandboxed: opts?.sandboxed,
        });
      const { a2aPolicy, visibility } = resolveSessionAccessPolicies({
        cfg,
        sandboxed: opts?.sandboxed,
      });

      const kindsRaw = readStringArrayParam(params, "kinds")?.map((value) =>
        value.trim().toLowerCase(),
      );
      const allowedKindsList = (kindsRaw ?? []).filter((value) =>
        ["main", "group", "cron", "hook", "node", "other"].includes(value),
      );
      const allowedKinds = allowedKindsList.length ? new Set(allowedKindsList) : undefined;

      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.floor(params.limit))
          : undefined;
      const activeMinutes =
        typeof params.activeMinutes === "number" && Number.isFinite(params.activeMinutes)
          ? Math.max(1, Math.floor(params.activeMinutes))
          : undefined;
      const messageLimitRaw =
        typeof params.messageLimit === "number" && Number.isFinite(params.messageLimit)
          ? Math.max(0, Math.floor(params.messageLimit))
          : 0;
      const messageLimit = Math.min(messageLimitRaw, 20);
      const gatewayCall = opts?.callGateway ?? callGateway;

      const list = await gatewayCall<{ sessions: Array<SessionListRow>; path: string }>({
        method: "sessions.list",
        params: {
          limit,
          activeMinutes,
          includeGlobal: !restrictToSpawned,
          includeUnknown: !restrictToSpawned,
          spawnedBy: restrictToSpawned ? effectiveRequesterKey : undefined,
        },
      });

      const sessions = Array.isArray(list?.sessions) ? list.sessions : [];
      const storePath = typeof list?.path === "string" ? list.path : undefined;
      const visibilityGuard = await createSessionVisibilityGuard({
        action: "list",
        requesterSessionKey: effectiveRequesterKey,
        visibility,
        a2aPolicy,
      });
      const rows: SessionListRow[] = [];
      for (const entry of sessions) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const key = typeof entry.key === "string" ? entry.key : "";
        if (!key) {
          continue;
        }
        const access = visibilityGuard.check(key);
        if (!access.allowed) {
          continue;
        }

        if (key === "unknown") {
          continue;
        }
        if (key === "global" && alias !== "global") {
          continue;
        }

        const gatewayKind = typeof entry.kind === "string" ? entry.kind : undefined;
        const kind = classifySessionKind({ key, gatewayKind, alias, mainKey });
        if (allowedKinds && !allowedKinds.has(kind)) {
          continue;
        }

        const displayKey = resolveDisplaySessionKey({
          key,
          alias,
          mainKey,
        });

        const entryChannel = typeof entry.channel === "string" ? entry.channel : undefined;
        const entryOrigin =
          entry.origin && typeof entry.origin === "object"
            ? (entry.origin as Record<string, unknown>)
            : undefined;
        const originChannel =
          typeof entryOrigin?.provider === "string" ? entryOrigin.provider : undefined;
        const deliveryContext =
          entry.deliveryContext && typeof entry.deliveryContext === "object"
            ? (entry.deliveryContext as Record<string, unknown>)
            : undefined;
        const deliveryChannel =
          typeof deliveryContext?.channel === "string" ? deliveryContext.channel : undefined;
        const deliveryTo = typeof deliveryContext?.to === "string" ? deliveryContext.to : undefined;
        const deliveryAccountId =
          typeof deliveryContext?.accountId === "string" ? deliveryContext.accountId : undefined;
        const deliveryThreadId =
          typeof deliveryContext?.threadId === "string" ||
          (typeof deliveryContext?.threadId === "number" &&
            Number.isFinite(deliveryContext.threadId))
            ? deliveryContext.threadId
            : undefined;
        const lastChannel =
          deliveryChannel ??
          (typeof entry.lastChannel === "string" ? entry.lastChannel : undefined);
        const lastAccountId =
          deliveryAccountId ??
          (typeof entry.lastAccountId === "string" ? entry.lastAccountId : undefined);
        const derivedChannel = deriveChannel({
          key,
          kind,
          channel: entryChannel ?? originChannel,
          lastChannel,
        });

        const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
        const sessionFileRaw = (entry as { sessionFile?: unknown }).sessionFile;
        const sessionFile = typeof sessionFileRaw === "string" ? sessionFileRaw : undefined;
        const transcriptPath = resolveTranscriptPath({
          key,
          sessionId,
          sessionFile,
          storePath,
        });

        const row: SessionListRow = {
          key: displayKey,
          kind,
          channel: derivedChannel,
          origin:
            originChannel ||
            (typeof entryOrigin?.accountId === "string" ? entryOrigin.accountId : undefined)
              ? {
                  provider: originChannel,
                  accountId:
                    typeof entryOrigin?.accountId === "string" ? entryOrigin.accountId : undefined,
                }
              : undefined,
          spawnedBy:
            typeof entry.spawnedBy === "string"
              ? resolveDisplaySessionKey({
                  key: entry.spawnedBy,
                  alias,
                  mainKey,
                })
              : undefined,
          label: typeof entry.label === "string" ? entry.label : undefined,
          displayName: typeof entry.displayName === "string" ? entry.displayName : undefined,
          parentSessionKey:
            typeof entry.parentSessionKey === "string"
              ? resolveDisplaySessionKey({
                  key: entry.parentSessionKey,
                  alias,
                  mainKey,
                })
              : undefined,
          deliveryContext:
            deliveryChannel || deliveryTo || deliveryAccountId || deliveryThreadId
              ? {
                  channel: deliveryChannel,
                  to: deliveryTo,
                  accountId: deliveryAccountId,
                  threadId: deliveryThreadId,
                }
              : undefined,
          updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : undefined,
          sessionId,
          model: typeof entry.model === "string" ? entry.model : undefined,
          contextTokens: typeof entry.contextTokens === "number" ? entry.contextTokens : undefined,
          totalTokens: typeof entry.totalTokens === "number" ? entry.totalTokens : undefined,
          estimatedCostUsd:
            typeof entry.estimatedCostUsd === "number" ? entry.estimatedCostUsd : undefined,
          status: typeof entry.status === "string" ? entry.status : undefined,
          startedAt: typeof entry.startedAt === "number" ? entry.startedAt : undefined,
          endedAt: typeof entry.endedAt === "number" ? entry.endedAt : undefined,
          runtimeMs: typeof entry.runtimeMs === "number" ? entry.runtimeMs : undefined,
          childSessions: Array.isArray(entry.childSessions)
            ? entry.childSessions
                .filter((value): value is string => typeof value === "string")
                .map((value) =>
                  resolveDisplaySessionKey({
                    key: value,
                    alias,
                    mainKey,
                  }),
                )
            : undefined,
          thinkingLevel: typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : undefined,
          fastMode: typeof entry.fastMode === "boolean" ? entry.fastMode : undefined,
          verboseLevel: typeof entry.verboseLevel === "string" ? entry.verboseLevel : undefined,
          reasoningLevel:
            typeof entry.reasoningLevel === "string" ? entry.reasoningLevel : undefined,
          elevatedLevel: typeof entry.elevatedLevel === "string" ? entry.elevatedLevel : undefined,
          responseUsage: typeof entry.responseUsage === "string" ? entry.responseUsage : undefined,
          systemSent: typeof entry.systemSent === "boolean" ? entry.systemSent : undefined,
          abortedLastRun:
            typeof entry.abortedLastRun === "boolean" ? entry.abortedLastRun : undefined,
          sendPolicy: typeof entry.sendPolicy === "string" ? entry.sendPolicy : undefined,
          lastChannel,
          lastTo: deliveryTo ?? (typeof entry.lastTo === "string" ? entry.lastTo : undefined),
          lastAccountId,
          transcriptPath,
        };
        rows.push(row);
      }

      await hydrateSessionListMessages({
        rows,
        messageLimit,
        gatewayCall,
        alias,
        mainKey,
      });

      return jsonResult({
        count: rows.length,
        sessions: rows,
      });
    },
  };
}

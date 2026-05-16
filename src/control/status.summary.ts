import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL } from "../agents/defaults.js";
import { resolveAgentModelPrimaryValue } from "../config/model-input.js";
import { resolveMainSessionKey } from "../config/sessions/main-session.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { readSessionStoreReadOnly } from "../config/sessions/store-read.js";
import type { CrawClawConfig } from "../config/types.js";
import { listGatewayAgentsBasic } from "../gateway/agent-list.js";
import { peekSystemEvents } from "../infra/system-events.js";
import { createEmptyTaskAuditSummary } from "../tasks/task-registry.audit.shared.js";
import { createEmptyTaskRegistrySummary } from "../tasks/task-registry.summary.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import { statusSummaryRuntime } from "./status.summary.runtime.js";
import type { SessionStatus, StatusSummary } from "./status.types.js";

function toSessionStatus(params: {
  key: string;
  entry: ReturnType<typeof readSessionStoreReadOnly>[string];
  cfg: CrawClawConfig;
  agentId: string;
  now: number;
}): SessionStatus {
  const modelRef = statusSummaryRuntime.resolveSessionModelRef(
    params.cfg,
    params.entry,
    params.agentId,
  );
  const updatedAt = typeof params.entry?.updatedAt === "number" ? params.entry.updatedAt : null;
  return {
    key: params.key,
    kind: statusSummaryRuntime.classifySessionKey(params.key, params.entry),
    updatedAt,
    age: updatedAt ? Math.max(0, params.now - updatedAt) : 0,
    model: modelRef.model,
    modelProvider: modelRef.provider,
    totalTokens:
      typeof params.entry?.totalTokens === "number" ? params.entry.totalTokens : undefined,
    inputTokens:
      typeof params.entry?.inputTokens === "number" ? params.entry.inputTokens : undefined,
    outputTokens:
      typeof params.entry?.outputTokens === "number" ? params.entry.outputTokens : undefined,
  };
}

export async function getStatusSummary(params: {
  config: CrawClawConfig;
  sourceConfig?: CrawClawConfig;
}): Promise<StatusSummary> {
  void params.sourceConfig;
  const cfg = params.config;
  const agentList = listGatewayAgentsBasic(cfg);
  const now = Date.now();
  const byAgent = agentList.agents.map((agent) => {
    const path = resolveStorePath(cfg.session?.store, { agentId: agent.id });
    const store = readSessionStoreReadOnly(path);
    const recent = Object.entries(store)
      .filter(([key]) => key !== "global" && key !== "unknown")
      .map(([key, entry]) => toSessionStatus({ key, entry, cfg, agentId: agent.id, now }))
      .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 10);
    return {
      agentId: agent.id,
      path,
      count: Object.keys(store).filter((key) => key !== "global" && key !== "unknown").length,
      recent,
    };
  });
  const recent = byAgent
    .flatMap((entry) => entry.recent)
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 12);
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const defaultModel =
    resolveAgentModelPrimaryValue(cfg.agents?.defaults?.model) ?? DEFAULT_MODEL ?? null;

  return {
    runtimeVersion: resolveRuntimeServiceVersion(process.env),
    mainSessionWake: {
      defaultAgentId,
      agents: agentList.agents.map((agent) => ({ agentId: agent.id, enabled: false })),
    },
    queuedSystemEvents: peekSystemEvents(resolveMainSessionKey(cfg)),
    tasks: createEmptyTaskRegistrySummary(),
    taskAudit: createEmptyTaskAuditSummary(),
    sessions: {
      paths: byAgent.map((entry) => entry.path),
      count: byAgent.reduce((sum, entry) => sum + entry.count, 0),
      defaults: {
        model: defaultModel,
        contextTokens: DEFAULT_CONTEXT_TOKENS,
      },
      recent,
      byAgent,
    },
  };
}

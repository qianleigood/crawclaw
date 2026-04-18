import { Type } from "@sinclair/typebox";
import type { Static, TSchema } from "@sinclair/typebox";
import type { OperatorScope } from "../method-scopes.js";
import {
  AgentRuntimeCancelParamsSchema,
  AgentRuntimeCancelResultSchema,
  AgentRuntimeDetailResultSchema,
  AgentRuntimeGetParamsSchema,
  AgentRuntimeListParamsSchema,
  AgentRuntimeListResultSchema,
  AgentRuntimeSummaryParamsSchema,
  AgentRuntimeSummaryResultSchema,
} from "./schema/agent-runtime.ts";
import { AgentInspectionSnapshotSchema, AgentInspectParamsSchema } from "./schema/agent.ts";
import {
  AgentsListParamsSchema,
  AgentsListResultSchema,
  ToolsCatalogParamsSchema,
  ToolsCatalogResultSchema,
  ToolsEffectiveParamsSchema,
  ToolsEffectiveResultSchema,
} from "./schema/agents-models-skills.js";
import {
  ChannelsStatusParamsSchema,
  ChannelsStatusResultSchema,
  WebLoginStartParamsSchema,
  WebLoginWaitParamsSchema,
} from "./schema/channels.js";
import {
  ConfigApplyParamsSchema,
  ConfigGetParamsSchema,
  ConfigPatchParamsSchema,
  ConfigSchemaLookupParamsSchema,
  ConfigSchemaLookupResultSchema,
  ConfigSchemaParamsSchema,
  ConfigSchemaResponseSchema,
  ConfigSetParamsSchema,
} from "./schema/config.js";
import {
  ExecApprovalsGetParamsSchema,
  ExecApprovalsNodeGetParamsSchema,
  ExecApprovalsNodeSetParamsSchema,
  ExecApprovalsSetParamsSchema,
  ExecApprovalsSnapshotSchema,
} from "./schema/exec-approvals.js";
import {
  MemoryDreamHistoryResultSchema,
  MemoryDreamRunParamsSchema,
  MemoryDreamRunResultSchema,
  MemoryDreamStatusParamsSchema,
  MemoryDreamStatusResultSchema,
  MemoryLoginParamsSchema,
  MemoryLoginResultSchema,
  MemoryPromptJournalSummaryParamsSchema,
  MemoryPromptJournalSummaryResultSchema,
  MemoryProviderStatusSchema,
  MemoryRefreshParamsSchema,
  MemorySessionSummaryRefreshParamsSchema,
  MemorySessionSummaryRefreshResultSchema,
  MemorySessionSummaryStatusParamsSchema,
  MemorySessionSummaryStatusResultSchema,
  MemoryStatusParamsSchema,
} from "./schema/memory.ts";
import {
  SessionsAbortParamsSchema,
  SessionsCompactParamsSchema,
  SessionsCreateParamsSchema,
  SessionsDeleteParamsSchema,
  SessionsListParamsSchema,
  SessionsMessagesSubscribeParamsSchema,
  SessionsMessagesUnsubscribeParamsSchema,
  SessionsPatchParamsSchema,
  SessionsPreviewParamsSchema,
  SessionsResetParamsSchema,
  SessionsResolveParamsSchema,
  SessionsSendParamsSchema,
  SessionsUsageParamsSchema,
} from "./schema/sessions.js";
import { PresenceEntrySchema, HealthSnapshotSchema } from "./schema/snapshot.js";
import {
  CostUsageSummarySchema,
  SessionsUsageLogsParamsSchema,
  SessionsUsageLogsResultSchema,
  SessionsUsageResultSchema,
  SessionsUsageTimeSeriesParamsSchema,
  SessionsUsageTimeSeriesResultSchema,
  UsageCostParamsSchema,
  UsageStatusResultSchema,
} from "./schema/usage.ts";
import {
  WorkflowDeleteParamsSchema,
  WorkflowDeleteResultSchema,
  WorkflowDeployParamsSchema,
  WorkflowDiffParamsSchema,
  WorkflowDiffResultSchema,
  WorkflowExecutionActionResultSchema,
  WorkflowExecutionControlParamsSchema,
  WorkflowGetParamsSchema,
  WorkflowGetResultSchema,
  WorkflowListParamsSchema,
  WorkflowListResultSchema,
  WorkflowMatchParamsSchema,
  WorkflowMutationParamsSchema,
  WorkflowMutationResultSchema,
  WorkflowRepublishParamsSchema,
  WorkflowResumeParamsSchema,
  WorkflowRollbackParamsSchema,
  WorkflowRunParamsSchema,
  WorkflowRunsParamsSchema,
  WorkflowRunsResultSchema,
  WorkflowUpdateParamsSchema,
  WorkflowVersionsParamsSchema,
  WorkflowVersionsResultSchema,
} from "./schema/workflow.ts";

export type ControlUiMethodStability = "stable" | "optional" | "debug";

export type ControlUiMethodRestartEffect = "none" | "reconnect" | "reload" | "restart";

export type ControlUiMethodEffects = {
  writesConfig?: boolean;
  restart?: ControlUiMethodRestartEffect;
};

export type ControlUiMethodDefinition<
  Method extends string = string,
  ParamsSchema extends TSchema | undefined = TSchema | undefined,
  ResultSchema extends TSchema | undefined = TSchema | undefined,
> = {
  method: Method;
  paramsSchema?: ParamsSchema;
  resultSchema?: ResultSchema;
  requiredScopes?: readonly OperatorScope[];
  capability?: string;
  stability: ControlUiMethodStability;
  effects?: ControlUiMethodEffects;
  aliasFor?: string;
};

const EmptyParamsSchema = Type.Object({}, { additionalProperties: false });
const PresenceListResultSchema = Type.Array(PresenceEntrySchema);

function defineControlUiMethod<
  Method extends string,
  ParamsSchema extends TSchema | undefined = undefined,
  ResultSchema extends TSchema | undefined = undefined,
>(
  definition: ControlUiMethodDefinition<Method, ParamsSchema, ResultSchema>,
): ControlUiMethodDefinition<Method, ParamsSchema, ResultSchema> & {
  paramsSchema: ParamsSchema;
  resultSchema: ResultSchema;
} {
  return definition as ControlUiMethodDefinition<Method, ParamsSchema, ResultSchema> & {
    paramsSchema: ParamsSchema;
    resultSchema: ResultSchema;
  };
}

export const ControlUiMethodContract = {
  "config.get": defineControlUiMethod({
    method: "config.get",
    paramsSchema: ConfigGetParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "config.schema": defineControlUiMethod({
    method: "config.schema",
    paramsSchema: ConfigSchemaParamsSchema,
    resultSchema: ConfigSchemaResponseSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
  }),
  "config.schema.lookup": defineControlUiMethod({
    method: "config.schema.lookup",
    paramsSchema: ConfigSchemaLookupParamsSchema,
    resultSchema: ConfigSchemaLookupResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "config.set": defineControlUiMethod({
    method: "config.set",
    paramsSchema: ConfigSetParamsSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
    effects: {
      writesConfig: true,
      restart: "none",
    },
  }),
  "config.patch": defineControlUiMethod({
    method: "config.patch",
    paramsSchema: ConfigPatchParamsSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
    effects: {
      writesConfig: true,
      restart: "reload",
    },
  }),
  "config.apply": defineControlUiMethod({
    method: "config.apply",
    paramsSchema: ConfigApplyParamsSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
    effects: {
      writesConfig: true,
      restart: "reload",
    },
  }),
  "sessions.list": defineControlUiMethod({
    method: "sessions.list",
    paramsSchema: SessionsListParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.get": defineControlUiMethod({
    method: "sessions.get",
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.preview": defineControlUiMethod({
    method: "sessions.preview",
    paramsSchema: SessionsPreviewParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.resolve": defineControlUiMethod({
    method: "sessions.resolve",
    paramsSchema: SessionsResolveParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.subscribe": defineControlUiMethod({
    method: "sessions.subscribe",
    paramsSchema: EmptyParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.unsubscribe": defineControlUiMethod({
    method: "sessions.unsubscribe",
    paramsSchema: EmptyParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.messages.subscribe": defineControlUiMethod({
    method: "sessions.messages.subscribe",
    paramsSchema: SessionsMessagesSubscribeParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.messages.unsubscribe": defineControlUiMethod({
    method: "sessions.messages.unsubscribe",
    paramsSchema: SessionsMessagesUnsubscribeParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.create": defineControlUiMethod({
    method: "sessions.create",
    paramsSchema: SessionsCreateParamsSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "sessions.send": defineControlUiMethod({
    method: "sessions.send",
    paramsSchema: SessionsSendParamsSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "sessions.steer": defineControlUiMethod({
    method: "sessions.steer",
    paramsSchema: SessionsSendParamsSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "sessions.abort": defineControlUiMethod({
    method: "sessions.abort",
    paramsSchema: SessionsAbortParamsSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "sessions.patch": defineControlUiMethod({
    method: "sessions.patch",
    paramsSchema: SessionsPatchParamsSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
  }),
  "sessions.reset": defineControlUiMethod({
    method: "sessions.reset",
    paramsSchema: SessionsResetParamsSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
  }),
  "sessions.delete": defineControlUiMethod({
    method: "sessions.delete",
    paramsSchema: SessionsDeleteParamsSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
  }),
  "sessions.compact": defineControlUiMethod({
    method: "sessions.compact",
    paramsSchema: SessionsCompactParamsSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
  }),
  "sessions.usage": defineControlUiMethod({
    method: "sessions.usage",
    paramsSchema: SessionsUsageParamsSchema,
    resultSchema: SessionsUsageResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.usage.timeseries": defineControlUiMethod({
    method: "sessions.usage.timeseries",
    paramsSchema: SessionsUsageTimeSeriesParamsSchema,
    resultSchema: SessionsUsageTimeSeriesResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "sessions.usage.logs": defineControlUiMethod({
    method: "sessions.usage.logs",
    paramsSchema: SessionsUsageLogsParamsSchema,
    resultSchema: SessionsUsageLogsResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "channels.status": defineControlUiMethod({
    method: "channels.status",
    paramsSchema: ChannelsStatusParamsSchema,
    resultSchema: ChannelsStatusResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "channels.login.start": defineControlUiMethod({
    method: "channels.login.start",
    paramsSchema: WebLoginStartParamsSchema,
    requiredScopes: ["operator.admin"],
    capability: "channels.login",
    stability: "optional",
  }),
  "channels.login.wait": defineControlUiMethod({
    method: "channels.login.wait",
    paramsSchema: WebLoginWaitParamsSchema,
    requiredScopes: ["operator.admin"],
    capability: "channels.login",
    stability: "optional",
  }),
  "web.login.start": defineControlUiMethod({
    method: "web.login.start",
    paramsSchema: WebLoginStartParamsSchema,
    requiredScopes: ["operator.admin"],
    capability: "channels.login",
    stability: "optional",
    aliasFor: "channels.login.start",
  }),
  "web.login.wait": defineControlUiMethod({
    method: "web.login.wait",
    paramsSchema: WebLoginWaitParamsSchema,
    requiredScopes: ["operator.admin"],
    capability: "channels.login",
    stability: "optional",
    aliasFor: "channels.login.wait",
  }),
  "exec.approvals.get": defineControlUiMethod({
    method: "exec.approvals.get",
    paramsSchema: ExecApprovalsGetParamsSchema,
    resultSchema: ExecApprovalsSnapshotSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "exec.approvals.set": defineControlUiMethod({
    method: "exec.approvals.set",
    paramsSchema: ExecApprovalsSetParamsSchema,
    resultSchema: ExecApprovalsSnapshotSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
  }),
  "exec.approvals.node.get": defineControlUiMethod({
    method: "exec.approvals.node.get",
    paramsSchema: ExecApprovalsNodeGetParamsSchema,
    resultSchema: ExecApprovalsSnapshotSchema,
    requiredScopes: ["operator.read"],
    capability: "exec.approvals.node",
    stability: "optional",
  }),
  "exec.approvals.node.set": defineControlUiMethod({
    method: "exec.approvals.node.set",
    paramsSchema: ExecApprovalsNodeSetParamsSchema,
    resultSchema: ExecApprovalsSnapshotSchema,
    requiredScopes: ["operator.admin"],
    capability: "exec.approvals.node",
    stability: "optional",
  }),
  "agents.list": defineControlUiMethod({
    method: "agents.list",
    paramsSchema: AgentsListParamsSchema,
    resultSchema: AgentsListResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "agent.inspect": defineControlUiMethod({
    method: "agent.inspect",
    paramsSchema: AgentInspectParamsSchema,
    resultSchema: AgentInspectionSnapshotSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "tools.catalog": defineControlUiMethod({
    method: "tools.catalog",
    paramsSchema: ToolsCatalogParamsSchema,
    resultSchema: ToolsCatalogResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "tools.effective": defineControlUiMethod({
    method: "tools.effective",
    paramsSchema: ToolsEffectiveParamsSchema,
    resultSchema: ToolsEffectiveResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "memory.status": defineControlUiMethod({
    method: "memory.status",
    paramsSchema: MemoryStatusParamsSchema,
    resultSchema: MemoryProviderStatusSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "memory.refresh": defineControlUiMethod({
    method: "memory.refresh",
    paramsSchema: MemoryRefreshParamsSchema,
    resultSchema: MemoryProviderStatusSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
  }),
  "memory.login": defineControlUiMethod({
    method: "memory.login",
    paramsSchema: MemoryLoginParamsSchema,
    resultSchema: MemoryLoginResultSchema,
    requiredScopes: ["operator.admin"],
    stability: "stable",
  }),
  "memory.dream.status": defineControlUiMethod({
    method: "memory.dream.status",
    paramsSchema: MemoryDreamStatusParamsSchema,
    resultSchema: MemoryDreamStatusResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "memory.dream.history": defineControlUiMethod({
    method: "memory.dream.history",
    paramsSchema: MemoryDreamStatusParamsSchema,
    resultSchema: MemoryDreamHistoryResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "memory.dream.run": defineControlUiMethod({
    method: "memory.dream.run",
    paramsSchema: MemoryDreamRunParamsSchema,
    resultSchema: MemoryDreamRunResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "memory.sessionSummary.status": defineControlUiMethod({
    method: "memory.sessionSummary.status",
    paramsSchema: MemorySessionSummaryStatusParamsSchema,
    resultSchema: MemorySessionSummaryStatusResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "memory.sessionSummary.refresh": defineControlUiMethod({
    method: "memory.sessionSummary.refresh",
    paramsSchema: MemorySessionSummaryRefreshParamsSchema,
    resultSchema: MemorySessionSummaryRefreshResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "memory.promptJournal.summary": defineControlUiMethod({
    method: "memory.promptJournal.summary",
    paramsSchema: MemoryPromptJournalSummaryParamsSchema,
    resultSchema: MemoryPromptJournalSummaryResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "agentRuntime.summary": defineControlUiMethod({
    method: "agentRuntime.summary",
    paramsSchema: AgentRuntimeSummaryParamsSchema,
    resultSchema: AgentRuntimeSummaryResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "agentRuntime.list": defineControlUiMethod({
    method: "agentRuntime.list",
    paramsSchema: AgentRuntimeListParamsSchema,
    resultSchema: AgentRuntimeListResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "agentRuntime.get": defineControlUiMethod({
    method: "agentRuntime.get",
    paramsSchema: AgentRuntimeGetParamsSchema,
    resultSchema: AgentRuntimeDetailResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "agentRuntime.cancel": defineControlUiMethod({
    method: "agentRuntime.cancel",
    paramsSchema: AgentRuntimeCancelParamsSchema,
    resultSchema: AgentRuntimeCancelResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "usage.status": defineControlUiMethod({
    method: "usage.status",
    paramsSchema: EmptyParamsSchema,
    resultSchema: UsageStatusResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "usage.cost": defineControlUiMethod({
    method: "usage.cost",
    paramsSchema: UsageCostParamsSchema,
    resultSchema: CostUsageSummarySchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "workflow.list": defineControlUiMethod({
    method: "workflow.list",
    paramsSchema: WorkflowListParamsSchema,
    resultSchema: WorkflowListResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "workflow.get": defineControlUiMethod({
    method: "workflow.get",
    paramsSchema: WorkflowGetParamsSchema,
    resultSchema: WorkflowGetResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "workflow.match": defineControlUiMethod({
    method: "workflow.match",
    paramsSchema: WorkflowMatchParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "workflow.versions": defineControlUiMethod({
    method: "workflow.versions",
    paramsSchema: WorkflowVersionsParamsSchema,
    resultSchema: WorkflowVersionsResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "workflow.diff": defineControlUiMethod({
    method: "workflow.diff",
    paramsSchema: WorkflowDiffParamsSchema,
    resultSchema: WorkflowDiffResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "workflow.runs": defineControlUiMethod({
    method: "workflow.runs",
    paramsSchema: WorkflowRunsParamsSchema,
    resultSchema: WorkflowRunsResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "workflow.status": defineControlUiMethod({
    method: "workflow.status",
    paramsSchema: WorkflowExecutionControlParamsSchema,
    resultSchema: WorkflowExecutionActionResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "workflow.enable": defineControlUiMethod({
    method: "workflow.enable",
    paramsSchema: WorkflowMutationParamsSchema,
    resultSchema: WorkflowMutationResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.disable": defineControlUiMethod({
    method: "workflow.disable",
    paramsSchema: WorkflowMutationParamsSchema,
    resultSchema: WorkflowMutationResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.archive": defineControlUiMethod({
    method: "workflow.archive",
    paramsSchema: WorkflowMutationParamsSchema,
    resultSchema: WorkflowMutationResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.unarchive": defineControlUiMethod({
    method: "workflow.unarchive",
    paramsSchema: WorkflowMutationParamsSchema,
    resultSchema: WorkflowMutationResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.delete": defineControlUiMethod({
    method: "workflow.delete",
    paramsSchema: WorkflowDeleteParamsSchema,
    resultSchema: WorkflowDeleteResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.update": defineControlUiMethod({
    method: "workflow.update",
    paramsSchema: WorkflowUpdateParamsSchema,
    resultSchema: WorkflowMutationResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.deploy": defineControlUiMethod({
    method: "workflow.deploy",
    paramsSchema: WorkflowDeployParamsSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.republish": defineControlUiMethod({
    method: "workflow.republish",
    paramsSchema: WorkflowRepublishParamsSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.rollback": defineControlUiMethod({
    method: "workflow.rollback",
    paramsSchema: WorkflowRollbackParamsSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.run": defineControlUiMethod({
    method: "workflow.run",
    paramsSchema: WorkflowRunParamsSchema,
    resultSchema: WorkflowExecutionActionResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.cancel": defineControlUiMethod({
    method: "workflow.cancel",
    paramsSchema: WorkflowExecutionControlParamsSchema,
    resultSchema: WorkflowExecutionActionResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "workflow.resume": defineControlUiMethod({
    method: "workflow.resume",
    paramsSchema: WorkflowResumeParamsSchema,
    resultSchema: WorkflowExecutionActionResultSchema,
    requiredScopes: ["operator.write"],
    stability: "stable",
  }),
  "system.health": defineControlUiMethod({
    method: "system.health",
    paramsSchema: EmptyParamsSchema,
    resultSchema: HealthSnapshotSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "system.status": defineControlUiMethod({
    method: "system.status",
    paramsSchema: EmptyParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  health: defineControlUiMethod({
    method: "health",
    paramsSchema: EmptyParamsSchema,
    resultSchema: HealthSnapshotSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
    aliasFor: "system.health",
  }),
  status: defineControlUiMethod({
    method: "status",
    paramsSchema: EmptyParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
    aliasFor: "system.status",
  }),
  "system-presence": defineControlUiMethod({
    method: "system-presence",
    paramsSchema: EmptyParamsSchema,
    resultSchema: PresenceListResultSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "system.heartbeat.last": defineControlUiMethod({
    method: "system.heartbeat.last",
    paramsSchema: EmptyParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
  }),
  "last-heartbeat": defineControlUiMethod({
    method: "last-heartbeat",
    paramsSchema: EmptyParamsSchema,
    requiredScopes: ["operator.read"],
    stability: "stable",
    aliasFor: "system.heartbeat.last",
  }),
} as const;

type SchemaStatic<T extends TSchema | undefined> = T extends TSchema ? Static<T> : unknown;

export type ControlUiMethod = keyof typeof ControlUiMethodContract;

export type ControlUiMethodParamsMap = {
  [K in ControlUiMethod]: SchemaStatic<(typeof ControlUiMethodContract)[K]["paramsSchema"]>;
};

export type ControlUiMethodResultMap = {
  [K in ControlUiMethod]: SchemaStatic<(typeof ControlUiMethodContract)[K]["resultSchema"]>;
};

export const ControlUiMethodList = Object.freeze(
  Object.keys(ControlUiMethodContract) as ControlUiMethod[],
);

export const StableControlUiMethodList = Object.freeze(
  ControlUiMethodList.filter((method) => ControlUiMethodContract[method].stability === "stable"),
);

export const OptionalControlUiMethodList = Object.freeze(
  ControlUiMethodList.filter((method) => ControlUiMethodContract[method].stability === "optional"),
);

export const LegacyAliasControlUiMethodList = Object.freeze(
  ControlUiMethodList.filter((method) => Boolean(ControlUiMethodContract[method].aliasFor)),
);

export const PreferredControlUiMethodList = Object.freeze(
  ControlUiMethodList.filter((method) => !ControlUiMethodContract[method].aliasFor),
);

export function hasControlUiMethodDefinition(method: string): method is ControlUiMethod {
  return method in ControlUiMethodContract;
}

export function getControlUiMethodDefinition<K extends ControlUiMethod>(
  method: K,
): (typeof ControlUiMethodContract)[K] {
  return ControlUiMethodContract[method];
}

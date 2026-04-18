import type {
  ControlUiMethodParamsMap,
  ControlUiMethodResultMap,
} from "../../../../src/gateway/protocol/control-ui-methods.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type AgentRuntimeSummary = ControlUiMethodResultMap["agentRuntime.summary"];
export type AgentRuntimeListResult = ControlUiMethodResultMap["agentRuntime.list"];
export type AgentRuntimeDetail = ControlUiMethodResultMap["agentRuntime.get"];
export type AgentRuntimeCancelResult = ControlUiMethodResultMap["agentRuntime.cancel"];

export type AgentRuntimeCategory = NonNullable<
  ControlUiMethodParamsMap["agentRuntime.list"]["category"]
>;

export type AgentRuntimeStatusFilter = NonNullable<
  ControlUiMethodParamsMap["agentRuntime.list"]["status"]
>;

export type AgentRuntimeState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  runtimeLoading: boolean;
  runtimeError: string | null;
  runtimeSummary: AgentRuntimeSummary | null;
  runtimeRuns: AgentRuntimeListResult["runs"];
  runtimeSelectedTaskId: string;
  runtimeSelectedDetail: AgentRuntimeDetail | null;
  runtimeCategory: AgentRuntimeCategory;
  runtimeStatus: AgentRuntimeStatusFilter;
  runtimeAgent: string;
  runtimeSessionKey: string;
  runtimeTaskQuery: string;
  runtimeRunQuery: string;
  runtimeActionBusy: boolean;
  runtimeActionMessage: string | null;
};

function buildAgentRuntimeParams(
  state: AgentRuntimeState,
): ControlUiMethodParamsMap["agentRuntime.list"] {
  return {
    category: state.runtimeCategory,
    status: state.runtimeStatus,
    ...(state.runtimeAgent.trim() ? { agent: state.runtimeAgent.trim() } : {}),
    ...(state.runtimeSessionKey.trim() ? { sessionKey: state.runtimeSessionKey.trim() } : {}),
    ...(state.runtimeTaskQuery.trim() ? { taskId: state.runtimeTaskQuery.trim() } : {}),
    ...(state.runtimeRunQuery.trim() ? { runId: state.runtimeRunQuery.trim() } : {}),
    limit: 80,
  };
}

function toErrorMessage(error: unknown): string {
  return isMissingOperatorReadScopeError(error)
    ? formatMissingOperatorReadScopeMessage("agent runtime")
    : String(error);
}

export async function loadAgentRuntime(state: AgentRuntimeState) {
  if (!state.client || !state.connected || state.runtimeLoading) {
    return;
  }
  state.runtimeLoading = true;
  state.runtimeError = null;
  state.runtimeActionMessage = null;
  try {
    const params = buildAgentRuntimeParams(state);
    const [summary, list] = await Promise.all([
      state.client.request("agentRuntime.summary", params),
      state.client.request("agentRuntime.list", params),
    ]);
    state.runtimeSummary = summary;
    state.runtimeRuns = list.runs;
    const selectedTaskId =
      (state.runtimeSelectedTaskId &&
      list.runs.some((run) => run.taskId === state.runtimeSelectedTaskId)
        ? state.runtimeSelectedTaskId
        : list.runs[0]?.taskId) ?? "";
    state.runtimeSelectedTaskId = selectedTaskId;
    state.runtimeSelectedDetail = selectedTaskId
      ? await state.client.request("agentRuntime.get", { taskId: selectedTaskId })
      : null;
  } catch (error) {
    state.runtimeSummary = null;
    state.runtimeRuns = [];
    state.runtimeSelectedDetail = null;
    state.runtimeError = toErrorMessage(error);
  } finally {
    state.runtimeLoading = false;
  }
}

export async function selectAgentRuntimeTask(state: AgentRuntimeState, taskId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const normalized = taskId.trim();
  if (!normalized) {
    state.runtimeSelectedTaskId = "";
    state.runtimeSelectedDetail = null;
    return;
  }
  state.runtimeSelectedTaskId = normalized;
  try {
    state.runtimeSelectedDetail = await state.client.request("agentRuntime.get", {
      taskId: normalized,
    });
    state.runtimeActionMessage = null;
  } catch (error) {
    state.runtimeSelectedDetail = null;
    state.runtimeActionMessage = toErrorMessage(error);
  }
}

export async function cancelAgentRuntimeTask(state: AgentRuntimeState) {
  if (
    !state.client ||
    !state.connected ||
    state.runtimeActionBusy ||
    !state.runtimeSelectedTaskId.trim()
  ) {
    return;
  }
  state.runtimeActionBusy = true;
  state.runtimeActionMessage = null;
  try {
    const result: AgentRuntimeCancelResult = await state.client.request("agentRuntime.cancel", {
      taskId: state.runtimeSelectedTaskId.trim(),
    });
    state.runtimeActionMessage =
      result.reason ?? (result.cancelled ? "Task cancelled." : "Task was not cancelled.");
    await loadAgentRuntime(state);
  } catch (error) {
    state.runtimeActionMessage = String(error);
  } finally {
    state.runtimeActionBusy = false;
  }
}

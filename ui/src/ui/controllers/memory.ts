import type {
  ControlUiMethodParamsMap,
  ControlUiMethodResultMap,
} from "../../../../src/gateway/protocol/control-ui-methods.js";
import { resolveAgentIdFromSessionKey } from "../../../../src/routing/session-key.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { GatewaySessionRow } from "../types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type MemorySection = "provider" | "dreaming" | "summaries" | "journal";

export type MemoryProviderStatus = ControlUiMethodResultMap["memory.status"];
export type MemoryDreamStatusResult = ControlUiMethodResultMap["memory.dream.status"];
export type MemoryDreamRunResult = ControlUiMethodResultMap["memory.dream.run"];
export type MemorySessionSummaryStatusResult =
  ControlUiMethodResultMap["memory.sessionSummary.status"];
export type MemorySessionSummaryRefreshResult =
  ControlUiMethodResultMap["memory.sessionSummary.refresh"];
export type MemoryPromptJournalSummaryResult =
  ControlUiMethodResultMap["memory.promptJournal.summary"];

export type MemoryState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  activeSection: MemorySection;
  providerLoading: boolean;
  providerRefreshing: boolean;
  providerLoginBusy: boolean;
  providerStatus: MemoryProviderStatus | null;
  providerError: string | null;
  providerActionMessage: string | null;
  dreamLoading: boolean;
  dreamError: string | null;
  dreamStatus: MemoryDreamStatusResult | null;
  dreamActionBusy: boolean;
  dreamActionMessage: string | null;
  dreamAgent: string;
  dreamChannel: string;
  dreamUser: string;
  dreamScopeKey: string;
  summariesLoading: boolean;
  summariesError: string | null;
  summariesStatus: MemorySessionSummaryStatusResult | null;
  summariesRefreshBusy: boolean;
  summariesRefreshResult: MemorySessionSummaryRefreshResult | null;
  summariesSelectedSessionKey: string;
  summariesSelectedSessionId: string;
  summariesAgentId: string;
  journalLoading: boolean;
  journalError: string | null;
  journalSummary: MemoryPromptJournalSummaryResult | null;
  journalDays: string;
};

function buildDreamParams(
  state: Pick<MemoryState, "dreamAgent" | "dreamChannel" | "dreamUser" | "dreamScopeKey">,
): ControlUiMethodParamsMap["memory.dream.status"] {
  return {
    ...(state.dreamAgent.trim() ? { agent: state.dreamAgent.trim() } : {}),
    ...(state.dreamChannel.trim() ? { channel: state.dreamChannel.trim() } : {}),
    ...(state.dreamUser.trim() ? { user: state.dreamUser.trim() } : {}),
    ...(state.dreamScopeKey.trim() ? { scopeKey: state.dreamScopeKey.trim() } : {}),
  };
}

export function selectMemorySession(state: MemoryState, session: GatewaySessionRow | null) {
  if (!session) {
    state.summariesSelectedSessionKey = "";
    state.summariesSelectedSessionId = "";
    state.summariesAgentId = "";
    return;
  }
  state.summariesSelectedSessionKey = session.key;
  state.summariesSelectedSessionId = session.sessionId?.trim() || session.key;
  state.summariesAgentId =
    resolveAgentIdFromSessionKey(session.key)?.trim() || state.summariesAgentId || "main";
}

export async function loadMemoryProvider(state: MemoryState) {
  if (!state.client || !state.connected || state.providerLoading) {
    return;
  }
  state.providerLoading = true;
  state.providerError = null;
  try {
    state.providerStatus = await state.client.request("memory.status", {
      mode: "query",
    });
  } catch (error) {
    state.providerStatus = null;
    state.providerError = isMissingOperatorReadScopeError(error)
      ? formatMissingOperatorReadScopeMessage("memory provider status")
      : String(error);
  } finally {
    state.providerLoading = false;
  }
}

export async function refreshMemoryProvider(state: MemoryState) {
  if (!state.client || !state.connected || state.providerRefreshing) {
    return;
  }
  state.providerRefreshing = true;
  state.providerActionMessage = null;
  try {
    state.providerStatus = await state.client.request("memory.refresh", {
      mode: "query",
    });
  } catch (error) {
    state.providerActionMessage = String(error);
  } finally {
    state.providerRefreshing = false;
  }
}

export async function loginMemoryProvider(state: MemoryState) {
  if (!state.client || !state.connected || state.providerLoginBusy) {
    return;
  }
  state.providerLoginBusy = true;
  state.providerActionMessage = null;
  try {
    const result = await state.client.request("memory.login", {
      interactive: true,
    });
    state.providerActionMessage = result.message ?? result.status;
    state.providerStatus = result.providerState ?? state.providerStatus;
  } catch (error) {
    state.providerActionMessage = String(error);
  } finally {
    state.providerLoginBusy = false;
  }
}

export async function loadMemoryDreaming(state: MemoryState) {
  if (!state.client || !state.connected || state.dreamLoading) {
    return;
  }
  state.dreamLoading = true;
  state.dreamError = null;
  try {
    state.dreamStatus = await state.client.request("memory.dream.status", {
      ...buildDreamParams(state),
      limit: 12,
    });
  } catch (error) {
    state.dreamStatus = null;
    state.dreamError = isMissingOperatorReadScopeError(error)
      ? formatMissingOperatorReadScopeMessage("memory dreaming state")
      : String(error);
  } finally {
    state.dreamLoading = false;
  }
}

export async function runMemoryDream(
  state: MemoryState,
  params?: Partial<ControlUiMethodParamsMap["memory.dream.run"]>,
) {
  if (!state.client || !state.connected || state.dreamActionBusy) {
    return;
  }
  state.dreamActionBusy = true;
  state.dreamActionMessage = null;
  try {
    const result = await state.client.request("memory.dream.run", {
      ...buildDreamParams(state),
      ...params,
    });
    state.dreamActionMessage = result.reason ?? result.status;
    state.dreamStatus = await state.client.request("memory.dream.status", {
      ...buildDreamParams(state),
      limit: 12,
    });
  } catch (error) {
    state.dreamActionMessage = String(error);
  } finally {
    state.dreamActionBusy = false;
  }
}

export async function loadMemorySessionSummary(state: MemoryState) {
  if (
    !state.client ||
    !state.connected ||
    state.summariesLoading ||
    !state.summariesSelectedSessionId
  ) {
    return;
  }
  state.summariesLoading = true;
  state.summariesError = null;
  try {
    state.summariesStatus = await state.client.request("memory.sessionSummary.status", {
      agent: state.summariesAgentId || undefined,
      sessionId: state.summariesSelectedSessionId,
    });
  } catch (error) {
    state.summariesStatus = null;
    state.summariesError = isMissingOperatorReadScopeError(error)
      ? formatMissingOperatorReadScopeMessage("memory session summary")
      : String(error);
  } finally {
    state.summariesLoading = false;
  }
}

export async function refreshMemorySessionSummary(state: MemoryState) {
  if (
    !state.client ||
    !state.connected ||
    state.summariesRefreshBusy ||
    !state.summariesSelectedSessionId ||
    !state.summariesSelectedSessionKey
  ) {
    return;
  }
  state.summariesRefreshBusy = true;
  state.summariesError = null;
  try {
    state.summariesRefreshResult = await state.client.request("memory.sessionSummary.refresh", {
      agent: state.summariesAgentId || undefined,
      sessionId: state.summariesSelectedSessionId,
      sessionKey: state.summariesSelectedSessionKey,
      force: true,
    });
    await loadMemorySessionSummary(state);
  } catch (error) {
    state.summariesRefreshResult = null;
    state.summariesError = String(error);
  } finally {
    state.summariesRefreshBusy = false;
  }
}

export async function loadMemoryPromptJournal(state: MemoryState) {
  if (!state.client || !state.connected || state.journalLoading) {
    return;
  }
  state.journalLoading = true;
  state.journalError = null;
  try {
    state.journalSummary = await state.client.request("memory.promptJournal.summary", {
      days: Number.parseInt(state.journalDays, 10) > 0 ? Number.parseInt(state.journalDays, 10) : 1,
    });
  } catch (error) {
    state.journalSummary = null;
    state.journalError = isMissingOperatorReadScopeError(error)
      ? formatMissingOperatorReadScopeMessage("memory prompt journal")
      : String(error);
  } finally {
    state.journalLoading = false;
  }
}

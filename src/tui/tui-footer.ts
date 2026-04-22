import { formatTuiFooterLine } from "./tui-formatters.js";
import type { SessionInfo } from "./tui-types.js";

export const TUI_FOOTER_HINT = "Ctrl+P sessions; Ctrl+O tools; /help";

export function formatTuiFooter(params: {
  currentAgentId: string;
  currentSessionKey: string;
  sessionInfo: SessionInfo;
  deliverEnabled: boolean;
  formatAgentLabel: (agentId: string) => string;
  formatSessionKey: (sessionKey: string) => string;
  hint?: string;
}) {
  const sessionKeyLabel = params.formatSessionKey(params.currentSessionKey);
  const sessionLabel = params.sessionInfo.displayName
    ? `${sessionKeyLabel} (${params.sessionInfo.displayName})`
    : sessionKeyLabel;

  return formatTuiFooterLine({
    agentLabel: params.formatAgentLabel(params.currentAgentId),
    sessionLabel,
    model: params.sessionInfo.model,
    modelProvider: params.sessionInfo.modelProvider,
    totalTokens: params.sessionInfo.totalTokens ?? null,
    contextTokens: params.sessionInfo.contextTokens ?? null,
    thinkingLevel: params.sessionInfo.thinkingLevel,
    fastMode: params.sessionInfo.fastMode,
    verboseLevel: params.sessionInfo.verboseLevel,
    reasoningLevel: params.sessionInfo.reasoningLevel,
    deliverEnabled: params.deliverEnabled,
    hint: params.hint ?? TUI_FOOTER_HINT,
  });
}

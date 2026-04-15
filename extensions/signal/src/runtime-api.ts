// Private runtime barrel for the bundled Signal extension.
// Prefer narrower SDK subpaths plus local extension seams over the legacy signal barrel.

export type { ChannelMessageActionAdapter } from "crawclaw/plugin-sdk/channel-contract";
export { SignalConfigSchema } from "crawclaw/plugin-sdk/channel-config-schema";
export { PAIRING_APPROVED_MESSAGE } from "crawclaw/plugin-sdk/channel-status";
import type { CrawClawConfig as RuntimeCrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
export type { RuntimeCrawClawConfig as CrawClawConfig };
export type { CrawClawPluginApi, PluginRuntime } from "crawclaw/plugin-sdk/core";
export type { ChannelPlugin } from "crawclaw/plugin-sdk/core";
export {
  DEFAULT_ACCOUNT_ID,
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  deleteAccountFromConfigSection,
  emptyPluginConfigSchema,
  formatPairingApproveHint,
  getChatChannelMeta,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  setAccountEnabledInConfigSection,
} from "crawclaw/plugin-sdk/core";
export { resolveChannelMediaMaxBytes } from "crawclaw/plugin-sdk/media-runtime";
export { formatCliCommand, formatDocsLink } from "crawclaw/plugin-sdk/setup-tools";
export { chunkText } from "crawclaw/plugin-sdk/reply-runtime";
export { detectBinary, installSignalCli } from "crawclaw/plugin-sdk/setup-tools";
export {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "crawclaw/plugin-sdk/config-runtime";
export {
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  collectStatusIssuesFromLastError,
  createDefaultChannelRuntimeState,
} from "crawclaw/plugin-sdk/status-helpers";
export { normalizeE164 } from "crawclaw/plugin-sdk/text-runtime";
export { looksLikeSignalTargetId, normalizeSignalMessagingTarget } from "./normalize.js";
export {
  listEnabledSignalAccounts,
  listSignalAccountIds,
  resolveDefaultSignalAccountId,
  resolveSignalAccount,
} from "./accounts.js";
export { monitorSignalProvider } from "./monitor.js";
export { probeSignal } from "./probe.js";
export { resolveSignalReactionLevel } from "./reaction-level.js";
export { removeReactionSignal, sendReactionSignal } from "./send-reactions.js";
export { sendMessageSignal } from "./send.js";
export { signalMessageActions } from "./message-actions.js";
export type { ResolvedSignalAccount } from "./accounts.js";
export type SignalAccountConfig = Omit<
  Exclude<NonNullable<RuntimeCrawClawConfig["channels"]>["signal"], undefined>,
  "accounts"
>;

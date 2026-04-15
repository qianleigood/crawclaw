import type { CrawClawConfig as RuntimeApiCrawClawConfig } from "crawclaw/plugin-sdk/core";

export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  getChatChannelMeta,
  type ChannelPlugin,
  type CrawClawConfig,
} from "crawclaw/plugin-sdk/core";
export { PAIRING_APPROVED_MESSAGE } from "crawclaw/plugin-sdk/channel-status";
export {
  buildComputedAccountStatusSnapshot,
  collectStatusIssuesFromLastError,
} from "crawclaw/plugin-sdk/status-helpers";
export {
  formatTrimmedAllowFromEntries,
  resolveIMessageConfigAllowFrom,
  resolveIMessageConfigDefaultTo,
} from "crawclaw/plugin-sdk/channel-config-helpers";
export { looksLikeIMessageTargetId, normalizeIMessageMessagingTarget } from "./src/normalize.js";
export { resolveChannelMediaMaxBytes } from "crawclaw/plugin-sdk/media-runtime";
export { IMessageConfigSchema } from "crawclaw/plugin-sdk/channel-config-schema";
export {
  resolveIMessageGroupRequireMention,
  resolveIMessageGroupToolPolicy,
} from "./src/group-policy.js";

export { monitorIMessageProvider } from "./src/monitor.js";
export type { MonitorIMessageOpts } from "./src/monitor.js";
export { probeIMessage } from "./src/probe.js";
export type { IMessageProbe } from "./src/probe.js";
export { sendMessageIMessage } from "./src/send.js";

export type IMessageAccountConfig = Omit<
  NonNullable<NonNullable<RuntimeApiCrawClawConfig["channels"]>["imessage"]>,
  "accounts" | "defaultAccount"
>;

export function chunkTextForOutbound(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const splitAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const breakAt = splitAt > 0 ? splitAt : limit;
    chunks.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining.length > 0 || text.length === 0) {
    chunks.push(remaining);
  }
  return chunks;
}

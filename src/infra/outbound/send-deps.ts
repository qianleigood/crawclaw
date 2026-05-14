/**
 * Dynamic bag of per-channel send functions, keyed by channel ID.
 * Each outbound adapter resolves its own function from this record.
 */
export type OutboundSendDeps = { [channelId: string]: unknown };

export function resolveOutboundSendDep<T>(
  deps: OutboundSendDeps | null | undefined,
  channelId: string,
): T | undefined {
  const dynamic = deps?.[channelId];
  return dynamic as T | undefined;
}

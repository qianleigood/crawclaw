import type { ReplyDispatchKind } from "../auto-reply/reply/reply-dispatcher.js";
import { getChannelPlugin, normalizeChannelId } from "./plugins/index.js";

export function resolveAcpDeliveryChannel(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function shouldTreatAcpDeliveredTextAsVisible(params: {
  channel: string | undefined;
  kind: ReplyDispatchKind;
  text: string | undefined;
}): boolean {
  if (!params.text?.trim()) {
    return false;
  }
  const channel = resolveAcpDeliveryChannel(params.channel);
  const normalizedChannel = normalizeChannelId(channel);
  const adapter = normalizedChannel ? getChannelPlugin(normalizedChannel)?.outbound : undefined;
  if (adapter?.shouldTreatDeliveredTextAsVisible) {
    return adapter.shouldTreatDeliveredTextAsVisible({
      kind: params.kind,
      text: params.text,
    });
  }
  if (params.kind === "final") {
    return true;
  }
  return false;
}

import type { ReplyDispatchKind } from "../auto-reply/reply/reply-dispatcher.js";

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
  if (params.kind === "final") {
    return true;
  }
  return resolveAcpDeliveryChannel(params.channel) === "telegram";
}

import { CHANNEL_IDS } from "../../channels/ids.js";
import type { ChannelId } from "../../channels/plugins/types.js";
import {
  resolveRustOutboundTransportPolicy,
  type RustOutboundTransportPolicy,
} from "./message-policy-runtime.js";

export async function resolveOutboundTransportPolicy(
  channel: ChannelId,
): Promise<RustOutboundTransportPolicy> {
  return await resolveRustOutboundTransportPolicy({
    channel,
    bundledChannels: [...CHANNEL_IDS],
    allowTsChannelRuntime: false,
  });
}

export async function shouldUseNativeGatewayOutbound(channel: ChannelId): Promise<boolean> {
  return (await resolveOutboundTransportPolicy(channel)).useNativeGateway;
}

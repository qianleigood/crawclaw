import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChannelsStatusSnapshot, FeishuCliStatusSnapshot } from "../types.ts";

export type ChannelsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  channelsLoading: boolean;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsError: string | null;
  channelsLastSuccess: number | null;
  feishuCliStatus: FeishuCliStatusSnapshot | null;
  feishuCliError: string | null;
  feishuCliLastSuccess: number | null;
  feishuCliSupported: boolean | null;
  whatsappLoginMessage: string | null;
  whatsappLoginQrDataUrl: string | null;
  whatsappLoginConnected: boolean | null;
  whatsappBusy: boolean;
};

import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChannelSetupSurfaceSnapshot } from "../types.ts";

export type ChannelSetupState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  selectedChannelId: string | null;
  loading: boolean;
  surface: ChannelSetupSurfaceSnapshot | null;
  lastError: string | null;
};

export function resetChannelSetupState(state: ChannelSetupState) {
  state.selectedChannelId = null;
  state.loading = false;
  state.surface = null;
  state.lastError = null;
}

export async function loadChannelSetupSurface(state: ChannelSetupState, channelId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.selectedChannelId = channelId;
  state.loading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<ChannelSetupSurfaceSnapshot>("channels.setup.surface", {
      channel: channelId,
    });
    if (state.selectedChannelId !== channelId) {
      return;
    }
    state.surface = res;
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.loading = false;
  }
}

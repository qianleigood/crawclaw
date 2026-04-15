import { GatewayRequestError } from "../gateway.ts";
import { ChannelsStatusSnapshot, FeishuCliStatusSnapshot } from "../types.ts";
import type { ChannelsState } from "./channels.types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type { ChannelsState };

function isUnknownMethodError(err: unknown, method: string): boolean {
  return (
    err instanceof GatewayRequestError &&
    err.gatewayCode === "INVALID_REQUEST" &&
    err.message.includes(`unknown method: ${method}`)
  );
}

export async function loadChannels(state: ChannelsState, probe: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.channelsLoading) {
    return;
  }
  state.channelsLoading = true;
  state.channelsError = null;
  state.feishuCliError = null;
  try {
    const [channelsResult, feishuCliResult] = await Promise.allSettled([
      state.client.request<ChannelsStatusSnapshot | null>("channels.status", {
        probe,
        timeoutMs: 8000,
      }),
      state.client.request<FeishuCliStatusSnapshot>("feishu.cli.status", {
        verify: false,
        timeoutMs: 8000,
      }),
    ]);
    const completedAt = Date.now();

    if (channelsResult.status === "fulfilled") {
      state.channelsSnapshot = channelsResult.value;
      state.channelsLastSuccess = completedAt;
    } else {
      const err = channelsResult.reason;
      if (isMissingOperatorReadScopeError(err)) {
        state.channelsSnapshot = null;
        state.channelsError = formatMissingOperatorReadScopeMessage("channel status");
      } else {
        state.channelsError = String(err);
      }
    }

    if (feishuCliResult.status === "fulfilled") {
      state.feishuCliStatus = feishuCliResult.value;
      state.feishuCliSupported = true;
      state.feishuCliLastSuccess = completedAt;
    } else {
      const err = feishuCliResult.reason;
      if (isUnknownMethodError(err, "feishu.cli.status")) {
        state.feishuCliStatus = null;
        state.feishuCliSupported = false;
        state.feishuCliLastSuccess = completedAt;
      } else if (isMissingOperatorReadScopeError(err)) {
        state.feishuCliStatus = null;
        state.feishuCliSupported = true;
        state.feishuCliError = formatMissingOperatorReadScopeMessage("Feishu CLI user status");
      } else {
        state.feishuCliStatus = null;
        state.feishuCliSupported = true;
        state.feishuCliError = String(err);
      }
    }
  } catch (err) {
    if (isMissingOperatorReadScopeError(err)) {
      state.channelsSnapshot = null;
      state.channelsError = formatMissingOperatorReadScopeMessage("channel status");
    } else {
      state.channelsError = String(err);
    }
  } finally {
    state.channelsLoading = false;
  }
}

export async function startWhatsAppLogin(state: ChannelsState, force: boolean) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; qrDataUrl?: string }>(
      "web.login.start",
      {
        force,
        timeoutMs: 30000,
      },
    );
    state.whatsappLoginMessage = res.message ?? null;
    state.whatsappLoginQrDataUrl = res.qrDataUrl ?? null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function waitWhatsAppLogin(state: ChannelsState) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; connected?: boolean }>(
      "web.login.wait",
      {
        timeoutMs: 120000,
      },
    );
    state.whatsappLoginMessage = res.message ?? null;
    state.whatsappLoginConnected = res.connected ?? null;
    if (res.connected) {
      state.whatsappLoginQrDataUrl = null;
    }
  } catch (err) {
    state.whatsappLoginMessage = String(err);
    state.whatsappLoginConnected = null;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function logoutWhatsApp(state: ChannelsState) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    await state.client.request("channels.logout", { channel: "whatsapp" });
    state.whatsappLoginMessage = "Logged out.";
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
  } finally {
    state.whatsappBusy = false;
  }
}

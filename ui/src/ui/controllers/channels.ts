import { FeishuCliStatusSnapshot } from "../types.ts";
import type { ChannelsState } from "./channels.types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type { ChannelsState };

function resolveStartLoginMethod(
  state: ChannelsState,
): "channels.login.start" | "web.login.start" | null {
  if (state.client?.hasMethod("channels.login.start")) {
    return "channels.login.start";
  }
  if (state.client?.hasMethod("web.login.start")) {
    return "web.login.start";
  }
  return null;
}

function resolveWaitLoginMethod(
  state: ChannelsState,
): "channels.login.wait" | "web.login.wait" | null {
  if (state.client?.hasMethod("channels.login.wait")) {
    return "channels.login.wait";
  }
  if (state.client?.hasMethod("web.login.wait")) {
    return "web.login.wait";
  }
  return null;
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
    const feishuCliSupported = state.client.hasMethod("feishu.cli.status");
    const [channelsResult, feishuCliResult] = await Promise.allSettled([
      state.client.request("channels.status", {
        probe,
        timeoutMs: 8000,
      }),
      feishuCliSupported
        ? state.client.request<FeishuCliStatusSnapshot>("feishu.cli.status", {
            verify: false,
            timeoutMs: 8000,
          })
        : Promise.resolve<FeishuCliStatusSnapshot | null>(null),
    ]);
    const completedAt = Date.now();

    if (channelsResult.status === "fulfilled") {
      state.channelsSnapshot = channelsResult.value as ChannelsState["channelsSnapshot"];
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

    if (!feishuCliSupported) {
      state.feishuCliStatus = null;
      state.feishuCliSupported = false;
      state.feishuCliLastSuccess = completedAt;
    } else if (feishuCliResult.status === "fulfilled") {
      state.feishuCliStatus = feishuCliResult.value;
      state.feishuCliSupported = true;
      state.feishuCliLastSuccess = completedAt;
    } else {
      const err = feishuCliResult.reason;
      if (isMissingOperatorReadScopeError(err)) {
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
  const method = resolveStartLoginMethod(state);
  if (!method) {
    state.whatsappLoginMessage = "WhatsApp login is not supported by this gateway.";
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; qrDataUrl?: string }>(method, {
      force,
      timeoutMs: 30000,
    });
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
  const method = resolveWaitLoginMethod(state);
  if (!method) {
    state.whatsappLoginMessage = "WhatsApp login wait is not supported by this gateway.";
    state.whatsappLoginConnected = null;
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; connected?: boolean }>(method, {
      timeoutMs: 120000,
    });
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

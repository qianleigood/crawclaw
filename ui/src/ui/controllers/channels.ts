import { FeishuCliStatusSnapshot } from "../types.ts";
import type { ChannelsState } from "./channels.types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type { ChannelsState };

function resolveStartLoginMethod(
  state: ChannelsState,
): "channels.account.login.start" | "channels.login.start" | "web.login.start" | null {
  if (state.client?.hasMethod("channels.account.login.start")) {
    return "channels.account.login.start";
  }
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
): "channels.account.login.wait" | "channels.login.wait" | "web.login.wait" | null {
  if (state.client?.hasMethod("channels.account.login.wait")) {
    return "channels.account.login.wait";
  }
  if (state.client?.hasMethod("channels.login.wait")) {
    return "channels.login.wait";
  }
  if (state.client?.hasMethod("web.login.wait")) {
    return "web.login.wait";
  }
  return null;
}

function resolveLogoutMethod(
  state: ChannelsState,
): "channels.account.logout" | "channels.logout" | null {
  if (state.client?.hasMethod("channels.account.logout")) {
    return "channels.account.logout";
  }
  if (state.client?.hasMethod("channels.logout")) {
    return "channels.logout";
  }
  return null;
}

function resolveReconnectMethod(state: ChannelsState): "channels.account.reconnect" | null {
  if (state.client?.hasMethod("channels.account.reconnect")) {
    return "channels.account.reconnect";
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

export async function startWhatsAppLogin(
  state: ChannelsState,
  force: boolean,
  channel: string,
  accountId?: string | null,
) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  const method = resolveStartLoginMethod(state);
  if (!method) {
    state.whatsappLoginMessage = "This channel does not expose a QR login flow.";
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; qrDataUrl?: string }>(method, {
      ...(method === "channels.account.login.start" ? { channel } : {}),
      force,
      timeoutMs: 30000,
      ...(accountId?.trim() ? { accountId: accountId.trim() } : {}),
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

export async function waitWhatsAppLogin(
  state: ChannelsState,
  channel: string,
  accountId?: string | null,
) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  const method = resolveWaitLoginMethod(state);
  if (!method) {
    state.whatsappLoginMessage = "This channel does not expose a QR login flow.";
    state.whatsappLoginConnected = null;
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; connected?: boolean }>(method, {
      ...(method === "channels.account.login.wait" ? { channel } : {}),
      timeoutMs: 120000,
      ...(accountId?.trim() ? { accountId: accountId.trim() } : {}),
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

export async function logoutWhatsApp(
  state: ChannelsState,
  channel: string,
  accountId?: string | null,
) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  const method = resolveLogoutMethod(state);
  if (!method) {
    state.whatsappLoginMessage = "This channel cannot log out through the gateway.";
    return;
  }
  state.whatsappBusy = true;
  try {
    await state.client.request(method, {
      channel,
      ...(accountId?.trim() ? { accountId: accountId.trim() } : {}),
    });
    state.whatsappLoginMessage = "Logged out.";
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
  } finally {
    state.whatsappBusy = false;
  }
}

export async function verifyChannelAccount(
  state: ChannelsState,
  channel: string,
  accountId?: string | null,
) {
  if (!state.client || !state.connected || state.channelsLoading) {
    return;
  }
  if (!state.client.hasMethod("channels.account.verify")) {
    await loadChannels(state, true);
    return;
  }
  state.channelsLoading = true;
  state.channelsError = null;
  try {
    const result = await state.client.request<{
      channel: string;
      accountId: string;
      snapshot: NonNullable<ChannelsState["channelsSnapshot"]>["channelAccounts"][string][number];
    }>("channels.account.verify", {
      channel,
      ...(accountId?.trim() ? { accountId: accountId.trim() } : {}),
      timeoutMs: 8000,
    });
    const snapshot = state.channelsSnapshot;
    if (snapshot?.channelAccounts[result.channel]) {
      snapshot.channelAccounts[result.channel] = snapshot.channelAccounts[result.channel].map(
        (entry) => (entry.accountId === result.accountId ? result.snapshot : entry),
      );
      state.channelsSnapshot = { ...snapshot };
      state.channelsLastSuccess = Date.now();
    } else {
      await loadChannels(state, true);
    }
  } catch (err) {
    if (isMissingOperatorReadScopeError(err)) {
      state.channelsError = formatMissingOperatorReadScopeMessage("channel verification");
    } else {
      state.channelsError = String(err);
    }
  } finally {
    state.channelsLoading = false;
  }
}

export async function reconnectChannelAccount(
  state: ChannelsState,
  channel: string,
  accountId?: string | null,
) {
  if (!state.client || !state.connected || state.channelsLoading) {
    return;
  }
  const method = resolveReconnectMethod(state);
  if (!method) {
    await loadChannels(state, true);
    return;
  }
  state.channelsLoading = true;
  state.channelsError = null;
  try {
    const result = await state.client.request<{
      channel: string;
      accountId: string;
      snapshot?: NonNullable<ChannelsState["channelsSnapshot"]>["channelAccounts"][string][number];
    }>(method, {
      channel,
      ...(accountId?.trim() ? { accountId: accountId.trim() } : {}),
      timeoutMs: 10_000,
    });
    const snapshot = state.channelsSnapshot;
    if (snapshot?.channelAccounts[result.channel] && result.snapshot) {
      snapshot.channelAccounts[result.channel] = snapshot.channelAccounts[result.channel].map(
        (entry) => (entry.accountId === result.accountId ? result.snapshot! : entry),
      );
      state.channelsSnapshot = { ...snapshot };
      state.channelsLastSuccess = Date.now();
    }
    state.channelsLoading = false;
    await loadChannels(state, true);
    return;
  } catch (err) {
    if (isMissingOperatorReadScopeError(err)) {
      state.channelsError = formatMissingOperatorReadScopeMessage("channel reconnect");
    } else {
      state.channelsError = String(err);
    }
  } finally {
    state.channelsLoading = false;
  }
}

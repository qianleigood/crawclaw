import { describe, expect, it, vi } from "vitest";
import {
  loadChannelSetupSurface,
  resetChannelSetupState,
  type ChannelSetupState,
} from "./channel-setup.ts";

function createState() {
  const request = vi.fn();
  const state: ChannelSetupState = {
    client: {
      request,
    } as unknown as ChannelSetupState["client"],
    connected: true,
    selectedChannelId: null,
    loading: false,
    surface: null,
    lastError: null,
  };
  return { state, request };
}

describe("channel setup controller", () => {
  it("loads a setup surface for the selected channel", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      channel: "telegram",
      label: "Telegram",
      detailLabel: "Telegram",
      configured: false,
      mode: "wizard",
      statusLines: ["Telegram: needs token"],
      accountIds: [],
      canSetup: true,
      canEdit: true,
      multiAccount: false,
      loginMode: "none",
      commands: ["crawclaw channels add --channel telegram"],
    });

    await loadChannelSetupSurface(state, "telegram");

    expect(request).toHaveBeenCalledWith("channels.setup.surface", {
      channel: "telegram",
    });
    expect(state.surface?.channel).toBe("telegram");
    expect(state.lastError).toBeNull();
  });

  it("resets channel setup state", () => {
    const { state } = createState();
    state.selectedChannelId = "telegram";
    state.loading = true;
    state.surface = {
      channel: "telegram",
      label: "Telegram",
      detailLabel: "Telegram",
      configured: false,
      mode: "wizard",
      statusLines: [],
      accountIds: [],
      canSetup: true,
      canEdit: true,
      multiAccount: false,
      loginMode: "none",
      commands: [],
    };
    state.lastError = "boom";

    resetChannelSetupState(state);

    expect(state.selectedChannelId).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.surface).toBeNull();
    expect(state.lastError).toBeNull();
  });
});

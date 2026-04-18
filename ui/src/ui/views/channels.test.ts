/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import {
  channelEnabled,
  resolveChannelConfigured,
  resolveChannelDisplayState,
} from "./channels.shared.ts";
import { formatStreamingState, renderChannels } from "./channels.ts";
import type { ChannelsProps } from "./channels.types.ts";

function createProps(
  snapshot: ChannelsProps["snapshot"],
  overrides: Partial<ChannelsProps> = {},
): ChannelsProps {
  return {
    uiMode: "simple",
    onboarding: false,
    onboardingProgress: null,
    connected: true,
    gatewayUrl: "ws://127.0.0.1:18789",
    loading: false,
    snapshot,
    lastError: null,
    lastSuccessAt: null,
    feishuCliStatus: null,
    feishuCliError: null,
    feishuCliLastSuccessAt: null,
    feishuCliSupported: null,
    whatsappMessage: null,
    whatsappQrDataUrl: null,
    whatsappConnected: null,
    whatsappBusy: false,
    configSchema: null,
    configSchemaLoading: false,
    configForm: null,
    configUiHints: {},
    configSaving: false,
    configFormDirty: false,
    nostrProfileFormState: null,
    nostrProfileAccountId: null,
    onNavigate: () => {},
    onResumeOnboarding: () => {},
    onRestartOnboarding: () => {},
    onRefresh: () => {},
    onWhatsAppStart: () => {},
    onWhatsAppWait: () => {},
    onWhatsAppLogout: () => {},
    onConfigPatch: () => {},
    onConfigSave: () => {},
    onConfigReload: () => {},
    onNostrProfileEdit: () => {},
    onNostrProfileCancel: () => {},
    onNostrProfileFieldChange: () => {},
    onNostrProfileSave: () => {},
    onNostrProfileImport: () => {},
    onNostrProfileToggleAdvanced: () => {},
    ...overrides,
  };
}

describe("channel display selectors", () => {
  it("returns the channel summary configured flag when present", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["discord"],
      channelLabels: { discord: "Discord" },
      channels: { discord: { configured: false } },
      channelAccounts: {
        discord: [{ accountId: "discord-main", configured: true }],
      },
      channelDefaultAccountId: { discord: "discord-main" },
    });

    expect(resolveChannelConfigured("discord", props)).toBe(false);
    expect(resolveChannelDisplayState("discord", props).configured).toBe(false);
  });

  it("falls back to the default account when the channel summary omits configured", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["discord"],
      channelLabels: { discord: "Discord" },
      channels: { discord: { running: true } },
      channelAccounts: {
        discord: [
          { accountId: "default", configured: false },
          { accountId: "discord-main", configured: true },
        ],
      },
      channelDefaultAccountId: { discord: "discord-main" },
    });

    const displayState = resolveChannelDisplayState("discord", props);

    expect(resolveChannelConfigured("discord", props)).toBe(true);
    expect(displayState.defaultAccount?.accountId).toBe("discord-main");
    expect(channelEnabled("discord", props)).toBe(true);
  });

  it("falls back to the first account when no default account id is available", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["slack"],
      channelLabels: { slack: "Slack" },
      channels: { slack: { running: true } },
      channelAccounts: {
        slack: [{ accountId: "workspace-a", configured: true }],
      },
      channelDefaultAccountId: {},
    });

    const displayState = resolveChannelDisplayState("slack", props);

    expect(resolveChannelConfigured("slack", props)).toBe(true);
    expect(displayState.defaultAccount?.accountId).toBe("workspace-a");
  });

  it("keeps disabled channels hidden when neither summary nor accounts are active", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["signal"],
      channelLabels: { signal: "Signal" },
      channels: { signal: {} },
      channelAccounts: {
        signal: [{ accountId: "default", configured: false, running: false, connected: false }],
      },
      channelDefaultAccountId: { signal: "default" },
    });

    const displayState = resolveChannelDisplayState("signal", props);

    expect(displayState.configured).toBe(false);
    expect(displayState.running).toBeNull();
    expect(displayState.connected).toBeNull();
    expect(channelEnabled("signal", props)).toBe(false);
  });

  it("formats channel streaming state for UI cards", () => {
    expect(
      formatStreamingState({
        accountId: "workspace-a",
        streaming: {
          ts: Date.now(),
          surface: "editable_draft_stream",
          enabled: true,
          reason: "enabled",
        },
      }),
    ).toContain("editable_draft_stream");
  });

  it("renders a separate Feishu CLI user-identity card", async () => {
    const container = document.createElement("div");
    render(
      renderChannels(
        createProps({
          ts: Date.now(),
          channelOrder: ["discord"],
          channelLabels: { discord: "Discord" },
          channels: { discord: { configured: true } },
          channelAccounts: {},
          channelDefaultAccountId: {},
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Feishu user identity");
    expect(container.textContent).toContain("crawclaw feishu-cli status --verify");
    expect(container.textContent).toContain("Advanced channel snapshot");
  });

  it("renders Feishu CLI status details separately from channel snapshots", async () => {
    const container = document.createElement("div");
    render(
      renderChannels(
        createProps(
          {
            ts: Date.now(),
            channelOrder: ["slack"],
            channelLabels: { slack: "Slack" },
            channels: { slack: { configured: true } },
            channelAccounts: {},
            channelDefaultAccountId: {},
          },
          {
            feishuCliSupported: true,
            feishuCliStatus: {
              identity: "user",
              enabled: true,
              command: "lark-cli",
              timeoutMs: 8000,
              installed: true,
              version: "1.0.7",
              authOk: true,
              status: "ready",
              message: "ready",
              raw: { ok: true },
            },
          },
        ),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("ready");
    expect(container.textContent).toContain("1.0.7");
    expect(container.textContent).toContain("lark-cli");
    expect(container.textContent).toContain("plugins.entries.feishu-cli.config");
  });

  it("renders Feishu CLI recovery steps when auth is missing", async () => {
    const container = document.createElement("div");
    render(
      renderChannels(
        createProps(
          {
            ts: Date.now(),
            channelOrder: ["slack"],
            channelLabels: { slack: "Slack" },
            channels: { slack: { configured: true } },
            channelAccounts: {},
            channelDefaultAccountId: {},
          },
          {
            feishuCliSupported: true,
            feishuCliStatus: {
              identity: "user",
              enabled: true,
              command: "lark-cli",
              timeoutMs: 8000,
              installed: true,
              version: "1.0.7",
              authOk: false,
              status: "not_configured",
              message: "Run crawclaw feishu-cli auth login first.",
            },
          },
        ),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("crawclaw feishu-cli auth login");
    expect(container.textContent).toContain("crawclaw feishu-cli status --verify");
  });

  it("renders a guided setup banner in onboarding mode", async () => {
    const container = document.createElement("div");
    render(
      renderChannels(
        createProps(
          {
            ts: Date.now(),
            channelOrder: ["discord"],
            channelLabels: { discord: "Discord" },
            channels: { discord: { configured: false } },
            channelAccounts: {},
            channelDefaultAccountId: {},
          },
          {
            onboarding: true,
            connected: true,
          },
        ),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Guided setup");
    expect(container.textContent).toContain("Step 3 of 5");
    expect(container.textContent).toContain("Connect one channel");
  });

  it("renders operations strip for gateway probe, login flow, and config state", async () => {
    const container = document.createElement("div");
    render(
      renderChannels(
        createProps(
          {
            ts: Date.now(),
            channelOrder: ["whatsapp"],
            channelLabels: { whatsapp: "WhatsApp" },
            channels: { whatsapp: { configured: true } },
            channelAccounts: {},
            channelDefaultAccountId: {},
          },
          {
            lastSuccessAt: Date.now(),
            whatsappBusy: true,
            whatsappMessage: "Waiting for QR scan",
            feishuCliSupported: false,
            configFormDirty: true,
          },
        ),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Gateway probe");
    expect(container.textContent).toContain("WhatsApp login");
    expect(container.textContent).toContain("Waiting for QR scan");
    expect(container.textContent).toContain("Config state");
    expect(container.textContent).toContain("Apply required");
    expect(container.textContent).toContain("Control plane channels");
    expect(container.textContent).toContain("Channel operations");
  });
});

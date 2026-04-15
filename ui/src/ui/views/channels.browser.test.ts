import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderChannels } from "./channels.ts";
import type { ChannelsProps } from "./channels.types.ts";

function createChannelsProps(
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
    lastSuccessAt: Date.now(),
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
    onNavigate: () => undefined,
    onResumeOnboarding: () => undefined,
    onRestartOnboarding: () => undefined,
    onRefresh: () => undefined,
    onWhatsAppStart: () => undefined,
    onWhatsAppWait: () => undefined,
    onWhatsAppLogout: () => undefined,
    onConfigPatch: () => undefined,
    onConfigSave: () => undefined,
    onConfigReload: () => undefined,
    onNostrProfileEdit: () => undefined,
    onNostrProfileCancel: () => undefined,
    onNostrProfileFieldChange: () => undefined,
    onNostrProfileSave: () => undefined,
    onNostrProfileImport: () => undefined,
    onNostrProfileToggleAdvanced: () => undefined,
    ...overrides,
  };
}

describe("channels connect center (browser)", () => {
  it("renders the connect-center shell with separate gateway and user identity cards", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderChannels(
        createChannelsProps({
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

    const text = container.textContent ?? "";
    expect(text).toContain("Connect Center");
    expect(text).toContain("Gateway connection");
    expect(text).toContain("Feishu user identity");
    expect(text).toContain("crawclaw feishu-cli status --verify");
    container.remove();
  });

  it("shows the Feishu user auth recovery path when auth is missing", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderChannels(
        createChannelsProps(
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
              timeoutMs: 8_000,
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

    const text = container.textContent ?? "";
    expect(text).toContain("crawclaw feishu-cli auth login");
    expect(text).toContain("crawclaw feishu-cli status --verify");
    container.remove();
  });

  it("shows the onboarding step banner when guided setup is active", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderChannels(
        createChannelsProps(
          {
            ts: Date.now(),
            channelOrder: ["slack"],
            channelLabels: { slack: "Slack" },
            channels: { slack: { configured: false } },
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

    const text = container.textContent ?? "";
    expect(text).toContain("Guided setup");
    expect(text).toContain("Step 3 of 5");
    expect(text).toContain("Connect one channel");
    container.remove();
  });

  it("shows resume controls when guided setup is paused", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderChannels(
        createChannelsProps(
          {
            ts: Date.now(),
            channelOrder: ["slack"],
            channelLabels: { slack: "Slack" },
            channels: { slack: { configured: false } },
            channelAccounts: {},
            channelDefaultAccountId: {},
          },
          {
            onboarding: false,
            onboardingProgress: {
              mode: "paused",
              completedAt: { gateway: 1 },
            },
          },
        ),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Guided setup paused");
    expect(text).toContain("Resume guided setup");
    container.remove();
  });
});

import { describe, expect, it } from "vitest";
import "./app-root.ts";

describe("channels settings editor", () => {
  function createEditor(): HTMLElement & {
    openTestChannelEditor(channelId: string): void;
    setTestChannelEditorTab(tab: "overview" | "accounts" | "settings" | "advanced"): void;
    tab: string;
    locale: string;
    channelsWorkspaceMode: string;
    channelsEditorOpen: boolean;
    channelsSelectedChannelId: string;
    renderRoot: ShadowRoot;
    channelConfigState: {
      configSchema: unknown;
      configForm: Record<string, unknown> | null;
      configUiHints: Record<string, unknown>;
      groupedEditorState?: {
        overview: Array<{
          key: string;
          title: string;
          description: string;
          fieldPaths: string[];
        }>;
        settings: Array<{
          key: string;
          title: string;
          description: string;
          fieldPaths: string[];
        }>;
        advanced: Array<{
          key: string;
          title: string;
          description: string;
          fieldPaths: string[];
        }>;
      };
    };
    channelsState: {
      channelsSnapshot: unknown;
    };
    updateComplete?: Promise<unknown>;
  } {
    const el = document.createElement("crawclaw-app") as HTMLElement & {
      openTestChannelEditor(channelId: string): void;
      setTestChannelEditorTab(tab: "overview" | "accounts" | "settings" | "advanced"): void;
      tab: string;
      locale: string;
      channelsWorkspaceMode: string;
      channelsEditorOpen: boolean;
      channelsSelectedChannelId: string;
      renderRoot: ShadowRoot;
      channelConfigState: {
        configSchema: unknown;
        configForm: Record<string, unknown> | null;
        configUiHints: Record<string, unknown>;
        groupedEditorState?: {
          overview: Array<{
            key: string;
            title: string;
            description: string;
            fieldPaths: string[];
          }>;
          settings: Array<{
            key: string;
            title: string;
            description: string;
            fieldPaths: string[];
          }>;
          advanced: Array<{
            key: string;
            title: string;
            description: string;
            fieldPaths: string[];
          }>;
        };
      };
      channelsState: {
        channelsSnapshot: unknown;
      };
      updateComplete?: Promise<unknown>;
    };
    el.tab = "channels";
    el.locale = "en";
    el.channelsState.channelsSnapshot = {
      ts: 0,
      channelOrder: ["demo-channel"],
      channelLabels: { "demo-channel": "Demo Channel" },
      channelDetailLabels: { "demo-channel": "Demo Channel detail" },
      channels: { "demo-channel": {} },
      channelControls: {
        "demo-channel": {
          loginMode: "none",
          actions: [],
          canReconnect: false,
          canVerify: false,
          canLogout: false,
          canEdit: true,
          canSetup: true,
          multiAccount: false,
        },
      },
      channelAccounts: { "demo-channel": [] },
      channelDefaultAccountId: {},
    };
    document.body.append(el);
    return el;
  }

  it("renders overview/accounts/settings/advanced tabs", async () => {
    const el = createEditor();
    try {
      await customElements.whenDefined("crawclaw-app");
      el.openTestChannelEditor("demo-channel");
      await el.updateComplete;

      const tabs = el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button");
      expect([...tabs].map((tab) => tab.textContent?.trim())).toEqual([
        "Overview",
        "Accounts",
        "Settings",
        "Advanced",
      ]);
      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-status")).toHaveLength(1);
    } finally {
      el.remove();
    }
  });

  it("renders a component-library tab shell for the channel editor", async () => {
    const el = createEditor();
    try {
      await customElements.whenDefined("crawclaw-app");
      el.openTestChannelEditor("demo-channel");
      await el.updateComplete;

      await customElements.whenDefined("wa-tab-group");
      const tabGroup = el.renderRoot.querySelector("wa-tab-group");
      expect(customElements.get("wa-tab-group")).toBeTypeOf("function");
      expect(tabGroup).toBeInstanceOf(customElements.get("wa-tab-group")!);
      expect(tabGroup?.matches(":defined")).toBe(true);
      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button")).toHaveLength(0);
    } finally {
      el.remove();
    }
  });

  it("switches between accounts and settings editor surfaces", async () => {
    const el = createEditor();
    try {
      await customElements.whenDefined("crawclaw-app");
      el.openTestChannelEditor("demo-channel");
      await el.updateComplete;

      const tabs = el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button");
      (tabs[1] as HTMLButtonElement).click();
      await el.updateComplete;

      const accountsTab = el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button")[1];
      expect(accountsTab.getAttribute("aria-selected")).toBe("true");
      expect(accountsTab.classList.contains("is-active")).toBe(true);
      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-accounts")).toHaveLength(1);
      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-settings")).toHaveLength(0);

      (tabs[2] as HTMLButtonElement).click();
      await el.updateComplete;

      const settingsTab = el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button")[2];
      expect(settingsTab.getAttribute("aria-selected")).toBe("true");
      expect(settingsTab.classList.contains("is-active")).toBe(true);
      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-settings")).toHaveLength(1);
      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-accounts")).toHaveLength(0);
    } finally {
      el.remove();
    }
  });

  it("shows plain-language group intros and hides raw account fields in settings", async () => {
    const el = createEditor();
    try {
      el.channelsState.channelsSnapshot = {
        ts: 0,
        channelOrder: ["demo-channel"],
        channelLabels: { "demo-channel": "Demo Channel" },
        channelDetailLabels: { "demo-channel": "Demo Channel detail" },
        channels: { "demo-channel": {} },
        channelControls: {
          "demo-channel": {
            loginMode: "none",
            actions: [],
            canReconnect: false,
            canVerify: false,
            canLogout: false,
            canEdit: true,
            canSetup: true,
            multiAccount: true,
          },
        },
        channelAccounts: { "demo-channel": [] },
        channelDefaultAccountId: {},
      };
      el.channelConfigState.configSchema = {
        type: "object",
        properties: {
          name: {
            type: "string",
            title: "Display name",
            description: "How teammates see this channel.",
          },
          sendMode: {
            type: "string",
            title: "Default sending mode",
            description: "Choose the default sending path.",
          },
          accounts: {
            type: "object",
            title: "accounts",
            description: "Raw account collection.",
          },
          defaultAccount: {
            type: "string",
            title: "defaultAccount",
            description: "Raw default account field.",
          },
        },
      };
      el.channelConfigState.configForm = {
        name: "Demo Channel",
        sendMode: "default",
        accounts: { alpha: {} },
        defaultAccount: "alpha",
      };
      el.channelConfigState.configUiHints = {};
      el.channelConfigState.groupedEditorState = {
        overview: [],
        settings: [
          {
            key: "basic-information",
            title: "Basic information",
            description: "Start with the details that help people recognize this channel.",
            fieldPaths: ["name"],
          },
          {
            key: "sending-defaults",
            title: "Sending defaults",
            description: "Control which account sends by default and how this channel behaves.",
            fieldPaths: ["sendMode", "accounts", "defaultAccount"],
          },
        ],
        advanced: [],
      };

      await customElements.whenDefined("crawclaw-app");
      el.openTestChannelEditor("demo-channel");
      await el.updateComplete;

      const tabs = el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button");
      (tabs[2] as HTMLButtonElement).click();
      await el.updateComplete;

      const settings = el.renderRoot.querySelector(".cp-channel-editor-settings");
      expect(settings?.textContent ?? "").toContain("Basic information");
      expect(settings?.textContent ?? "").toContain(
        "Control which account sends by default and how this channel behaves.",
      );
      const settingsForm = settings?.querySelector(".cp-channel-config-editor");
      expect(settingsForm?.textContent ?? "").not.toContain("accounts");
      expect(settingsForm?.textContent ?? "").not.toContain("defaultAccount");
      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-group")).toHaveLength(2);
    } finally {
      el.remove();
    }
  });

  it("falls back to the full settings form when grouped coverage drifts", async () => {
    const el = createEditor();
    try {
      el.channelsState.channelsSnapshot = {
        ts: 0,
        channelOrder: ["demo-channel"],
        channelLabels: { "demo-channel": "Demo Channel" },
        channelDetailLabels: { "demo-channel": "Demo Channel detail" },
        channels: { "demo-channel": {} },
        channelControls: {
          "demo-channel": {
            loginMode: "none",
            actions: [],
            canReconnect: false,
            canVerify: false,
            canLogout: false,
            canEdit: true,
            canSetup: true,
            multiAccount: true,
          },
        },
        channelAccounts: { "demo-channel": [] },
        channelDefaultAccountId: {},
      };
      el.channelConfigState.configSchema = {
        type: "object",
        properties: {
          name: {
            type: "string",
            title: "Display name",
            description: "How teammates see this channel.",
          },
          sendMode: {
            type: "string",
            title: "Default sending mode",
            description: "Choose the default sending path.",
          },
          accounts: {
            type: "object",
            title: "accounts",
            description: "Raw account collection.",
          },
          defaultAccount: {
            type: "string",
            title: "defaultAccount",
            description: "Raw default account field.",
          },
        },
      };
      el.channelConfigState.configForm = {
        name: "Demo Channel",
        sendMode: "default",
        accounts: { alpha: {} },
        defaultAccount: "alpha",
      };
      el.channelConfigState.configUiHints = {};
      el.channelConfigState.groupedEditorState = {
        overview: [],
        settings: [
          {
            key: "basic-information",
            title: "Basic information",
            description: "Start with the details that help people recognize this channel.",
            fieldPaths: ["name"],
          },
        ],
        advanced: [],
      };

      await customElements.whenDefined("crawclaw-app");
      el.openTestChannelEditor("demo-channel");
      await el.updateComplete;

      const tabs = el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button");
      (tabs[2] as HTMLButtonElement).click();
      await el.updateComplete;

      const settings = el.renderRoot.querySelector(".cp-channel-editor-settings");
      expect(settings?.textContent ?? "").not.toContain("Basic information");
      expect(settings?.textContent ?? "").toContain("Default sending mode");
      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-group")).toHaveLength(0);
      expect(el.renderRoot.querySelectorAll(".cp-channel-config-editor")).toHaveLength(1);
    } finally {
      el.remove();
    }
  });
});

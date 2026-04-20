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
});

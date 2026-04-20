import { describe, expect, it } from "vitest";
import "./app-root.ts";

describe("channels settings editor", () => {
  it("renders overview/accounts/settings/advanced tabs", async () => {
    const el = document.createElement("crawclaw-app") as HTMLElement & {
      tab: string;
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
    el.channelsWorkspaceMode = "settings";
    el.channelsEditorOpen = true;
    el.channelsSelectedChannelId = "demo-channel";
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
    try {
      await customElements.whenDefined("crawclaw-app");
      await el.updateComplete;

      const tabs = el.renderRoot.querySelectorAll(".cp-channel-editor-tabs button");
      expect([...tabs].map((tab) => tab.textContent?.trim())).toEqual([
        "Overview",
        "Accounts",
        "Settings",
        "Advanced",
      ]);
    } finally {
      el.remove();
    }
  });

  it("shows one shared status strip above tab content", async () => {
    const el = document.createElement("crawclaw-app") as HTMLElement & {
      tab: string;
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
    el.channelsWorkspaceMode = "settings";
    el.channelsEditorOpen = true;
    el.channelsSelectedChannelId = "demo-channel";
    el.channelsState.channelsSnapshot = {
      ts: 0,
      channelOrder: ["demo-channel"],
      channelLabels: { "demo-channel": "Demo Channel" },
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
    try {
      await customElements.whenDefined("crawclaw-app");
      await el.updateComplete;

      expect(el.renderRoot.querySelectorAll(".cp-channel-editor-status")).toHaveLength(1);
    } finally {
      el.remove();
    }
  });
});

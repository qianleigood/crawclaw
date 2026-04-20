import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyChannelConfig,
  applyChannelConfigSchema,
  applyChannelConfigSnapshot,
  buildChannelEditorGroups,
  channelReloadRequiresConfirm,
  setChannelEditorTab,
  resetChannelConfigForm,
  saveChannelConfig,
  type ChannelConfigState,
} from "./channel-config.ts";

function createState(): ChannelConfigState {
  return {
    client: null,
    connected: false,
    applySessionKey: "main",
    selectedChannelId: null,
    configLoading: false,
    configSaving: false,
    configApplying: false,
    configSnapshot: null,
    configSchema: null,
    configSchemaVersion: null,
    configSchemaLoading: false,
    configUiHints: {},
    configForm: null,
    configFormOriginal: null,
    configFormDirty: false,
    lastError: null,
    lastSubmitKind: null,
    lastSubmitMethod: null,
    lastSubmitAt: null,
  };
}

describe("saveChannelConfig", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T07:15:00.000Z"));
  });

  it("tracks a successful save submission", async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === "channels.config.get") {
        return { hash: "hash-2", config: { token: "abc" } };
      }
      return {};
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelConfigState["client"];
    state.selectedChannelId = "feishu";
    state.configSnapshot = { hash: "hash-1", config: { token: "old" } };
    state.configFormOriginal = { token: "old" };
    state.configForm = { token: "abc" };
    state.configFormDirty = true;

    await saveChannelConfig(state);

    expect(request).toHaveBeenCalledWith(
      "channels.config.patch",
      expect.objectContaining({ channel: "feishu", baseHash: "hash-1" }),
    );
    expect(state.configFormDirty).toBe(false);
    expect(state.lastSubmitKind).toBe("save");
    expect(state.lastSubmitMethod).toBe("channels.config.patch");
    expect(state.lastSubmitAt).toBe(Date.now());
  });

  it("tracks when save falls back to apply for array payloads", async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === "channels.config.get") {
        return { hash: "hash-2", config: { rooms: ["a"] } };
      }
      return {};
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelConfigState["client"];
    state.selectedChannelId = "feishu";
    state.configSnapshot = { hash: "hash-1", config: { rooms: ["a"] } };
    state.configFormOriginal = { rooms: ["a"] };
    state.configForm = { rooms: ["a", "b"] };
    state.configFormDirty = true;

    await saveChannelConfig(state);

    expect(request).toHaveBeenCalledWith(
      "channels.config.apply",
      expect.objectContaining({ channel: "feishu", baseHash: "hash-1" }),
    );
    expect(state.lastSubmitKind).toBe("save");
    expect(state.lastSubmitMethod).toBe("channels.config.apply");
  });
});

describe("applyChannelConfig", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T07:25:00.000Z"));
  });

  it("tracks a successful apply submission", async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === "channels.config.get") {
        return { hash: "hash-2", config: { token: "abc" } };
      }
      return {};
    });
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ChannelConfigState["client"];
    state.selectedChannelId = "feishu";
    state.configSnapshot = { hash: "hash-1", config: { token: "old" } };
    state.configFormOriginal = { token: "old" };
    state.configForm = { token: "abc" };
    state.configFormDirty = true;

    await applyChannelConfig(state);

    expect(request).toHaveBeenCalledWith(
      "channels.config.apply",
      expect.objectContaining({ channel: "feishu", baseHash: "hash-1" }),
    );
    expect(state.configFormDirty).toBe(false);
    expect(state.lastSubmitKind).toBe("apply");
    expect(state.lastSubmitMethod).toBe("channels.config.apply");
    expect(state.lastSubmitAt).toBe(Date.now());
  });
});

describe("resetChannelConfigForm", () => {
  it("restores the original form and clears dirty state", () => {
    const state = createState();
    state.configFormOriginal = { token: "original", rooms: ["a"] };
    state.configForm = { token: "edited", rooms: ["a", "b"] };
    state.configFormDirty = true;
    state.lastError = "boom";

    resetChannelConfigForm(state);

    expect(state.configForm).toEqual({ token: "original", rooms: ["a"] });
    expect(state.configFormDirty).toBe(false);
    expect(state.lastError).toBeNull();
  });
});

describe("channel editor state", () => {
  it("keeps dirty state while switching editor tabs", () => {
    const state = createState();
    state.configFormDirty = true;

    setChannelEditorTab(state, "accounts");

    expect(state.activeEditorTab).toBe("accounts");
    expect(state.configFormDirty).toBe(true);
  });

  it("marks reload as confirm-required when the form is dirty", () => {
    const state = createState();
    state.configFormDirty = true;

    expect(channelReloadRequiresConfirm(state)).toBe(true);
  });

  it("builds grouped presentation buckets from schema and ui hints", () => {
    const state = createState();
    state.configSchema = {
      type: "object",
      properties: {
        title: { type: "string" },
        rules: { type: "object" },
        token: { type: "string" },
        experimental: { type: "boolean" },
      },
    };
    state.configUiHints = {
      title: { group: "sending-defaults", label: "Title", help: "Primary display name" },
      rules: { group: "sending-defaults", label: "Sending defaults" },
      token: { group: "security", label: "Token" },
      experimental: { advanced: true, label: "Experimental" },
    };

    const groups = buildChannelEditorGroups(state, "feishu");

    expect(groups.settings.map((group) => group.key)).toContain("sending-defaults");
    expect(groups.advanced.map((group) => group.key)).toContain("experimental");
    expect(groups.settings.find((group) => group.key === "sending-defaults")).toMatchObject({
      title: "Sending defaults",
      description: "",
      fieldPaths: ["title", "rules"],
    });
  });

  it("rebuilds grouped metadata when schema and snapshot load", () => {
    const state = createState();
    state.reloadConfirmOpen = true;

    applyChannelConfigSchema(state, {
      channel: "feishu",
      path: "channels/feishu",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
      },
      uiHints: {
        title: { group: "overview", label: "Title" },
      },
      version: "v1",
      generatedAt: "2026-04-20T07:00:00.000Z",
    });
    applyChannelConfigSnapshot(state, {
      channel: "feishu",
      path: "channels/feishu",
      hash: "hash-1",
      config: { title: "Example" },
    });

    expect(state.reloadConfirmOpen).toBe(false);
    expect(state.groupedEditorState.overview.map((group) => group.key)).toContain("overview");
  });
});

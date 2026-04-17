import { describe, expect, it, vi } from "vitest";
import {
  defineChannelPluginEntry,
  defineSetupPluginEntry,
} from "../plugin-sdk/channel-plugin-builders.js";
import { definePluginEntry } from "../plugin-sdk/plugin-entry.js";
import {
  PLUGIN_ENTRY_TYPE_FIELD,
  resolveChannelPluginModuleEntry,
  resolvePluginModuleExport,
  resolveSetupChannelRegistration,
} from "./entry-contract.js";

describe("plugin entry contract", () => {
  it("marks definePluginEntry results as plugin entries", () => {
    const entry = definePluginEntry({
      id: "demo-plugin",
      name: "Demo Plugin",
      description: "demo",
      register() {},
    });

    expect(entry[PLUGIN_ENTRY_TYPE_FIELD]).toBe("plugin");
    expect(resolvePluginModuleExport(entry)).toMatchObject({
      definition: expect.objectContaining({
        id: "demo-plugin",
        name: "Demo Plugin",
      }),
      register: expect.any(Function),
    });
  });

  it("marks defineChannelPluginEntry results as channel entries", () => {
    const plugin = {
      id: "demo-channel",
      meta: {},
      setup: vi.fn(),
    };
    const setRuntime = vi.fn();
    const entry = defineChannelPluginEntry({
      id: "demo-channel",
      name: "Demo Channel",
      description: "demo",
      plugin,
      setRuntime,
    });

    expect(entry[PLUGIN_ENTRY_TYPE_FIELD]).toBe("channel");
    expect(resolveChannelPluginModuleEntry(entry)).toEqual({
      channelPlugin: plugin,
      setChannelRuntime: setRuntime,
    });
  });

  it("marks defineSetupPluginEntry results as setup entries", () => {
    const plugin = {
      id: "demo-channel",
      meta: {},
      setup: vi.fn(),
    };
    const entry = defineSetupPluginEntry(plugin);

    expect(entry[PLUGIN_ENTRY_TYPE_FIELD]).toBe("setup");
    expect(resolveSetupChannelRegistration(entry)).toEqual({
      plugin,
    });
  });

  it("keeps legacy unmarked channel/setup exports compatible", () => {
    const plugin = {
      id: "legacy-channel",
      meta: {},
      setup: vi.fn(),
    };
    const setChannelRuntime = vi.fn();

    expect(
      resolveChannelPluginModuleEntry({
        default: {
          channelPlugin: plugin,
          setChannelRuntime,
        },
      }),
    ).toEqual({
      channelPlugin: plugin,
      setChannelRuntime,
    });

    expect(
      resolveSetupChannelRegistration({
        default: {
          plugin,
        },
      }),
    ).toEqual({
      plugin,
    });
  });
});

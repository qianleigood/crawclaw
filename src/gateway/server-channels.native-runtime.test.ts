import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import { createSubsystemLogger, runtimeForLogger } from "../logging/subsystem.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

vi.mock("../channels/plugins/bundled-runtime-policy.js", () => ({
  shouldAllowBundledTsChannelRuntime: () => false,
}));

vi.mock("../plugins/bundled-plugin-metadata.js", () => ({
  listBundledPluginMetadata: () => [
    {
      manifest: {
        channels: ["telegram"],
      },
    },
  ],
}));

import { createChannelManager } from "./server-channels.js";

const gatewayDir = path.dirname(fileURLToPath(import.meta.url));

function createPlugin(id: string, startAccount = vi.fn(async () => {})): ChannelPlugin {
  return {
    id,
    meta: {
      id,
      label: id,
      selectionLabel: id,
      docsPath: `/channels/${id}`,
      blurb: "test",
    },
    capabilities: { chatTypes: ["direct"] },
    config: {
      listAccountIds: () => [DEFAULT_ACCOUNT_ID],
      resolveAccount: () => ({ enabled: true }),
      isConfigured: () => true,
    },
    gateway: {
      startAccount,
    },
  };
}

function installPlugins(...plugins: ChannelPlugin[]) {
  const registry = createEmptyPluginRegistry();
  for (const plugin of plugins) {
    registry.channels.push({
      pluginId: plugin.id,
      source: "test",
      plugin,
    });
  }
  setActivePluginRegistry(registry);
}

function createManager() {
  const log = createSubsystemLogger("gateway/server-channels-native-test");
  return createChannelManager({
    loadConfig: () => ({
      channels: {
        telegram: { enabled: true },
        externalchat: { enabled: true },
      },
    }),
    channelLogs: {
      telegram: log.child("telegram"),
      externalchat: log.child("externalchat"),
    } as never,
    channelRuntimeEnvs: {
      telegram: runtimeForLogger(log.child("telegram")),
      externalchat: runtimeForLogger(log.child("externalchat")),
    } as never,
  });
}

describe("server channel manager native runtime policy", () => {
  beforeEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it("does not start bundled TS channel plugins when native channel runtime is authoritative", async () => {
    const bundledStart = vi.fn(async () => {});
    const externalStart = vi.fn(async () => {});
    installPlugins(
      createPlugin("telegram", bundledStart),
      createPlugin("externalchat", externalStart),
    );
    const manager = createManager();

    await manager.startChannels();

    expect(bundledStart).not.toHaveBeenCalled();
    expect(externalStart).toHaveBeenCalledTimes(1);
  });

  it("does not import the TS channel plugin registry directly", () => {
    const source = fs.readFileSync(path.join(gatewayDir, "server-channels.ts"), "utf8");

    expect(source).not.toMatch(/channels\/plugins\/index\.js/);
    expect(source).not.toMatch(/listChannelPlugins/);
  });
});

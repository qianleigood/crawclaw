import type { ChannelPlugin } from "../channels/plugins/types.js";
import { resolveChannelPluginModuleEntry } from "../plugins/entry-contract.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import type { PluginRuntime } from "../plugins/runtime/index.js";
import { loadBundledPluginPublicSurfaceSync } from "../test-utils/bundled-plugin-public-surface.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import { getChannelSetupWizardAdapter } from "./channel-setup/registry.js";
import type { ChannelSetupWizardAdapter } from "./channel-setup/types.js";
import type { ChannelChoice } from "./onboard-types.js";

const BUNDLED_CHANNEL_PLUGIN_IDS = [
  "bluebubbles",
  "ddingtalk",
  "discord",
  "esp32",
  "feishu",
  "googlechat",
  "imessage",
  "irc",
  "line",
  "matrix",
  "mattermost",
  "msteams",
  "nextcloud-talk",
  "nostr",
  "qqbot",
  "signal",
  "slack",
  "synology-chat",
  "telegram",
  "tlon",
  "twitch",
  "weixin",
  "whatsapp",
  "zalo",
  "zalouser",
] as const;

type BundledChannelEntryForTests = {
  plugin: ChannelPlugin;
  setRuntime?: (runtime: PluginRuntime) => void;
};

let bundledChannelEntriesForTests: readonly BundledChannelEntryForTests[] | null = null;

function loadBundledChannelEntryForTests(pluginId: string): BundledChannelEntryForTests {
  const surface = loadBundledPluginPublicSurfaceSync<Record<string, unknown>>({
    pluginId,
    artifactBasename: "index.js",
  });
  const entry = resolveChannelPluginModuleEntry(surface);
  if (!entry.channelPlugin) {
    throw new Error(`missing bundled test channel plugin: ${pluginId}`);
  }
  return {
    plugin: entry.channelPlugin,
    ...(entry.setChannelRuntime ? { setRuntime: entry.setChannelRuntime } : {}),
  };
}

function getBundledChannelEntriesForTests(): readonly BundledChannelEntryForTests[] {
  bundledChannelEntriesForTests ??= BUNDLED_CHANNEL_PLUGIN_IDS.map((pluginId) =>
    loadBundledChannelEntryForTests(pluginId),
  );
  return bundledChannelEntriesForTests;
}

function requireBundledChannelEntryForTests(pluginId: string): BundledChannelEntryForTests {
  const entry = getBundledChannelEntriesForTests().find((item) => item.plugin.id === pluginId);
  if (!entry) {
    throw new Error(`missing bundled test channel plugin: ${pluginId}`);
  }
  return entry;
}

type ChannelSetupWizardAdapterPatch = Partial<
  Pick<
    ChannelSetupWizardAdapter,
    | "afterConfigWritten"
    | "configure"
    | "configureInteractive"
    | "configureWhenConfigured"
    | "getStatus"
  >
>;

type PatchedSetupAdapterFields = {
  afterConfigWritten?: ChannelSetupWizardAdapter["afterConfigWritten"];
  configure?: ChannelSetupWizardAdapter["configure"];
  configureInteractive?: ChannelSetupWizardAdapter["configureInteractive"];
  configureWhenConfigured?: ChannelSetupWizardAdapter["configureWhenConfigured"];
  getStatus?: ChannelSetupWizardAdapter["getStatus"];
};

export function setDefaultChannelPluginRegistryForTests(): void {
  const matrixRuntime = requireBundledChannelEntryForTests("matrix").setRuntime;
  if (!matrixRuntime) {
    throw new Error("missing matrix runtime setter");
  }
  matrixRuntime({
    state: {
      resolveStateDir: (_env, homeDir) => (homeDir ?? (() => "/tmp"))(),
    },
  } as Parameters<NonNullable<BundledChannelEntryForTests["setRuntime"]>>[0]);
  const channels = getBundledChannelEntriesForTests().map(({ plugin }) => ({
    pluginId: plugin.id,
    plugin,
    source: "test" as const,
  })) as unknown as Parameters<typeof createTestRegistry>[0];
  setActivePluginRegistry(createTestRegistry(channels));
}

export function patchChannelSetupWizardAdapter(
  channel: ChannelChoice,
  patch: ChannelSetupWizardAdapterPatch,
): () => void {
  const adapter = getChannelSetupWizardAdapter(channel);
  if (!adapter) {
    throw new Error(`missing setup adapter for ${channel}`);
  }

  const previous: PatchedSetupAdapterFields = {};

  if (Object.prototype.hasOwnProperty.call(patch, "getStatus")) {
    previous.getStatus = adapter.getStatus;
    adapter.getStatus = patch.getStatus ?? adapter.getStatus;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "afterConfigWritten")) {
    previous.afterConfigWritten = adapter.afterConfigWritten;
    adapter.afterConfigWritten = patch.afterConfigWritten;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "configure")) {
    previous.configure = adapter.configure;
    adapter.configure = patch.configure ?? adapter.configure;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "configureInteractive")) {
    previous.configureInteractive = adapter.configureInteractive;
    adapter.configureInteractive = patch.configureInteractive;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "configureWhenConfigured")) {
    previous.configureWhenConfigured = adapter.configureWhenConfigured;
    adapter.configureWhenConfigured = patch.configureWhenConfigured;
  }

  return () => {
    if (Object.prototype.hasOwnProperty.call(patch, "getStatus")) {
      adapter.getStatus = previous.getStatus!;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "afterConfigWritten")) {
      adapter.afterConfigWritten = previous.afterConfigWritten;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "configure")) {
      adapter.configure = previous.configure!;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "configureInteractive")) {
      adapter.configureInteractive = previous.configureInteractive;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "configureWhenConfigured")) {
      adapter.configureWhenConfigured = previous.configureWhenConfigured;
    }
  };
}

export const patchChannelOnboardingAdapter = patchChannelSetupWizardAdapter;

export type PluginSdkDocCategory =
  | "channel"
  | "core"
  | "legacy"
  | "provider"
  | "runtime"
  | "utilities";

export type PluginSdkDocMetadata = {
  category: PluginSdkDocCategory;
};

export const pluginSdkDocMetadata = {
  core: {
    category: "core",
  },
  "plugin-entry": {
    category: "core",
  },
  "command-auth": {
    category: "utilities",
  },
  "secret-input": {
    category: "utilities",
  },
  "webhook-ingress": {
    category: "utilities",
  },
  "provider-onboard": {
    category: "provider",
  },
  "runtime-store": {
    category: "runtime",
  },
  "allow-from": {
    category: "utilities",
  },
  "reply-payload": {
    category: "utilities",
  },
  setup: {
    category: "utilities",
  },
  testing: {
    category: "utilities",
  },
} as const satisfies Record<string, PluginSdkDocMetadata>;

export type PluginSdkDocEntrypoint = keyof typeof pluginSdkDocMetadata;

export const pluginSdkDocCategories = [
  "core",
  "channel",
  "provider",
  "runtime",
  "utilities",
  "legacy",
] as const satisfies readonly PluginSdkDocCategory[];

export const pluginSdkDocEntrypoints = Object.keys(
  pluginSdkDocMetadata,
) as PluginSdkDocEntrypoint[];

export function resolvePluginSdkDocImportSpecifier(entrypoint: PluginSdkDocEntrypoint): string {
  return `crawclaw/plugin-sdk/${entrypoint}`;
}

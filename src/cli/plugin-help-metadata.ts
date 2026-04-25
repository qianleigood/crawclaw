import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type StartupMetadataPluginDescriptor = {
  pluginId: string;
  name: string;
  description: string;
  descriptionZhCN?: string;
  hasSubcommands: boolean;
};

let precomputedPluginHelpDescriptors: StartupMetadataPluginDescriptor[] | null | undefined;

function loadPrecomputedPluginHelpDescriptors(): StartupMetadataPluginDescriptor[] | null {
  if (precomputedPluginHelpDescriptors !== undefined) {
    return precomputedPluginHelpDescriptors;
  }
  try {
    const metadataPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "cli-startup-metadata.json",
    );
    const raw = fs.readFileSync(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as { pluginCliDescriptors?: unknown };
    if (Array.isArray(parsed.pluginCliDescriptors)) {
      precomputedPluginHelpDescriptors = parsed.pluginCliDescriptors.filter(
        (value): value is StartupMetadataPluginDescriptor =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as StartupMetadataPluginDescriptor).pluginId === "string" &&
          typeof (value as StartupMetadataPluginDescriptor).name === "string" &&
          typeof (value as StartupMetadataPluginDescriptor).description === "string" &&
          typeof (value as StartupMetadataPluginDescriptor).hasSubcommands === "boolean",
      );
      return precomputedPluginHelpDescriptors;
    }
  } catch {
    // Fall back to dynamic CLI metadata collection.
  }
  precomputedPluginHelpDescriptors = null;
  return null;
}

export function resolvePrecomputedPluginHelpDescriptors(
  pluginIds: string[],
  locale: "en" | "zh-CN",
): Array<{
  name: string;
  description: string;
  hasSubcommands: boolean;
}> {
  const precomputed = loadPrecomputedPluginHelpDescriptors();
  if (!precomputed || pluginIds.length === 0) {
    return [];
  }
  const requested = new Set(pluginIds);
  const seen = new Set<string>();
  const resolved: Array<{
    name: string;
    description: string;
    hasSubcommands: boolean;
  }> = [];
  for (const descriptor of precomputed) {
    if (!requested.has(descriptor.pluginId) || seen.has(descriptor.name)) {
      continue;
    }
    seen.add(descriptor.name);
    resolved.push({
      name: descriptor.name,
      description:
        locale === "zh-CN" && descriptor.descriptionZhCN
          ? descriptor.descriptionZhCN
          : descriptor.description,
      hasSubcommands: descriptor.hasSubcommands,
    });
  }
  return resolved;
}

export const __testing = {
  resetPrecomputedPluginHelpDescriptorsForTests(): void {
    precomputedPluginHelpDescriptors = undefined;
  },
};

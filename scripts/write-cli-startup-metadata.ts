import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const outputPath = path.join(distDir, "cli-startup-metadata.json");
const extensionsDir = path.join(rootDir, "extensions");
const CORE_CHANNEL_ORDER = [
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
] as const;

type ExtensionChannelEntry = {
  id: string;
  order: number;
  label: string;
};

type PluginCliDescriptor = {
  pluginId: string;
  name: string;
  description: string;
  descriptionZhCN?: string;
  hasSubcommands: boolean;
};

type BundledPluginManifest = {
  pluginId: string;
  channel?: {
    id?: unknown;
    order?: unknown;
    label?: unknown;
  };
  cli?: {
    descriptors?: unknown;
  };
} | null;

function readBundledPluginManifest(pluginDir: string): BundledPluginManifest {
  const fallbackPluginId = path.basename(pluginDir);
  const manifestPaths = [
    path.join(pluginDir, "package.json"),
    path.join(pluginDir, "crawclaw.plugin.json"),
  ];
  for (const manifestPath of manifestPaths) {
    try {
      const raw = readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(raw) as {
        name?: unknown;
        id?: unknown;
        crawclaw?: {
          channel?: {
            id?: unknown;
            order?: unknown;
            label?: unknown;
          };
          cli?: {
            descriptors?: unknown;
          };
        };
        cli?: {
          descriptors?: unknown;
        };
      };
      const packageName = typeof parsed.name === "string" ? parsed.name.trim() : "";
      const pluginId =
        (typeof parsed.id === "string" && parsed.id.trim()) ||
        (typeof parsed.crawclaw?.channel?.id === "string" && parsed.crawclaw.channel.id.trim()) ||
        (packageName.startsWith("@crawclaw/") ? packageName.slice("@crawclaw/".length) : "") ||
        fallbackPluginId;
      if (!pluginId) {
        continue;
      }
      return {
        pluginId,
        channel: parsed.crawclaw?.channel,
        cli: parsed.crawclaw?.cli ?? parsed.cli,
      };
    } catch {
      // Try the next supported manifest.
    }
  }
  return null;
}

export function readBundledChannelCatalogIds(
  extensionsDirOverride: string = extensionsDir,
): string[] {
  const entries: ExtensionChannelEntry[] = [];
  for (const dirEntry of readdirSync(extensionsDirOverride, { withFileTypes: true })) {
    if (!dirEntry.isDirectory()) {
      continue;
    }
    const manifest = readBundledPluginManifest(path.join(extensionsDirOverride, dirEntry.name));
    const id = manifest?.channel?.id;
    if (typeof id !== "string" || !id.trim()) {
      continue;
    }
    const orderRaw = manifest.channel?.order;
    const labelRaw = manifest.channel?.label;
    try {
      entries.push({
        id: id.trim(),
        order: typeof orderRaw === "number" ? orderRaw : 999,
        label: typeof labelRaw === "string" ? labelRaw : id.trim(),
      });
    } catch {
      // Ignore malformed entries.
    }
  }
  return entries
    .toSorted((a, b) => (a.order === b.order ? a.label.localeCompare(b.label) : a.order - b.order))
    .map((entry) => entry.id);
}

export function readBundledPluginCliDescriptors(
  extensionsDirOverride: string = extensionsDir,
): PluginCliDescriptor[] {
  const descriptors: PluginCliDescriptor[] = [];
  for (const dirEntry of readdirSync(extensionsDirOverride, { withFileTypes: true })) {
    if (!dirEntry.isDirectory()) {
      continue;
    }
    const manifest = readBundledPluginManifest(path.join(extensionsDirOverride, dirEntry.name));
    const rawDescriptors = manifest?.cli?.descriptors;
    if (!manifest?.pluginId || !Array.isArray(rawDescriptors)) {
      continue;
    }
    for (const descriptor of rawDescriptors) {
      if (
        typeof descriptor !== "object" ||
        descriptor === null ||
        typeof descriptor.name !== "string" ||
        typeof descriptor.description !== "string" ||
        typeof descriptor.hasSubcommands !== "boolean"
      ) {
        continue;
      }
      descriptors.push({
        pluginId: manifest.pluginId,
        name: descriptor.name.trim(),
        description: descriptor.description.trim(),
        descriptionZhCN:
          typeof descriptor.descriptionZhCN === "string"
            ? descriptor.descriptionZhCN.trim()
            : undefined,
        hasSubcommands: descriptor.hasSubcommands,
      });
    }
  }
  return descriptors;
}

export async function writeCliStartupMetadata(options?: {
  distDir?: string;
  outputPath?: string;
  extensionsDir?: string;
}): Promise<void> {
  const resolvedDistDir = options?.distDir ?? distDir;
  const resolvedOutputPath = options?.outputPath ?? outputPath;
  const resolvedExtensionsDir = options?.extensionsDir ?? extensionsDir;
  const catalog = readBundledChannelCatalogIds(resolvedExtensionsDir);
  const pluginCliDescriptors = readBundledPluginCliDescriptors(resolvedExtensionsDir);
  const channelOptions = dedupe([...CORE_CHANNEL_ORDER, ...catalog]);

  mkdirSync(resolvedDistDir, { recursive: true });
  writeFileSync(
    resolvedOutputPath,
    `${JSON.stringify(
      {
        generatedBy: "scripts/write-cli-startup-metadata.ts",
        channelOptions,
        pluginCliDescriptors,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await writeCliStartupMetadata();
}

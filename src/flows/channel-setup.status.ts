import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { listChannelPluginCatalogEntries } from "../channels/plugins/catalog.js";
import { listChannelSetupPlugins } from "../channels/plugins/setup-registry.js";
import type { ChannelSetupPlugin } from "../channels/plugins/setup-wizard-types.js";
import type { ChannelProfile } from "../channels/plugins/types.js";
import {
  formatChannelPrimerLine,
  formatChannelSelectionLine,
  listChatChannels,
} from "../channels/registry.js";
import { formatCliCommand } from "../cli/command-format.js";
import { translateActiveCliText } from "../cli/i18n/text.js";
import { resolveChannelSetupEntries } from "../commands/channel-setup/discovery.js";
import { resolveChannelSetupWizardAdapterForPlugin } from "../commands/channel-setup/registry.js";
import type {
  ChannelSetupWizardAdapter,
  ChannelSetupStatus,
  SetupChannelsOptions,
} from "../commands/channel-setup/types.js";
import type { ChannelChoice } from "../commands/onboard-types.js";
import { isChannelConfigured } from "../config/channel-configured.js";
import type { CrawClawConfig } from "../config/config.js";
import { formatDocsLink } from "../terminal/links.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { FlowContribution } from "./types.js";

export type ChannelStatusSummary = {
  installedPlugins: ChannelSetupPlugin[];
  catalogEntries: ReturnType<typeof listChannelPluginCatalogEntries>;
  installedCatalogEntries: ReturnType<typeof listChannelPluginCatalogEntries>;
  statusByChannel: Map<ChannelChoice, ChannelSetupStatus>;
  statusLines: string[];
};

export type ChannelSetupSelectionContribution = FlowContribution<ChannelChoice> & {
  kind: "channel";
  surface: "setup";
  channel: ChannelChoice;
  source: "catalog" | "core" | "plugin";
};

function translateChannelStatusPart(part: string): string {
  const trimmed = part.trim();
  if (trimmed.length === 0) {
    return part;
  }
  const colonIndex = trimmed.indexOf(": ");
  if (colonIndex >= 0) {
    const left = trimmed.slice(0, colonIndex);
    const right = trimmed.slice(colonIndex + 2);
    return `${translateActiveCliText(left)}: ${translateActiveCliText(right)}`;
  }
  return translateActiveCliText(trimmed);
}

function translateChannelStatusLine(line: string): string {
  return line
    .split(" · ")
    .map((part) => translateChannelStatusPart(part))
    .join(" · ");
}

function buildChannelSetupSelectionContribution(params: {
  channel: ChannelChoice;
  label: string;
  hint?: string;
  source: "catalog" | "core" | "plugin";
}): ChannelSetupSelectionContribution {
  return {
    id: `channel:setup:${params.channel}`,
    kind: "channel",
    surface: "setup",
    channel: params.channel,
    option: {
      value: params.channel,
      label: params.label,
      ...(params.hint ? { hint: params.hint } : {}),
    },
    source: params.source,
  };
}

export async function collectChannelStatus(params: {
  cfg: CrawClawConfig;
  options?: SetupChannelsOptions;
  accountOverrides: Partial<Record<ChannelChoice, string>>;
  installedPlugins?: ChannelSetupPlugin[];
  resolveAdapter?: (channel: ChannelChoice) => ChannelSetupWizardAdapter | undefined;
}): Promise<ChannelStatusSummary> {
  const installedPlugins = params.installedPlugins ?? listChannelSetupPlugins();
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, resolveDefaultAgentId(params.cfg));
  const { installedCatalogEntries, installableCatalogEntries } = resolveChannelSetupEntries({
    cfg: params.cfg,
    installedPlugins,
    workspaceDir,
  });
  const resolveAdapter =
    params.resolveAdapter ??
    ((channel: ChannelChoice) =>
      resolveChannelSetupWizardAdapterForPlugin(
        installedPlugins.find((plugin) => plugin.id === channel),
      ));
  const statusEntries = await Promise.all(
    installedPlugins.flatMap((plugin) => {
      const adapter = resolveAdapter(plugin.id);
      if (!adapter) {
        return [];
      }
      return adapter.getStatus({
        cfg: params.cfg,
        options: params.options,
        accountOverrides: params.accountOverrides,
      });
    }),
  );
  const statusByChannel = new Map(statusEntries.map((entry) => [entry.channel, entry]));
  const fallbackStatuses = listChatChannels()
    .filter((meta) => !statusByChannel.has(meta.id))
    .map((meta) => {
      const configured = isChannelConfigured(params.cfg, meta.id);
      const statusLabel = configured ? "configured (plugin disabled)" : "not configured";
      return {
        channel: meta.id,
        configured,
        statusLines: [`${meta.label}: ${statusLabel}`],
        selectionHint: configured ? "configured · plugin disabled" : "not configured",
        quickstartScore: 0,
      };
    });
  const discoveredPluginStatuses = installedCatalogEntries
    .filter((entry) => !statusByChannel.has(entry.id as ChannelChoice))
    .map((entry) => {
      const configured = isChannelConfigured(params.cfg, entry.id);
      const pluginEnabled =
        params.cfg.plugins?.entries?.[entry.pluginId ?? entry.id]?.enabled !== false;
      const statusLabel = configured
        ? pluginEnabled
          ? "configured"
          : "configured (plugin disabled)"
        : pluginEnabled
          ? "installed"
          : "installed (plugin disabled)";
      return {
        channel: entry.id as ChannelChoice,
        configured,
        statusLines: [`${entry.meta.label}: ${statusLabel}`],
        selectionHint: statusLabel,
        quickstartScore: 0,
      };
    });
  const catalogStatuses = installableCatalogEntries.map((entry) => ({
    channel: entry.id,
    configured: false,
    statusLines: [`${entry.meta.label}: install plugin to enable`],
    selectionHint: "plugin · install",
    quickstartScore: 0,
  }));
  const combinedStatuses = [
    ...statusEntries,
    ...fallbackStatuses,
    ...discoveredPluginStatuses,
    ...catalogStatuses,
  ];
  const localizedStatuses = combinedStatuses.map((entry) => ({
    ...entry,
    statusLines: entry.statusLines.map((line) => translateChannelStatusLine(line)),
    ...(entry.selectionHint
      ? { selectionHint: translateChannelStatusLine(entry.selectionHint) }
      : {}),
  }));
  const mergedStatusByChannel = new Map(localizedStatuses.map((entry) => [entry.channel, entry]));
  const statusLines = localizedStatuses.flatMap((entry) => entry.statusLines);
  return {
    installedPlugins,
    catalogEntries: installableCatalogEntries,
    installedCatalogEntries,
    statusByChannel: mergedStatusByChannel,
    statusLines,
  };
}

export async function noteChannelStatus(params: {
  cfg: CrawClawConfig;
  prompter: WizardPrompter;
  options?: SetupChannelsOptions;
  accountOverrides?: Partial<Record<ChannelChoice, string>>;
  installedPlugins?: ChannelSetupPlugin[];
  resolveAdapter?: (channel: ChannelChoice) => ChannelSetupWizardAdapter | undefined;
}): Promise<void> {
  const { statusLines } = await collectChannelStatus({
    cfg: params.cfg,
    options: params.options,
    accountOverrides: params.accountOverrides ?? {},
    installedPlugins: params.installedPlugins,
    resolveAdapter: params.resolveAdapter,
  });
  if (statusLines.length > 0) {
    await params.prompter.note(statusLines.join("\n"), translateActiveCliText("Channel status"));
  }
}

export async function noteChannelPrimer(
  prompter: WizardPrompter,
  channels: Array<{ id: ChannelChoice; blurb: string; label: string }>,
): Promise<void> {
  const channelLines = channels.map((channel) =>
    translateActiveCliText(
      formatChannelPrimerLine({
        id: channel.id,
        label: channel.label,
        selectionLabel: channel.label,
        docsPath: "/",
        blurb: channel.blurb,
      }),
    ),
  );
  await prompter.note(
    [
      translateActiveCliText("DM security: default is pairing; unknown DMs get a pairing code."),
      translateActiveCliText(
        `Approve with: ${formatCliCommand("crawclaw pairing approve <channel> <code>")}`,
      ),
      translateActiveCliText('Public DMs require dmPolicy="open" + allowFrom=["*"].'),
      translateActiveCliText("Multi-user DMs: run: ") +
        formatCliCommand('crawclaw config set session.dmScope "per-channel-peer"') +
        translateActiveCliText(
          ' (or "per-account-channel-peer" for multi-account channels) to isolate sessions.',
        ),
      translateActiveCliText("Docs:") +
        ` ${formatDocsLink("/channels/pairing", "channels/pairing")}`,
      "",
      ...channelLines,
    ].join("\n"),
    translateActiveCliText("How channels work"),
  );
}

export function resolveQuickstartDefault(
  statusByChannel: Map<ChannelChoice, { quickstartScore?: number }>,
): ChannelChoice | undefined {
  let best: { channel: ChannelChoice; score: number } | null = null;
  for (const [channel, status] of statusByChannel) {
    if (status.quickstartScore == null) {
      continue;
    }
    if (!best || status.quickstartScore > best.score) {
      best = { channel, score: status.quickstartScore };
    }
  }
  return best?.channel;
}

export function resolveChannelSelectionNoteLines(params: {
  cfg: CrawClawConfig;
  installedPlugins: ChannelSetupPlugin[];
  selection: ChannelChoice[];
}): string[] {
  const { entries } = resolveChannelSetupEntries({
    cfg: params.cfg,
    installedPlugins: params.installedPlugins,
    workspaceDir: resolveAgentWorkspaceDir(params.cfg, resolveDefaultAgentId(params.cfg)),
  });
  const selectionNotes = new Map<string, string>();
  for (const entry of entries) {
    selectionNotes.set(entry.id, formatChannelSelectionLine(entry.meta, formatDocsLink));
  }
  return params.selection
    .map((channel) => selectionNotes.get(channel))
    .filter((line): line is string => Boolean(line));
}

export function resolveChannelSetupSelectionContributions(params: {
  entries: Array<{
    id: ChannelChoice;
    meta: {
      id: string;
      label: string;
      selectionLabel?: string;
      profile?: ChannelProfile;
    };
  }>;
  statusByChannel: Map<ChannelChoice, { selectionHint?: string }>;
  resolveDisabledHint: (channel: ChannelChoice) => string | undefined;
  profile?: ChannelProfile;
}): ChannelSetupSelectionContribution[] {
  const matchingEntries = params.profile
    ? params.entries.filter((entry) => entry.meta.profile === params.profile)
    : params.entries;
  const entries = matchingEntries.length > 0 ? matchingEntries : params.entries;

  return entries.map((entry) => {
    const disabledHint = params.resolveDisabledHint(entry.id);
    const hint =
      [params.statusByChannel.get(entry.id)?.selectionHint, disabledHint]
        .filter(Boolean)
        .join(" · ") || undefined;
    return buildChannelSetupSelectionContribution({
      channel: entry.id,
      label: entry.meta.selectionLabel ?? entry.meta.label,
      hint,
      source: listChatChannels().some((channel) => channel.id === entry.id) ? "core" : "plugin",
    });
  });
}

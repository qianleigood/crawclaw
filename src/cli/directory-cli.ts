import type { Command } from "commander";
import { resolveChannelDefaultAccountId } from "../channels/plugins/helpers.js";
import { getChannelPlugin } from "../channels/plugins/index.js";
import { resolveInstallableChannelPlugin } from "../commands/channel-setup/channel-plugin-resolution.js";
import { loadConfig, readConfigFileSnapshot, replaceConfigFile } from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { danger } from "../globals.js";
import { resolveMessageChannelSelection } from "../infra/outbound/channel-selection.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { getTerminalTableWidth, renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { formatHelpExamples } from "./help-format.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

function parseLimit(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return null;
    }
    return Math.floor(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function buildRows(entries: Array<{ id: string; name?: string | undefined }>) {
  return entries.map((entry) => ({
    ID: entry.id,
    Name: entry.name?.trim() ?? "",
  }));
}

function printDirectoryList(params: {
  title: string;
  emptyMessage: string;
  entries: Array<{ id: string; name?: string | undefined }>;
}): void {
  if (params.entries.length === 0) {
    defaultRuntime.log(theme.muted(params.emptyMessage));
    return;
  }

  const tableWidth = getTerminalTableWidth();
  defaultRuntime.log(`${theme.heading(params.title)} ${theme.muted(`(${params.entries.length})`)}`);
  defaultRuntime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "ID", header: "ID", minWidth: 16, flex: true },
        { key: "Name", header: "Name", minWidth: 18, flex: true },
      ],
      rows: buildRows(params.entries),
    }).trimEnd(),
  );
}

export function registerDirectoryCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const directory = program
    .command("directory")
    .description(t("command.directory.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw directory self --channel slack", t("command.directory.example.self")],
          [
            'crawclaw directory peers list --channel slack --query "alice"',
            t("command.directory.example.peers"),
          ],
          [
            "crawclaw directory groups list --channel discord",
            t("command.directory.example.groups"),
          ],
          [
            "crawclaw directory groups members --channel discord --group-id <id>",
            t("command.directory.example.members"),
          ],
        ])}\n\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink(
          "/cli/directory",
          "docs.crawclaw.ai/cli/directory",
        )}\n`,
    )
    .action(() => {
      directory.help({ error: true });
    });

  const withChannel = (cmd: Command) =>
    cmd
      .option("--channel <name>", t("command.directory.option.channel"))
      .option("--account <id>", t("command.directory.option.account"))
      .option("--json", t("command.directory.option.json"), false);

  const resolve = async (opts: { channel?: string; account?: string }) => {
    const sourceSnapshotPromise = readConfigFileSnapshot().catch(() => null);
    const autoEnabled = applyPluginAutoEnable({
      config: loadConfig(),
      env: process.env,
    });
    let cfg = autoEnabled.config;
    const explicitChannel = opts.channel?.trim();
    const resolvedExplicit = explicitChannel
      ? await resolveInstallableChannelPlugin({
          cfg,
          runtime: defaultRuntime,
          rawChannel: explicitChannel,
          allowInstall: true,
          supports: (plugin) => Boolean(plugin.directory),
        })
      : null;
    if (resolvedExplicit?.configChanged) {
      cfg = resolvedExplicit.cfg;
      await replaceConfigFile({
        nextConfig: cfg,
        baseHash: (await sourceSnapshotPromise)?.hash,
      });
    } else if (autoEnabled.changes.length > 0) {
      await replaceConfigFile({
        nextConfig: cfg,
        baseHash: (await sourceSnapshotPromise)?.hash,
      });
    }
    const selection = explicitChannel
      ? {
          channel: resolvedExplicit?.channelId,
        }
      : await resolveMessageChannelSelection({
          cfg,
          channel: opts.channel ?? null,
        });
    const channelId = selection.channel;
    const plugin =
      resolvedExplicit?.plugin ?? (channelId ? getChannelPlugin(channelId) : undefined);
    if (!plugin) {
      throw new Error(`Unsupported channel: ${String(channelId)}`);
    }
    const accountId = opts.account?.trim() || resolveChannelDefaultAccountId({ plugin, cfg });
    return { cfg, channelId, accountId, plugin };
  };

  const runDirectoryList = async (params: {
    opts: {
      channel?: unknown;
      account?: unknown;
      query?: unknown;
      limit?: unknown;
      json?: unknown;
    };
    action: "listPeers" | "listGroups";
    unsupported: string;
    title: string;
    emptyMessage: string;
  }) => {
    const { cfg, channelId, accountId, plugin } = await resolve({
      channel: params.opts.channel as string | undefined,
      account: params.opts.account as string | undefined,
    });
    const fn =
      params.action === "listPeers" ? plugin.directory?.listPeers : plugin.directory?.listGroups;
    if (!fn) {
      throw new Error(`Channel ${channelId} does not support directory ${params.unsupported}`);
    }
    const result = await fn({
      cfg,
      accountId,
      query: (params.opts.query as string | undefined) ?? null,
      limit: parseLimit(params.opts.limit),
      runtime: defaultRuntime,
    });
    if (params.opts.json) {
      defaultRuntime.writeJson(result);
      return;
    }
    printDirectoryList({ title: params.title, emptyMessage: params.emptyMessage, entries: result });
  };

  withChannel(
    directory.command("self").description(t("command.directory.self.description")),
  ).action(async (opts) => {
    try {
      const { cfg, channelId, accountId, plugin } = await resolve({
        channel: opts.channel as string | undefined,
        account: opts.account as string | undefined,
      });
      const fn = plugin.directory?.self;
      if (!fn) {
        throw new Error(`Channel ${channelId} does not support directory self`);
      }
      const result = await fn({ cfg, accountId, runtime: defaultRuntime });
      if (opts.json) {
        defaultRuntime.writeJson(result);
        return;
      }
      if (!result) {
        defaultRuntime.log(theme.muted("Not available."));
        return;
      }
      const tableWidth = getTerminalTableWidth();
      defaultRuntime.log(theme.heading("Self"));
      defaultRuntime.log(
        renderTable({
          width: tableWidth,
          columns: [
            { key: "ID", header: "ID", minWidth: 16, flex: true },
            { key: "Name", header: "Name", minWidth: 18, flex: true },
          ],
          rows: buildRows([result]),
        }).trimEnd(),
      );
    } catch (err) {
      defaultRuntime.error(danger(String(err)));
      defaultRuntime.exit(1);
    }
  });

  const peers = directory.command("peers").description(t("command.directory.peers.description"));
  withChannel(peers.command("list").description(t("command.directory.peers.list.description")))
    .option("--query <text>", t("command.directory.option.query"))
    .option("--limit <n>", t("command.directory.option.limit"))
    .action(async (opts) => {
      try {
        await runDirectoryList({
          opts,
          action: "listPeers",
          unsupported: "peers",
          title: "Peers",
          emptyMessage: "No peers found.",
        });
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  const groups = directory.command("groups").description(t("command.directory.groups.description"));
  withChannel(groups.command("list").description(t("command.directory.groups.list.description")))
    .option("--query <text>", t("command.directory.option.query"))
    .option("--limit <n>", t("command.directory.option.limit"))
    .action(async (opts) => {
      try {
        await runDirectoryList({
          opts,
          action: "listGroups",
          unsupported: "groups",
          title: "Groups",
          emptyMessage: "No groups found.",
        });
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  withChannel(
    groups
      .command("members")
      .description(t("command.directory.groups.members.description"))
      .requiredOption("--group-id <id>", t("command.directory.groups.members.option.groupId")),
  )
    .option("--limit <n>", t("command.directory.option.limit"))
    .action(async (opts) => {
      try {
        const { cfg, channelId, accountId, plugin } = await resolve({
          channel: opts.channel as string | undefined,
          account: opts.account as string | undefined,
        });
        const fn = plugin.directory?.listGroupMembers;
        if (!fn) {
          throw new Error(`Channel ${channelId} does not support group members listing`);
        }
        const groupId = String(opts.groupId ?? "").trim();
        if (!groupId) {
          throw new Error("Missing --group-id");
        }
        const result = await fn({
          cfg,
          accountId,
          groupId,
          limit: parseLimit(opts.limit),
          runtime: defaultRuntime,
        });
        if (opts.json) {
          defaultRuntime.writeJson(result);
          return;
        }
        printDirectoryList({
          title: "Group Members",
          emptyMessage: "No group members found.",
          entries: result,
        });
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}

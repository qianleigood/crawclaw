import type { Command } from "commander";
import { normalizeChannelId } from "../channels/plugins/index.js";
import { listPairingChannels, notifyPairingApproved } from "../channels/plugins/pairing.js";
import { loadConfig } from "../config/config.js";
import { resolvePairingIdLabel } from "../pairing/pairing-labels.js";
import {
  approveChannelPairingCode,
  listChannelPairingRequests,
  type PairingChannel,
} from "../pairing/pairing-store.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { getTerminalTableWidth, renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { formatCliCommand } from "./command-format.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

/** Parse channel, allowing extension channels not in core registry. */
function parseChannel(raw: unknown, channels: PairingChannel[]): PairingChannel {
  const value = (
    typeof raw === "string"
      ? raw
      : typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : ""
  )
    .trim()
    .toLowerCase();
  if (!value) {
    throw new Error("Channel required");
  }

  const normalized = normalizeChannelId(value);
  if (normalized) {
    if (!channels.includes(normalized)) {
      throw new Error(`Channel ${normalized} does not support pairing`);
    }
    return normalized;
  }

  // Allow extension channels: validate format but don't require registry
  if (/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    return value as PairingChannel;
  }
  throw new Error(`Invalid channel: ${value}`);
}

async function notifyApproved(channel: PairingChannel, id: string) {
  const cfg = loadConfig();
  await notifyPairingApproved({ channelId: channel, id, cfg });
}

export function registerPairingCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const channels = listPairingChannels();
  const pairing = program
    .command("pairing")
    .description(t("command.pairing.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/pairing", "docs.crawclaw.ai/cli/pairing")}\n`,
    );

  pairing
    .command("list")
    .description(t("command.pairing.list.description"))
    .option(
      "--channel <channel>",
      t("command.pairing.option.channel", { channels: channels.join(", ") }),
    )
    .option("--account <accountId>", t("command.pairing.option.account"))
    .argument("[channel]", t("command.pairing.argument.channel", { channels: channels.join(", ") }))
    .option("--json", t("command.pairing.option.json"), false)
    .action(async (channelArg, opts) => {
      const channelRaw = opts.channel ?? channelArg ?? (channels.length === 1 ? channels[0] : "");
      if (!channelRaw) {
        throw new Error(
          `Channel required. Use --channel <channel> or pass it as the first argument (expected one of: ${channels.join(", ")})`,
        );
      }
      const channel = parseChannel(channelRaw, channels);
      const accountId = String(opts.account ?? "").trim();
      const requests = accountId
        ? await listChannelPairingRequests(channel, process.env, accountId)
        : await listChannelPairingRequests(channel);
      if (opts.json) {
        defaultRuntime.writeJson({ channel, requests });
        return;
      }
      if (requests.length === 0) {
        defaultRuntime.log(theme.muted(`No pending ${channel} pairing requests.`));
        return;
      }
      const idLabel = resolvePairingIdLabel(channel);
      const tableWidth = getTerminalTableWidth();
      defaultRuntime.log(
        `${theme.heading("Pairing requests")} ${theme.muted(`(${requests.length})`)}`,
      );
      defaultRuntime.log(
        renderTable({
          width: tableWidth,
          columns: [
            { key: "Code", header: "Code", minWidth: 10 },
            { key: "ID", header: idLabel, minWidth: 12, flex: true },
            { key: "Meta", header: "Meta", minWidth: 8, flex: true },
            { key: "Requested", header: "Requested", minWidth: 12 },
          ],
          rows: requests.map((r) => ({
            Code: r.code,
            ID: r.id,
            Meta: r.meta ? JSON.stringify(r.meta) : "",
            Requested: r.createdAt,
          })),
        }).trimEnd(),
      );
    });

  pairing
    .command("approve")
    .description(t("command.pairing.approve.description"))
    .option(
      "--channel <channel>",
      t("command.pairing.option.channel", { channels: channels.join(", ") }),
    )
    .option("--account <accountId>", t("command.pairing.option.account"))
    .argument("<codeOrChannel>", t("command.pairing.approve.argument.codeOrChannel"))
    .argument("[code]", t("command.pairing.approve.argument.code"))
    .option("--notify", t("command.pairing.approve.option.notify"), false)
    .action(async (codeOrChannel, code, opts) => {
      const defaultChannel = channels.length === 1 ? channels[0] : "";
      const usingExplicitChannel = Boolean(opts.channel);
      const hasPositionalCode = code != null;
      const channelRaw = usingExplicitChannel
        ? opts.channel
        : hasPositionalCode
          ? codeOrChannel
          : defaultChannel;
      const resolvedCode = usingExplicitChannel
        ? codeOrChannel
        : hasPositionalCode
          ? code
          : codeOrChannel;
      if (!channelRaw || !resolvedCode) {
        throw new Error(
          `Usage: ${formatCliCommand("crawclaw pairing approve <channel> <code>")} (or: ${formatCliCommand("crawclaw pairing approve --channel <channel> <code>")})`,
        );
      }
      if (opts.channel && code != null) {
        throw new Error(
          `Too many arguments. Use: ${formatCliCommand("crawclaw pairing approve --channel <channel> <code>")}`,
        );
      }
      const channel = parseChannel(channelRaw, channels);
      const accountId = String(opts.account ?? "").trim();
      const approved = accountId
        ? await approveChannelPairingCode({
            channel,
            code: String(resolvedCode),
            accountId,
          })
        : await approveChannelPairingCode({
            channel,
            code: String(resolvedCode),
          });
      if (!approved) {
        throw new Error(`No pending pairing request found for code: ${String(resolvedCode)}`);
      }

      defaultRuntime.log(
        `${theme.success("Approved")} ${theme.muted(channel)} sender ${theme.command(approved.id)}.`,
      );

      if (!opts.notify) {
        return;
      }
      await notifyApproved(channel, approved.id).catch((err) => {
        defaultRuntime.log(theme.warn(`Failed to notify requester: ${String(err)}`));
      });
    });
}

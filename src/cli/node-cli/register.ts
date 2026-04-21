import type { Command } from "commander";
import { loadNodeHostConfig } from "../../node-host/config.js";
import { runNodeHost } from "../../node-host/runner.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { parsePort } from "../daemon-cli/shared.js";
import { formatHelpExamples } from "../help-format.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "../program/program-context.js";
import {
  runNodeDaemonInstall,
  runNodeDaemonRestart,
  runNodeDaemonStatus,
  runNodeDaemonStop,
  runNodeDaemonUninstall,
} from "./daemon.js";

function parsePortWithFallback(value: unknown, fallback: number): number {
  const parsed = parsePort(value);
  return parsed ?? fallback;
}

export function registerNodeCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const node = program
    .command("node")
    .description(t("command.node.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw node run --host 127.0.0.1 --port 18789", t("command.node.example.run")],
          ["crawclaw node status", t("command.node.example.status")],
          ["crawclaw node install", t("command.node.example.install")],
          ["crawclaw node restart", t("command.node.example.restart")],
        ])}\n\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/node", "docs.crawclaw.ai/cli/node")}\n`,
    );

  node
    .command("run")
    .description(t("command.node.run.description"))
    .option("--host <host>", t("command.node.option.host"))
    .option("--port <port>", t("command.node.option.port"))
    .option("--tls", t("command.node.option.tls"), false)
    .option("--tls-fingerprint <sha256>", t("command.node.option.tlsFingerprint"))
    .option("--node-id <id>", t("command.node.option.nodeId"))
    .option("--display-name <name>", t("command.node.option.displayName"))
    .action(async (opts) => {
      const existing = await loadNodeHostConfig();
      const host =
        (opts.host as string | undefined)?.trim() || existing?.gateway?.host || "127.0.0.1";
      const port = parsePortWithFallback(opts.port, existing?.gateway?.port ?? 18789);
      await runNodeHost({
        gatewayHost: host,
        gatewayPort: port,
        gatewayTls: Boolean(opts.tls) || Boolean(opts.tlsFingerprint),
        gatewayTlsFingerprint: opts.tlsFingerprint,
        nodeId: opts.nodeId,
        displayName: opts.displayName,
      });
    });

  node
    .command("status")
    .description(t("command.node.status.description"))
    .option("--json", t("command.node.option.json"), false)
    .action(async (opts) => {
      await runNodeDaemonStatus(opts);
    });

  node
    .command("install")
    .description(t("command.node.install.description"))
    .option("--host <host>", t("command.node.option.host"))
    .option("--port <port>", t("command.node.option.port"))
    .option("--tls", t("command.node.option.tls"), false)
    .option("--tls-fingerprint <sha256>", t("command.node.option.tlsFingerprint"))
    .option("--node-id <id>", t("command.node.option.nodeId"))
    .option("--display-name <name>", t("command.node.option.displayName"))
    .option("--runtime <runtime>", t("command.node.option.runtime"))
    .option("--force", t("command.node.option.force"), false)
    .option("--json", t("command.node.option.json"), false)
    .action(async (opts) => {
      await runNodeDaemonInstall(opts);
    });

  node
    .command("uninstall")
    .description(t("command.node.uninstall.description"))
    .option("--json", t("command.node.option.json"), false)
    .action(async (opts) => {
      await runNodeDaemonUninstall(opts);
    });

  node
    .command("stop")
    .description(t("command.node.stop.description"))
    .option("--json", t("command.node.option.json"), false)
    .action(async (opts) => {
      await runNodeDaemonStop(opts);
    });

  node
    .command("restart")
    .description(t("command.node.restart.description"))
    .option("--json", t("command.node.option.json"), false)
    .action(async (opts) => {
      await runNodeDaemonRestart(opts);
    });
}

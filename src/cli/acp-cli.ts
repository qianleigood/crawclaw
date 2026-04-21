import type { Command } from "commander";
import { runAcpClientInteractive } from "../acp/client.js";
import { readSecretFromFile } from "../acp/secret-file.js";
import { serveAcpGateway } from "../acp/server.js";
import { normalizeAcpProvenanceMode } from "../acp/types.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { inheritOptionFromParent } from "./command-options.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

function resolveSecretOption(params: {
  direct?: string;
  file?: string;
  directFlag: string;
  fileFlag: string;
  label: string;
}) {
  const direct = params.direct?.trim();
  const file = params.file?.trim();
  if (direct && file) {
    throw new Error(`Use either ${params.directFlag} or ${params.fileFlag} for ${params.label}.`);
  }
  if (file) {
    return readSecretFromFile(file, params.label);
  }
  return direct || undefined;
}

function warnSecretCliFlag(flag: "--token" | "--password") {
  defaultRuntime.error(
    `Warning: ${flag} can be exposed via process listings. Prefer ${flag}-file or environment variables.`,
  );
}

export function registerAcpCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const acp = program.command("acp").description(t("command.acp.description"));

  acp
    .option("--url <url>", t("command.acp.option.url"))
    .option("--token <token>", t("command.acp.option.token"))
    .option("--token-file <path>", t("command.acp.option.tokenFile"))
    .option("--password <password>", t("command.acp.option.password"))
    .option("--password-file <path>", t("command.acp.option.passwordFile"))
    .option("--session <key>", t("command.acp.option.session"))
    .option("--session-label <label>", t("command.acp.option.sessionLabel"))
    .option("--require-existing", t("command.acp.option.requireExisting"), false)
    .option("--reset-session", t("command.acp.option.resetSession"), false)
    .option("--no-prefix-cwd", t("command.acp.option.noPrefixCwd"), false)
    .option("--provenance <mode>", t("command.acp.option.provenance"))
    .option("-v, --verbose", t("command.acp.option.verbose"), false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/acp", "docs.crawclaw.ai/cli/acp")}\n`,
    )
    .action(async (opts) => {
      try {
        const gatewayToken = resolveSecretOption({
          direct: opts.token as string | undefined,
          file: opts.tokenFile as string | undefined,
          directFlag: "--token",
          fileFlag: "--token-file",
          label: "Gateway token",
        });
        const gatewayPassword = resolveSecretOption({
          direct: opts.password as string | undefined,
          file: opts.passwordFile as string | undefined,
          directFlag: "--password",
          fileFlag: "--password-file",
          label: "Gateway password",
        });
        if (opts.token) {
          warnSecretCliFlag("--token");
        }
        if (opts.password) {
          warnSecretCliFlag("--password");
        }
        const provenanceMode = normalizeAcpProvenanceMode(opts.provenance as string | undefined);
        if (opts.provenance && !provenanceMode) {
          throw new Error("Invalid --provenance value. Use off, meta, or meta+receipt.");
        }
        await serveAcpGateway({
          gatewayUrl: opts.url as string | undefined,
          gatewayToken,
          gatewayPassword,
          defaultSessionKey: opts.session as string | undefined,
          defaultSessionLabel: opts.sessionLabel as string | undefined,
          requireExistingSession: Boolean(opts.requireExisting),
          resetSession: Boolean(opts.resetSession),
          prefixCwd: !opts.noPrefixCwd,
          provenanceMode,
          verbose: Boolean(opts.verbose),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  acp
    .command("client")
    .description(t("command.acp.client.description"))
    .option("--cwd <dir>", t("command.acp.client.option.cwd"))
    .option("--server <command>", t("command.acp.client.option.server"))
    .option("--server-args <args...>", t("command.acp.client.option.serverArgs"))
    .option("--server-verbose", t("command.acp.client.option.serverVerbose"), false)
    .option("-v, --verbose", t("command.acp.client.option.verbose"), false)
    .action(async (opts, command) => {
      const inheritedVerbose = inheritOptionFromParent<boolean>(command, "verbose");
      try {
        await runAcpClientInteractive({
          cwd: opts.cwd as string | undefined,
          serverCommand: opts.server as string | undefined,
          serverArgs: opts.serverArgs as string[] | undefined,
          serverVerbose: Boolean(opts.serverVerbose),
          verbose: Boolean(opts.verbose || inheritedVerbose),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}

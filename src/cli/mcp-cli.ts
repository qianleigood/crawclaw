import { Command } from "commander";
import { readSecretFromFile } from "../acp/secret-file.js";
import { parseConfigValue } from "../auto-reply/reply/config-value.js";
import {
  listConfiguredMcpServers,
  setConfiguredMcpServer,
  unsetConfiguredMcpServer,
} from "../config/mcp-config.js";
import { serveCrawClawChannelMcp } from "../mcp/channel-server.js";
import { defaultRuntime } from "../runtime.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

function fail(message: string): never {
  defaultRuntime.error(message);
  defaultRuntime.exit(1);
  throw new Error(message);
}

function printJson(value: unknown): void {
  defaultRuntime.writeJson(value);
}

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

export function registerMcpCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const mcp = program.command("mcp").description(t("command.mcp.description"));

  mcp
    .command("serve")
    .description(t("command.mcp.serve.description"))
    .option("--url <url>", t("command.mcp.option.url"))
    .option("--token <token>", t("command.mcp.option.token"))
    .option("--token-file <path>", t("command.mcp.option.tokenFile"))
    .option("--password <password>", t("command.mcp.option.password"))
    .option("--password-file <path>", t("command.mcp.option.passwordFile"))
    .option("--claude-channel-mode <mode>", t("command.mcp.serve.option.claudeChannelMode"), "auto")
    .option("-v, --verbose", t("command.mcp.serve.option.verbose"), false)
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
        const claudeChannelMode = String(opts.claudeChannelMode ?? "auto")
          .trim()
          .toLowerCase();
        if (
          claudeChannelMode !== "auto" &&
          claudeChannelMode !== "on" &&
          claudeChannelMode !== "off"
        ) {
          throw new Error("Invalid --claude-channel-mode value. Use auto, on, or off.");
        }
        await serveCrawClawChannelMcp({
          gatewayUrl: opts.url as string | undefined,
          gatewayToken,
          gatewayPassword,
          claudeChannelMode,
          verbose: Boolean(opts.verbose),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  mcp
    .command("list")
    .description(t("command.mcp.list.description"))
    .option("--json", t("command.mcp.option.json"))
    .action(async (opts: { json?: boolean }) => {
      const loaded = await listConfiguredMcpServers();
      if (!loaded.ok) {
        fail(loaded.error);
      }
      if (opts.json) {
        printJson(loaded.mcpServers);
        return;
      }
      const names = Object.keys(loaded.mcpServers).toSorted();
      if (names.length === 0) {
        defaultRuntime.log(`No MCP servers configured in ${loaded.path}.`);
        return;
      }
      defaultRuntime.log(`MCP servers (${loaded.path}):`);
      for (const name of names) {
        defaultRuntime.log(`- ${name}`);
      }
    });

  mcp
    .command("show")
    .description(t("command.mcp.show.description"))
    .argument("[name]", t("command.mcp.argument.name"))
    .option("--json", t("command.mcp.option.json"))
    .action(async (name: string | undefined, opts: { json?: boolean }) => {
      const loaded = await listConfiguredMcpServers();
      if (!loaded.ok) {
        fail(loaded.error);
      }
      const value = name ? loaded.mcpServers[name] : loaded.mcpServers;
      if (name && !value) {
        fail(`No MCP server named "${name}" in ${loaded.path}.`);
      }
      if (opts.json) {
        printJson(value ?? {});
        return;
      }
      if (name) {
        defaultRuntime.log(`MCP server "${name}" (${loaded.path}):`);
      } else {
        defaultRuntime.log(`MCP servers (${loaded.path}):`);
      }
      printJson(value ?? {});
    });

  mcp
    .command("set")
    .description(t("command.mcp.set.description"))
    .argument("<name>", t("command.mcp.argument.name"))
    .argument("<value>", t("command.mcp.set.argument.value"))
    .action(async (name: string, rawValue: string) => {
      const parsed = parseConfigValue(rawValue);
      if (parsed.error) {
        fail(parsed.error);
      }
      const result = await setConfiguredMcpServer({ name, server: parsed.value });
      if (!result.ok) {
        fail(result.error);
      }
      defaultRuntime.log(`Saved MCP server "${name}" to ${result.path}.`);
    });

  mcp
    .command("unset")
    .description(t("command.mcp.unset.description"))
    .argument("<name>", t("command.mcp.argument.name"))
    .action(async (name: string) => {
      const result = await unsetConfiguredMcpServer({ name });
      if (!result.ok) {
        fail(result.error);
      }
      if (!result.removed) {
        fail(`No MCP server named "${name}" in ${result.path}.`);
      }
      defaultRuntime.log(`Removed MCP server "${name}" from ${result.path}.`);
    });
}

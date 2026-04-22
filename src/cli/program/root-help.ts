import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { VERSION } from "../../version.js";
import { resolveCliLocale } from "../i18n/locale.js";
import type {
  CliLocale,
  CliTranslationParams,
  CliTranslations,
  CliTranslator,
} from "../i18n/types.js";
import {
  getCoreCliCommandDescriptors,
  localizeCoreCliCommandDescriptors,
} from "./core-command-descriptors.js";
import { configureProgramHelp } from "./help.js";
import { getSubCliEntries, localizeSubCliEntries } from "./subcli-descriptors.js";

type RootHelpConfigHints = {
  cliLanguage?: string;
  plugins?: unknown;
};

const ROOT_HELP_EN_TRANSLATIONS: CliTranslations = {
  "cli.option.version": "Output the version number",
  "cli.option.lang": "Prompt/help language (en or zh-CN)",
  "cli.option.container":
    "Run the CLI inside a running Podman/Docker container named <name> (default: env CRAWCLAW_CONTAINER)",
  "cli.option.dev":
    "Dev profile: isolate state under ~/.crawclaw-dev, default gateway port 19001, and shift derived ports (browser/canvas)",
  "cli.option.profile":
    "Use a named profile (isolates CRAWCLAW_STATE_DIR/CRAWCLAW_CONFIG_PATH under ~/.crawclaw-<name>)",
  "cli.option.logLevel": "Global log level override for file + console ({values})",
  "cli.option.noColor": "Disable ANSI colors",
  "cli.help.helpOption": "Display help for command",
  "cli.help.helpCommand": "Display help for command",
  "cli.help.rootCommandsHint":
    "Hint: commands suffixed with * have subcommands. Run <command> --help for details.",
  "cli.help.usageHeading": "Usage:",
  "cli.help.optionsHeading": "Options:",
  "cli.help.commandsHeading": "Commands:",
  "cli.help.examplesHeading": "Examples:",
  "cli.help.docsLabel": "Docs:",
  "cli.help.example.modelsHelp": "Show detailed help for the models command.",
  "cli.help.example.channelsLoginVerbose":
    "Link personal WhatsApp Web and show QR + connection logs.",
  "cli.help.example.messageSendJson": "Send via your web session and print JSON result.",
  "cli.help.example.gatewayPort": "Run the WebSocket Gateway locally.",
  "cli.help.example.devGateway":
    "Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001.",
  "cli.help.example.gatewayForce":
    "Kill anything bound to the default gateway port, then start it.",
  "cli.help.example.gatewayEllipsis": "Gateway control via WebSocket.",
  "cli.help.example.agentDeliver":
    "Talk directly to the agent using the Gateway; optionally send the WhatsApp reply.",
  "cli.help.example.telegramSend": "Send via your Telegram bot.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExplicitPluginConfig(plugins: unknown): boolean {
  if (!isRecord(plugins)) {
    return false;
  }
  if (typeof plugins.enabled === "boolean") {
    return true;
  }
  if (Array.isArray(plugins.allow) && plugins.allow.length > 0) {
    return true;
  }
  if (Array.isArray(plugins.deny) && plugins.deny.length > 0) {
    return true;
  }
  const load = plugins.load;
  if (isRecord(load) && Array.isArray(load.paths) && load.paths.length > 0) {
    return true;
  }
  if (isRecord(plugins.slots) && Object.keys(plugins.slots).length > 0) {
    return true;
  }
  if (isRecord(plugins.entries) && Object.keys(plugins.entries).length > 0) {
    return true;
  }
  return false;
}

function resolveHome(env: NodeJS.ProcessEnv): string {
  return env.CRAWCLAW_HOME?.trim() || env.HOME?.trim() || os.homedir();
}

function resolveRootHelpConfigPath(env: NodeJS.ProcessEnv): string {
  const home = resolveHome(env);
  const expandHome = (value: string) =>
    value === "~" || value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
  const explicit = env.CRAWCLAW_CONFIG_PATH?.trim();
  if (explicit) {
    return expandHome(explicit);
  }
  const stateDir = env.CRAWCLAW_STATE_DIR?.trim()
    ? expandHome(env.CRAWCLAW_STATE_DIR.trim())
    : path.join(home, ".crawclaw");
  return path.join(stateDir, "crawclaw.json");
}

function readRootHelpConfigHints(env: NodeJS.ProcessEnv = process.env): RootHelpConfigHints {
  try {
    const raw = fs.readFileSync(resolveRootHelpConfigPath(env), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    const cli = parsed.cli;
    return {
      cliLanguage: isRecord(cli) && typeof cli.language === "string" ? cli.language : undefined,
      plugins: parsed.plugins,
    };
  } catch {
    return {};
  }
}

function applyTranslationParams(template: string, params?: CliTranslationParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}

async function createRootHelpTranslator(locale: CliLocale): Promise<CliTranslator> {
  let primary: CliTranslations = ROOT_HELP_EN_TRANSLATIONS;
  if (locale === "zh-CN") {
    const { ZH_CN_CLI_TRANSLATIONS } = await import("../i18n/zh-CN.js");
    primary = ZH_CN_CLI_TRANSLATIONS;
  }
  return (key, params) =>
    applyTranslationParams(primary[key] ?? ROOT_HELP_EN_TRANSLATIONS[key] ?? key, params);
}

async function buildRootHelpProgram(): Promise<Command> {
  const program = new Command();
  const configHints = readRootHelpConfigHints();
  const locale = resolveCliLocale({
    argv: process.argv,
    config: configHints.cliLanguage,
    env: process.env.CRAWCLAW_LANG,
  });
  const t = await createRootHelpTranslator(locale);
  configureProgramHelp(program, {
    programVersion: VERSION,
    locale,
    t,
    channelOptions: [],
    messageChannelOptions: "",
    agentChannelOptions: "",
  });

  const existingCommands = new Set<string>();
  const coreDescriptors =
    locale === "zh-CN" ? localizeCoreCliCommandDescriptors(t) : getCoreCliCommandDescriptors();
  for (const command of coreDescriptors) {
    program.command(command.name).description(command.description);
    existingCommands.add(command.name);
  }
  const subCliDescriptors = locale === "zh-CN" ? localizeSubCliEntries(t) : getSubCliEntries();
  for (const command of subCliDescriptors) {
    if (existingCommands.has(command.name)) {
      continue;
    }
    program.command(command.name).description(command.description);
    existingCommands.add(command.name);
  }
  if (hasExplicitPluginConfig(configHints.plugins)) {
    const { loadConfig } = await import("../../config/config.js");
    const { getPluginCliCommandDescriptors } = await import("../../plugins/cli.js");
    const config = loadConfig();
    for (const command of await getPluginCliCommandDescriptors(config, undefined, { locale })) {
      if (existingCommands.has(command.name)) {
        continue;
      }
      program.command(command.name).description(command.description);
      existingCommands.add(command.name);
    }
  }

  return program;
}

export async function renderRootHelpText(): Promise<string> {
  const program = await buildRootHelpProgram();
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  const captureWrite: typeof process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = captureWrite;
  try {
    program.outputHelp();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}

export async function outputRootHelp(): Promise<void> {
  process.stdout.write(await renderRootHelpText());
}

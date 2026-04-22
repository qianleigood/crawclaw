import { Command } from "commander";
import { loadConfig } from "../../config/config.js";
import { getPluginCliCommandDescriptors } from "../../plugins/cli.js";
import { VERSION } from "../../version.js";
import { createCliTranslator, resolveCliLocale, setActiveCliLocale } from "../i18n/index.js";
import { localizeCoreCliCommandDescriptors } from "./core-command-descriptors.js";
import { configureProgramHelp } from "./help.js";
import { localizeSubCliEntries } from "./subcli-descriptors.js";

async function buildRootHelpProgram(): Promise<Command> {
  const program = new Command();
  let configLanguage: string | undefined;
  try {
    configLanguage = loadConfig().cli?.language;
  } catch {
    configLanguage = undefined;
  }
  const locale = resolveCliLocale({
    argv: process.argv,
    config: configLanguage,
    env: process.env.CRAWCLAW_LANG,
  });
  setActiveCliLocale(locale);
  const t = createCliTranslator(locale);
  configureProgramHelp(program, {
    programVersion: VERSION,
    locale,
    t,
    channelOptions: [],
    messageChannelOptions: "",
    agentChannelOptions: "",
  });

  const existingCommands = new Set<string>();
  for (const command of localizeCoreCliCommandDescriptors(t)) {
    program.command(command.name).description(command.description);
    existingCommands.add(command.name);
  }
  for (const command of localizeSubCliEntries(t)) {
    if (existingCommands.has(command.name)) {
      continue;
    }
    program.command(command.name).description(command.description);
    existingCommands.add(command.name);
  }
  for (const command of await getPluginCliCommandDescriptors(undefined, undefined, { locale })) {
    if (existingCommands.has(command.name)) {
      continue;
    }
    program.command(command.name).description(command.description);
    existingCommands.add(command.name);
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

import type { SlashCommand } from "@mariozechner/pi-tui";
import { listChatCommands, listChatCommandsForConfig } from "../auto-reply/commands-registry.js";
import { formatThinkingLevels, listThinkingLevelLabels } from "../auto-reply/thinking.js";
import { translateTuiText } from "../cli/i18n/tui.js";
import type { CrawClawConfig } from "../config/types.js";

const VERBOSE_LEVELS = ["on", "off"];
const FAST_LEVELS = ["status", "on", "off"];
const REASONING_LEVELS = ["on", "off"];
const ELEVATED_LEVELS = ["on", "off", "ask", "full"];
const ACTIVATION_LEVELS = ["mention", "always"];
const USAGE_FOOTER_LEVELS = ["off", "tokens", "full"];
const DELIVER_LEVELS = ["status", "on", "off"];

export type ParsedCommand = {
  name: string;
  args: string;
};

export type SlashCommandOptions = {
  cfg?: CrawClawConfig;
  provider?: string;
  model?: string;
};

const COMMAND_ALIASES: Record<string, string> = {
  elev: "elevated",
};

function createLevelCompletion(
  levels: string[],
): NonNullable<SlashCommand["getArgumentCompletions"]> {
  return (prefix) =>
    levels
      .filter((value) => value.startsWith(prefix.toLowerCase()))
      .map((value) => ({
        value,
        label: value,
      }));
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.replace(/^\//, "").trim();
  if (!trimmed) {
    return { name: "", args: "" };
  }
  const [name, ...rest] = trimmed.split(/\s+/);
  const normalized = name.toLowerCase();
  return {
    name: COMMAND_ALIASES[normalized] ?? normalized,
    args: rest.join(" ").trim(),
  };
}

export function getSlashCommands(options: SlashCommandOptions = {}): SlashCommand[] {
  const thinkLevels = listThinkingLevelLabels(options.provider, options.model);
  const verboseCompletions = createLevelCompletion(VERBOSE_LEVELS);
  const fastCompletions = createLevelCompletion(FAST_LEVELS);
  const reasoningCompletions = createLevelCompletion(REASONING_LEVELS);
  const usageCompletions = createLevelCompletion(USAGE_FOOTER_LEVELS);
  const elevatedCompletions = createLevelCompletion(ELEVATED_LEVELS);
  const activationCompletions = createLevelCompletion(ACTIVATION_LEVELS);
  const deliverCompletions = createLevelCompletion(DELIVER_LEVELS);
  const commands: SlashCommand[] = [
    { name: "help", description: translateTuiText("tui.command.help") },
    { name: "status", description: translateTuiText("tui.command.status") },
    { name: "agent", description: translateTuiText("tui.command.agent") },
    { name: "agents", description: translateTuiText("tui.command.agents") },
    { name: "session", description: translateTuiText("tui.command.session") },
    { name: "sessions", description: translateTuiText("tui.command.sessions") },
    {
      name: "model",
      description: translateTuiText("tui.command.model"),
    },
    { name: "models", description: translateTuiText("tui.command.models") },
    {
      name: "think",
      description: translateTuiText("tui.command.think"),
      getArgumentCompletions: (prefix) =>
        thinkLevels
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({ value, label: value })),
    },
    {
      name: "fast",
      description: translateTuiText("tui.command.fast"),
      getArgumentCompletions: fastCompletions,
    },
    {
      name: "verbose",
      description: translateTuiText("tui.command.verbose"),
      getArgumentCompletions: verboseCompletions,
    },
    {
      name: "reasoning",
      description: translateTuiText("tui.command.reasoning"),
      getArgumentCompletions: reasoningCompletions,
    },
    {
      name: "usage",
      description: translateTuiText("tui.command.usage"),
      getArgumentCompletions: usageCompletions,
    },
    {
      name: "elevated",
      description: translateTuiText("tui.command.elevated"),
      getArgumentCompletions: elevatedCompletions,
    },
    {
      name: "elev",
      description: translateTuiText("tui.command.elev"),
      getArgumentCompletions: elevatedCompletions,
    },
    {
      name: "activation",
      description: translateTuiText("tui.command.activation"),
      getArgumentCompletions: activationCompletions,
    },
    {
      name: "deliver",
      description: translateTuiText("tui.command.deliver"),
      getArgumentCompletions: deliverCompletions,
    },
    { name: "abort", description: translateTuiText("tui.command.abort") },
    { name: "new", description: translateTuiText("tui.command.new") },
    { name: "settings", description: translateTuiText("tui.command.settings") },
    { name: "exit", description: translateTuiText("tui.command.exit") },
    { name: "quit", description: translateTuiText("tui.command.exit") },
  ];

  const seen = new Set(commands.map((command) => command.name));
  const gatewayCommands = options.cfg ? listChatCommandsForConfig(options.cfg) : listChatCommands();
  for (const command of gatewayCommands) {
    const aliases = command.textAliases.length > 0 ? command.textAliases : [`/${command.key}`];
    for (const alias of aliases) {
      const name = alias.replace(/^\//, "").trim();
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      commands.push({ name, description: command.description });
    }
  }

  return commands;
}

export function helpText(options: SlashCommandOptions = {}): string {
  const thinkLevels = formatThinkingLevels(options.provider, options.model, "|");
  return [
    translateTuiText("tui.help.title"),
    "/help",
    "/commands",
    "/status",
    "/agent <id> (or /agents)",
    "/session <key> (or /sessions)",
    "/model <provider/model> (or /models)",
    `/think <${thinkLevels}>`,
    "/fast <status|on|off>",
    "/verbose <on|off>",
    "/reasoning <on|off>",
    "/usage <off|tokens|full>",
    "/elevated <on|off|ask|full>",
    "/elev <on|off|ask|full>",
    "/activation <mention|always>",
    "/deliver <status|on|off>",
    "/new",
    "/abort",
    "/settings",
    "/exit",
  ].join("\n");
}

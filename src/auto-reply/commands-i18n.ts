import type { CrawClawConfig } from "../config/types.js";
import type {
  ChatCommandDefinition,
  CommandArgChoice,
  CommandArgDefinition,
  CommandArgMenuSpec,
} from "./commands-registry.types.js";

export function isSlashCommandZhCN(cfg?: CrawClawConfig): boolean {
  return cfg?.cli?.language === "zh-CN";
}

const TEXT_ZH_CN: Record<string, string> = {
  "Usage: /tools [compact|verbose]": "用法：/tools [compact|verbose]",
  "Usage: /allowlist add|remove <entry>": "用法：/allowlist add|remove <entry>",
  "Usage: /approve <id> <decision> (see the pending approval message for available decisions)":
    "用法：/approve <id> <decision>（可用 decision 请看待处理审批消息）",
  "Usage: /btw <side question>": "用法：/btw <side question>",
  "Usage: /config show|set|unset": "用法：/config show|set|unset",
  "Usage: /config set path=value": "用法：/config set path=value",
  "Usage: /debug show|set|unset|reset": "用法：/debug show|set|unset|reset",
  "Usage: /focus <subagent-label|session-key|session-id|session-label>":
    "用法：/focus <subagent-label|session-key|session-id|session-label>",
  "Usage: /kill <id|#|all>": "用法：/kill <id|#|all>",
  "Usage: /mcp show|set|unset": "用法：/mcp show|set|unset",
  "Usage: /plugins install <path|archive|npm-spec|clawhub:pkg>":
    "用法：/plugins install <path|archive|npm-spec|clawhub:pkg>",
  "Usage: /plugins list|inspect|show|get|enable|disable [plugin]":
    "用法：/plugins list|inspect|show|get|enable|disable [plugin]",
  "Usage: /plugins list|inspect|show|get|install|enable|disable [plugin]":
    "用法：/plugins list|inspect|show|get|install|enable|disable [plugin]",
  "Usage: /send on|off|inherit": "用法：/send on|off|inherit",
  "Usage: /session idle <duration|off> | /session max-age <duration|off> (example: /session idle 24h)":
    "用法：/session idle <duration|off> | /session max-age <duration|off>（例如：/session idle 24h）",
  "Usage: /subagents info <id|#>": "用法：/subagents info <id|#>",
  "Usage: /subagents kill <id|#|all>": "用法：/subagents kill <id|#|all>",
  "Usage: /subagents log <id|#> [limit]": "用法：/subagents log <id|#> [limit]",
  "Usage: /subagents send <id|#> <message>": "用法：/subagents send <id|#> <message>",
  "Usage: /subagents spawn <agentId> <task> [--model <model>] [--thinking <level>]":
    "用法：/subagents spawn <agentId> <task> [--model <model>] [--thinking <level>]",
  "Usage: /subagents steer <id|#> <message>": "用法：/subagents steer <id|#> <message>",
  "Usage: /tasks": "用法：/tasks",
  "Usage: /usage off|tokens|full|cost": "用法：/usage off|tokens|full|cost",
  "Usage: /workflow <status|cancel|resume> <executionId> [input]":
    "用法：/workflow <status|cancel|resume> <executionId> [input]",
  "Available tools": "可用工具",
  "Profile: ": "配置档：",
  "What this agent can use right now:": "此 agent 当前可用：",
  "Tool availability depends on this agent's configuration.": "工具可用性取决于此 agent 的配置。",
  "Use /tools verbose for descriptions.": "使用 /tools verbose 查看描述。",
  "No tools are available for this agent right now.": "此 agent 当前没有可用工具。",
  "More: /tools for available capabilities": "更多：/tools 查看可用能力",
  "ℹ️ Slash commands": "ℹ️ 斜杠命令",
  "ℹ️ Help": "ℹ️ 帮助",
  Session: "会话",
  Options: "选项",
  Status: "状态",
  Management: "管理",
  Media: "媒体",
  Tools: "工具",
  Docks: "停靠",
  Skills: "技能",
  Plugins: "插件",
  "More: /commands for full list, /tools for available capabilities":
    "更多：/commands 查看完整列表，/tools 查看可用能力",
  "Built-in tools": "内置工具",
  "Connected tools": "已连接工具",
  "Examples:": "示例：",
  Subagents: "子代理",
  "Usage:": "用法：",
  "Ids: use the list index (#), runId/session prefix, label, or full session key.":
    "Id 可使用列表序号（#）、runId/session 前缀、label，或完整 session key。",
  "You are not authorized to use this command.": "你没有权限使用此命令。",
  "Unknown /context mode.": "未知的 /context 模式。",
  "Use: /context, /context list, /context detail, or /context json":
    "使用：/context、/context list、/context detail 或 /context json",
  "Tip: increase `agents.defaults.bootstrapMaxChars` and/or `agents.defaults.bootstrapTotalMaxChars` if this truncation is not intentional.":
    "提示：如果这次截断并非预期，请增大 `agents.defaults.bootstrapMaxChars` 和/或 `agents.defaults.bootstrapTotalMaxChars`。",
  "⚠️ /btw requires an active session with existing context.":
    "⚠️ /btw 需要一个已存在上下文的活动会话。",
  "⚠️ /btw is unavailable because the active agent directory could not be resolved.":
    "⚠️ /btw 当前不可用，因为无法解析活动 agent 目录。",
  "⚙️ Group activation only applies to group chats.": "⚙️ 群组激活仅适用于群聊。",
  "❌ This /approve command targets a different Telegram bot.":
    "❌ 这个 /approve 命令指向了另一个 Telegram bot。",
  "❌ Telegram exec approvals are not enabled for this bot account.":
    "❌ 当前 bot 账号未启用 Telegram exec 审批。",
  "🔊 TTS enabled.": "🔊 TTS 已启用。",
  "🔇 TTS disabled.": "🔇 TTS 已关闭。",
  "All clear - nothing linked to this session right now.": "一切正常，当前没有与此会话关联的任务。",
  "Current session: 0 active · 0 total": "当前会话：0 个活跃 · 共 0 个",
};

const CHOICE_LABEL_ZH_CN: Record<string, string> = {
  always: "始终",
  ask: "询问",
  audio: "音频",
  collect: "收集",
  compact: "简洁",
  cost: "费用",
  deny: "拒绝",
  full: "完全",
  gateway: "网关",
  help: "帮助",
  high: "高",
  inherit: "继承",
  interrupt: "打断",
  low: "低",
  medium: "中",
  mention: "提及",
  minimal: "最少",
  off: "关闭",
  "on-miss": "未命中时",
  on: "开启",
  provider: "提供方",
  sandbox: "沙盒",
  status: "状态",
  stream: "流式",
  summary: "摘要",
  tokens: "tokens",
  verbose: "详细",
};

export function translateSlashCommandText(
  text: string,
  cfg?: CrawClawConfig,
  zhCN?: string,
): string {
  if (!isSlashCommandZhCN(cfg)) {
    return text;
  }
  return zhCN ?? TEXT_ZH_CN[text] ?? text;
}

function localizePromptLineZhCN(line: string): string {
  if (!line) {
    return line;
  }
  const exact = TEXT_ZH_CN[line];
  if (exact) {
    return exact;
  }
  const invalidMatch = line.match(/^Invalid (\/[^\s]+) syntax\.$/);
  if (invalidMatch) {
    return `无效的 ${invalidMatch[1]} 语法。`;
  }
  if (line.startsWith("Usage: ")) {
    return `用法：${line.slice("Usage: ".length)}`;
  }
  if (line.startsWith("Examples:")) {
    return line.replace("Examples:", "示例：");
  }
  if (line.startsWith("Try: ")) {
    return `试试：${line.slice("Try: ".length)}`;
  }
  if (line.startsWith("More: ")) {
    return `更多：${line.slice("More: ".length)}`;
  }
  if (line.startsWith("All: ")) {
    return `全部：${line.slice("All: ".length)}`;
  }
  if (line.startsWith("Switch: ")) {
    return `切换：${line.slice("Switch: ".length)}`;
  }
  if (line.startsWith("Tip: ")) {
    return `提示：${line.slice("Tip: ".length)}`;
  }
  return line;
}

export function localizeSlashCommandReplyText(text: string, cfg?: CrawClawConfig): string {
  if (!isSlashCommandZhCN(cfg)) {
    return text;
  }
  const exact = TEXT_ZH_CN[text];
  if (exact) {
    return exact;
  }
  return text
    .split("\n")
    .map((line) => localizePromptLineZhCN(line))
    .join("\n");
}

export function translateSlashCommandChoiceLabel(params: {
  value: string;
  label: string;
  cfg?: CrawClawConfig;
  labelZhCN?: string;
}): string {
  if (!isSlashCommandZhCN(params.cfg)) {
    return params.label;
  }
  return (
    params.labelZhCN ??
    CHOICE_LABEL_ZH_CN[params.label] ??
    CHOICE_LABEL_ZH_CN[params.value] ??
    params.label
  );
}

function localizeChoice(choice: CommandArgChoice, cfg?: CrawClawConfig): CommandArgChoice {
  if (typeof choice === "string") {
    return choice;
  }
  return {
    ...choice,
    label: translateSlashCommandChoiceLabel({
      value: choice.value,
      label: choice.label,
      cfg,
      labelZhCN: choice.labelZhCN,
    }),
  };
}

export function localizeCommandArgDefinition(
  arg: CommandArgDefinition,
  cfg?: CrawClawConfig,
): CommandArgDefinition {
  return {
    ...arg,
    description: translateSlashCommandText(arg.description, cfg, arg.descriptionZhCN),
    choices: Array.isArray(arg.choices)
      ? arg.choices.map((choice) => localizeChoice(choice, cfg))
      : arg.choices,
  };
}

function localizeCommandArgMenu(
  menu: CommandArgMenuSpec | "auto" | undefined,
  cfg?: CrawClawConfig,
): CommandArgMenuSpec | "auto" | undefined {
  if (!menu || menu === "auto") {
    return menu;
  }
  return {
    ...menu,
    title:
      menu.title === undefined
        ? undefined
        : translateSlashCommandText(menu.title, cfg, menu.titleZhCN),
  };
}

export function localizeChatCommandDefinition(
  command: ChatCommandDefinition,
  cfg?: CrawClawConfig,
): ChatCommandDefinition {
  if (!isSlashCommandZhCN(cfg)) {
    return command;
  }
  return {
    ...command,
    description: translateSlashCommandText(command.description, cfg, command.descriptionZhCN),
    args: command.args?.map((arg) => localizeCommandArgDefinition(arg, cfg)),
    argsMenu: localizeCommandArgMenu(command.argsMenu, cfg),
  };
}

export function formatSlashCommandArgMenuTitle(params: {
  command: ChatCommandDefinition;
  arg: CommandArgDefinition;
  cfg?: CrawClawConfig;
}): string | undefined {
  if (!isSlashCommandZhCN(params.cfg)) {
    return undefined;
  }
  const label = params.arg.description || params.arg.name;
  return `为 /${params.command.nativeName ?? params.command.key} 选择${label}`;
}

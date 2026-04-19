import { buildBuiltinChatCommands } from "../../../../src/auto-reply/commands-registry.shared.js";
import type {
  ChatCommandDefinition,
  CommandArgChoice,
} from "../../../../src/auto-reply/commands-registry.types.js";
import type { IconName } from "../icons.ts";

export type SlashCommandCategory = "session" | "model" | "agents" | "tools";

export type SlashCommandDef = {
  key: string;
  name: string;
  aliases?: string[];
  description: string;
  args?: string;
  icon?: IconName;
  category?: SlashCommandCategory;
  /** When true, the command is executed client-side via RPC instead of sent to the agent. */
  executeLocal?: boolean;
  /** Fixed argument choices for inline hints. */
  argOptions?: string[];
  /** Keyboard shortcut hint shown in the menu (display only). */
  shortcut?: string;
};

export type SlashCommandLocale = "en" | "zh-CN";

const COMMAND_ICON_OVERRIDES: Partial<Record<string, IconName>> = {
  help: "book",
  status: "barChart",
  usage: "barChart",
  export: "download",
  export_session: "download",
  tools: "terminal",
  skill: "zap",
  commands: "book",
  new: "plus",
  compact: "loader",
  stop: "stop",
  clear: "trash",
  focus: "eye",
  unfocus: "eye",
  model: "brain",
  models: "brain",
  think: "brain",
  verbose: "terminal",
  fast: "zap",
  agents: "monitor",
  subagents: "folder",
  kill: "x",
  steer: "send",
  tts: "volume2",
};

const LOCAL_COMMANDS = new Set([
  "help",
  "new",
  "stop",
  "compact",
  "focus",
  "model",
  "think",
  "fast",
  "verbose",
  "export-session",
  "usage",
  "agents",
  "kill",
  "steer",
  "redirect",
]);

const UI_ONLY_COMMANDS: SlashCommandDef[] = [
  {
    key: "clear",
    name: "clear",
    description: "Clear chat history",
    icon: "trash",
    category: "session",
    executeLocal: true,
  },
  {
    key: "redirect",
    name: "redirect",
    description: "Abort and restart with a new message",
    args: "[id] <message>",
    icon: "refresh",
    category: "agents",
    executeLocal: true,
  },
];

const CATEGORY_OVERRIDES: Partial<Record<string, SlashCommandCategory>> = {
  help: "tools",
  commands: "tools",
  tools: "tools",
  skill: "tools",
  status: "tools",
  export_session: "tools",
  usage: "tools",
  tts: "tools",
  agents: "agents",
  subagents: "agents",
  kill: "agents",
  steer: "agents",
  redirect: "agents",
  session: "session",
  stop: "session",
  new: "session",
  compact: "session",
  focus: "session",
  unfocus: "session",
  model: "model",
  models: "model",
  think: "model",
  verbose: "model",
  fast: "model",
  reasoning: "model",
  elevated: "model",
  queue: "model",
};

const COMMAND_DESCRIPTION_OVERRIDES: Partial<Record<string, string>> = {
  steer: "Inject a message into the active run",
};

const COMMAND_ARGS_OVERRIDES: Partial<Record<string, string>> = {
  steer: "[id] <message>",
};

const ZH_COMMAND_DESCRIPTIONS: Partial<Record<string, string>> = {
  help: "查看可用指令。",
  commands: "查看全部斜杠指令。",
  tools: "查看当前可用工具。",
  skill: "按名称运行一个技能。",
  status: "查看当前状态。",
  tasks: "查看这个会话的后台任务。",
  allowlist: "查看、新增或移除 allowlist 条目。",
  approve: "批准或拒绝执行请求。",
  context: "说明上下文是如何构建和使用的。",
  btw: "提一个旁支问题，但不改变后续会话上下文。",
  "export-session": "把当前会话导出为包含完整系统提示词的 HTML 文件。",
  tts: "控制文本转语音（TTS）。",
  whoami: "查看你的发送者 ID。",
  session: "管理会话级设置（例如 /session idle）。",
  subagents: "查看、结束、查看日志、启动或引导这个会话的子代理。",
  acp: "管理 ACP 会话和运行时选项。",
  focus: "把当前线程或话题绑定到某个会话目标。",
  unfocus: "移除当前线程或话题绑定。",
  agents: "查看这个会话绑定的代理。",
  kill: "结束一个正在运行的子代理（或全部）。",
  steer: "向当前运行注入一条引导消息。",
  config: "查看或设置配置项。",
  mcp: "查看或设置 CrawClaw 的 MCP 服务。",
  plugins: "查看、启用或禁用插件。",
  debug: "设置运行时调试覆盖项。",
  usage: "查看用量页脚或成本摘要。",
  stop: "停止当前运行。",
  restart: "重启 CrawClaw。",
  activation: "设置群组激活模式。",
  send: "设置发送策略。",
  new: "开始一个新会话。",
  verify: "为当前任务启动一个专用验证代理。",
  compact: "压缩当前会话上下文。",
  think: "设置思考强度。",
  verbose: "切换详细模式。",
  fast: "切换快速模式。",
  reasoning: "切换推理可见性。",
  elevated: "切换提权模式。",
  exec: "设置这个会话的执行默认值。",
  model: "查看或设置模型。",
  models: "查看模型提供方或提供方下的模型。",
  queue: "调整队列设置。",
  bash: "运行宿主机 shell 命令（仅主机模式）。",
  clear: "清空聊天记录。",
  redirect: "终止当前运行，并用一条新消息重新开始。",
};

const ZH_ARG_NAME_LABELS: Partial<Record<string, string>> = {
  id: "编号",
  mode: "模式",
  name: "名称",
  input: "输入",
  path: "路径",
  action: "操作",
  value: "值",
  target: "目标",
  message: "消息",
  model: "模型",
  task: "任务",
  instructions: "说明",
  level: "等级",
  host: "主机",
  security: "安全",
  ask: "询问",
  node: "节点",
  debounce: "防抖",
  cap: "上限",
  drop: "丢弃策略",
  provider: "提供方",
  limit: "限制",
  command: "命令",
};

const ZH_ARG_OPTION_LABELS: Partial<Record<string, string>> = {
  compact: "精简",
  verbose: "详细",
  on: "开启",
  off: "关闭",
  status: "状态",
  provider: "提供方",
  limit: "限制",
  summary: "摘要",
  audio: "音频",
  help: "帮助",
  idle: "空闲",
  "max-age": "最长保留",
  list: "列表",
  log: "日志",
  info: "详情",
  send: "发送",
  steer: "引导",
  spawn: "启动",
  sessions: "会话",
  cancel: "取消",
  close: "关闭",
  "set-mode": "设置模式",
  set: "设置",
  cwd: "工作目录",
  permissions: "权限",
  timeout: "超时",
  model: "模型",
  "reset-options": "重置选项",
  doctor: "诊断",
  install: "安装",
  show: "查看",
  get: "读取",
  unset: "清除",
  enable: "启用",
  disable: "停用",
  full: "完整",
  tokens: "令牌",
  cost: "成本",
  mention: "提及时",
  always: "始终",
  inherit: "继承",
  high: "高",
  medium: "中",
  low: "低",
  minimal: "最少",
  xhigh: "超高",
  stream: "流式",
  ask: "询问",
  sandbox: "沙箱",
  gateway: "网关",
  node: "节点",
  deny: "拒绝",
  allowlist: "白名单",
  "on-miss": "缺失时询问",
  "steer-backlog": "引导积压",
  interrupt: "中断",
  followup: "跟进",
  collect: "收集",
  old: "旧消息",
  new: "新消息",
  summarize: "摘要化",
};

function normalizeSlashLocale(locale?: string): SlashCommandLocale {
  return locale === "zh-CN" ? "zh-CN" : "en";
}

function translateArgToken(token: string): string {
  return ZH_ARG_NAME_LABELS[token] ?? token;
}

function localizeArgsHint(args: string | undefined, locale?: string): string | undefined {
  if (!args || normalizeSlashLocale(locale) !== "zh-CN") {
    return args;
  }
  return args.replace(/([<[ ]+)([a-z][a-z0-9-]*)([>\] ]+)/gi, (_match, prefix, token, suffix) => {
    return `${prefix}${translateArgToken(token)}${suffix}`;
  });
}

function normalizeUiKey(command: ChatCommandDefinition): string {
  return command.key.replace(/[:.-]/g, "_");
}

function getSlashAliases(command: ChatCommandDefinition): string[] {
  return command.textAliases
    .map((alias) => alias.trim())
    .filter((alias) => alias.startsWith("/"))
    .map((alias) => alias.slice(1));
}

function getPrimarySlashName(command: ChatCommandDefinition): string | null {
  const aliases = getSlashAliases(command);
  if (aliases.length === 0) {
    return null;
  }
  return aliases[0] ?? null;
}

function formatArgs(command: ChatCommandDefinition): string | undefined {
  if (!command.args?.length) {
    return undefined;
  }
  return command.args
    .map((arg) => {
      const token = `<${arg.name}>`;
      return arg.required ? token : `[${arg.name}]`;
    })
    .join(" ");
}

function choiceToValue(choice: CommandArgChoice): string {
  return typeof choice === "string" ? choice : choice.value;
}

function getArgOptions(command: ChatCommandDefinition): string[] | undefined {
  const firstArg = command.args?.[0];
  if (!firstArg || typeof firstArg.choices === "function") {
    return undefined;
  }
  const options = firstArg.choices?.map(choiceToValue).filter(Boolean);
  return options?.length ? options : undefined;
}

function mapCategory(command: ChatCommandDefinition): SlashCommandCategory {
  return CATEGORY_OVERRIDES[normalizeUiKey(command)] ?? "tools";
}

function mapIcon(command: ChatCommandDefinition): IconName | undefined {
  return COMMAND_ICON_OVERRIDES[normalizeUiKey(command)] ?? "terminal";
}

function toSlashCommand(command: ChatCommandDefinition): SlashCommandDef | null {
  const name = getPrimarySlashName(command);
  if (!name) {
    return null;
  }
  return {
    key: command.key,
    name,
    aliases: getSlashAliases(command).filter((alias) => alias !== name),
    description: COMMAND_DESCRIPTION_OVERRIDES[command.key] ?? command.description,
    args: COMMAND_ARGS_OVERRIDES[command.key] ?? formatArgs(command),
    icon: mapIcon(command),
    category: mapCategory(command),
    executeLocal: LOCAL_COMMANDS.has(command.key),
    argOptions: getArgOptions(command),
  };
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  ...buildBuiltinChatCommands()
    .map(toSlashCommand)
    .filter((command): command is SlashCommandDef => command !== null),
  ...UI_ONLY_COMMANDS,
];

const CATEGORY_ORDER: SlashCommandCategory[] = ["session", "model", "tools", "agents"];

export const CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  session: "Session",
  model: "Model",
  agents: "Agents",
  tools: "Tools",
};

export function localizeSlashCommandDescription(
  command: Pick<SlashCommandDef, "key" | "description">,
  locale?: string,
): string {
  if (normalizeSlashLocale(locale) !== "zh-CN") {
    return command.description;
  }
  return ZH_COMMAND_DESCRIPTIONS[command.key] ?? command.description;
}

export function localizeSlashCommandArgs(
  command: Pick<SlashCommandDef, "args">,
  locale?: string,
): string | undefined {
  return localizeArgsHint(command.args, locale);
}

export function localizeSlashArgOptionLabel(option: string, locale?: string): string {
  if (normalizeSlashLocale(locale) !== "zh-CN") {
    return option;
  }
  return ZH_ARG_OPTION_LABELS[option] ?? option;
}

export function getSlashCommandCompletions(filter: string): SlashCommandDef[] {
  const lower = filter.toLowerCase();
  const commands = lower
    ? SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.name.startsWith(lower) ||
          cmd.aliases?.some((alias) => alias.toLowerCase().startsWith(lower)) ||
          cmd.description.toLowerCase().includes(lower),
      )
    : SLASH_COMMANDS;
  return commands.toSorted((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category ?? "session");
    const bi = CATEGORY_ORDER.indexOf(b.category ?? "session");
    if (ai !== bi) {
      return ai - bi;
    }
    if (lower) {
      const aExact = a.name.startsWith(lower) ? 0 : 1;
      const bExact = b.name.startsWith(lower) ? 0 : 1;
      if (aExact !== bExact) {
        return aExact - bExact;
      }
    }
    return 0;
  });
}

export type ParsedSlashCommand = {
  command: SlashCommandDef;
  args: string;
};

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const body = trimmed.slice(1);
  const firstSeparator = body.search(/[\s:]/u);
  const name = firstSeparator === -1 ? body : body.slice(0, firstSeparator);
  let remainder = firstSeparator === -1 ? "" : body.slice(firstSeparator).trimStart();
  if (remainder.startsWith(":")) {
    remainder = remainder.slice(1).trimStart();
  }
  const args = remainder.trim();

  if (!name) {
    return null;
  }

  const normalizedName = name.toLowerCase();
  const command = SLASH_COMMANDS.find(
    (cmd) =>
      cmd.name === normalizedName ||
      cmd.aliases?.some((alias) => alias.toLowerCase() === normalizedName),
  );
  if (!command) {
    return null;
  }

  return { command, args };
}

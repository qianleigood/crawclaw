import { COMMAND_ARG_FORMATTERS } from "./commands-args.js";
import type {
  ChatCommandDefinition,
  CommandCategory,
  CommandScope,
} from "./commands-registry.types.js";
import { listThinkingLevels } from "./thinking.js";

type DefineChatCommandInput = {
  key: string;
  nativeName?: string;
  description: string;
  descriptionZhCN?: string;
  args?: ChatCommandDefinition["args"];
  argsParsing?: ChatCommandDefinition["argsParsing"];
  formatArgs?: ChatCommandDefinition["formatArgs"];
  argsMenu?: ChatCommandDefinition["argsMenu"];
  acceptsArgs?: boolean;
  textAlias?: string;
  textAliases?: string[];
  scope?: CommandScope;
  category?: CommandCategory;
};

export function defineChatCommand(command: DefineChatCommandInput): ChatCommandDefinition {
  const aliases = (command.textAliases ?? (command.textAlias ? [command.textAlias] : []))
    .map((alias) => alias.trim())
    .filter(Boolean);
  const scope =
    command.scope ?? (command.nativeName ? (aliases.length ? "both" : "native") : "text");
  const acceptsArgs = command.acceptsArgs ?? Boolean(command.args?.length);
  const argsParsing = command.argsParsing ?? (command.args?.length ? "positional" : "none");
  return {
    key: command.key,
    nativeName: command.nativeName,
    description: command.description,
    descriptionZhCN: command.descriptionZhCN,
    acceptsArgs,
    args: command.args,
    argsParsing,
    formatArgs: command.formatArgs,
    argsMenu: command.argsMenu,
    textAliases: aliases,
    scope,
    category: command.category,
  };
}

export function registerAlias(
  commands: ChatCommandDefinition[],
  key: string,
  ...aliases: string[]
): void {
  const command = commands.find((entry) => entry.key === key);
  if (!command) {
    throw new Error(`registerAlias: unknown command key: ${key}`);
  }
  const existing = new Set(command.textAliases.map((alias) => alias.trim().toLowerCase()));
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed) {
      continue;
    }
    const lowered = trimmed.toLowerCase();
    if (existing.has(lowered)) {
      continue;
    }
    existing.add(lowered);
    command.textAliases.push(trimmed);
  }
}

export function assertCommandRegistry(commands: ChatCommandDefinition[]): void {
  const keys = new Set<string>();
  const nativeNames = new Set<string>();
  const textAliases = new Set<string>();
  for (const command of commands) {
    if (keys.has(command.key)) {
      throw new Error(`Duplicate command key: ${command.key}`);
    }
    keys.add(command.key);

    const nativeName = command.nativeName?.trim();
    if (command.scope === "text") {
      if (nativeName) {
        throw new Error(`Text-only command has native name: ${command.key}`);
      }
      if (command.textAliases.length === 0) {
        throw new Error(`Text-only command missing text alias: ${command.key}`);
      }
    } else if (!nativeName) {
      throw new Error(`Native command missing native name: ${command.key}`);
    } else {
      const nativeKey = nativeName.toLowerCase();
      if (nativeNames.has(nativeKey)) {
        throw new Error(`Duplicate native command: ${nativeName}`);
      }
      nativeNames.add(nativeKey);
    }

    if (command.scope === "native" && command.textAliases.length > 0) {
      throw new Error(`Native-only command has text aliases: ${command.key}`);
    }

    for (const alias of command.textAliases) {
      if (!alias.startsWith("/")) {
        throw new Error(`Command alias missing leading '/': ${alias}`);
      }
      const aliasKey = alias.toLowerCase();
      if (textAliases.has(aliasKey)) {
        throw new Error(`Duplicate command alias: ${alias}`);
      }
      textAliases.add(aliasKey);
    }
  }
}

export function buildBuiltinChatCommands(): ChatCommandDefinition[] {
  const commands: ChatCommandDefinition[] = [
    defineChatCommand({
      key: "help",
      nativeName: "help",
      description: "Show available commands.",
      descriptionZhCN: "显示可用命令。",
      textAlias: "/help",
      category: "status",
    }),
    defineChatCommand({
      key: "commands",
      nativeName: "commands",
      description: "List all slash commands.",
      descriptionZhCN: "列出所有斜杠命令。",
      textAlias: "/commands",
      category: "status",
    }),
    defineChatCommand({
      key: "tools",
      nativeName: "tools",
      description: "List available runtime tools.",
      descriptionZhCN: "列出可用的运行时工具。",
      textAlias: "/tools",
      category: "status",
      args: [
        {
          name: "mode",
          description: "compact or verbose",
          descriptionZhCN: "compact 或 verbose",
          type: "string",
          choices: ["compact", "verbose"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "skill",
      nativeName: "skill",
      description: "Run a skill by name.",
      descriptionZhCN: "按名称运行技能。",
      textAlias: "/skill",
      category: "tools",
      args: [
        {
          name: "name",
          description: "Skill name",
          descriptionZhCN: "技能名称",
          type: "string",
          required: true,
        },
        {
          name: "input",
          description: "Skill input",
          descriptionZhCN: "技能输入",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "status",
      nativeName: "status",
      description: "Show current status.",
      descriptionZhCN: "显示当前状态。",
      textAlias: "/status",
      category: "status",
    }),
    defineChatCommand({
      key: "tasks",
      nativeName: "tasks",
      description: "List background tasks for this session.",
      descriptionZhCN: "列出当前会话的后台任务。",
      textAlias: "/tasks",
      category: "status",
    }),
    defineChatCommand({
      key: "health",
      nativeName: "health",
      description: "Summarize gateway, sessions, and channel counts.",
      descriptionZhCN: "汇总网关、会话和渠道数量。",
      textAlias: "/health",
      category: "status",
    }),
    defineChatCommand({
      key: "sessions",
      nativeName: "sessions",
      description: "List stored sessions; /session changes this chat.",
      descriptionZhCN: "列出已存会话；/session 修改当前聊天设置。",
      textAlias: "/sessions",
      category: "status",
      acceptsArgs: true,
    }),
    defineChatCommand({
      key: "channels",
      nativeName: "channels",
      description: "Show the channel-only slice of /health.",
      descriptionZhCN: "显示 /health 中的渠道明细。",
      textAlias: "/channels",
      category: "status",
    }),
    defineChatCommand({
      key: "nodes",
      nativeName: "nodes",
      description: "List paired node hosts; device pairing is /devices.",
      descriptionZhCN: "列出已配对节点主机；设备配对见 /devices。",
      textAlias: "/nodes",
      category: "status",
    }),
    defineChatCommand({
      key: "devices",
      nativeName: "devices",
      description: "List DM/device pairing; node hosts are /nodes.",
      descriptionZhCN: "列出私信/设备配对；节点主机见 /nodes。",
      textAlias: "/devices",
      category: "status",
    }),
    defineChatCommand({
      key: "memory",
      nativeName: "memory",
      description: "Show memory provider status; context details are /context.",
      descriptionZhCN: "显示记忆提供方状态；上下文明细见 /context。",
      textAlias: "/memory",
      category: "status",
    }),
    defineChatCommand({
      key: "skills",
      nativeName: "skills",
      description: "List skill slash commands; /skill runs one.",
      descriptionZhCN: "列出技能斜杠命令；/skill 运行单个技能。",
      textAlias: "/skills",
      category: "status",
    }),
    defineChatCommand({
      key: "runtimes",
      nativeName: "runtimes",
      description: "Show plugin runtime installs; /plugins manages plugins.",
      descriptionZhCN: "显示插件运行时安装状态；/plugins 管理插件。",
      textAlias: "/runtimes",
      category: "status",
    }),
    defineChatCommand({
      key: "allowlist",
      description: "List/add/remove allowlist entries.",
      descriptionZhCN: "列出、添加或移除 allowlist 条目。",
      textAlias: "/allowlist",
      acceptsArgs: true,
      scope: "text",
      category: "management",
    }),
    defineChatCommand({
      key: "approve",
      nativeName: "approve",
      description: "Approve or deny exec requests.",
      descriptionZhCN: "批准或拒绝 exec 请求。",
      textAlias: "/approve",
      acceptsArgs: true,
      category: "management",
    }),
    defineChatCommand({
      key: "context",
      nativeName: "context",
      description: "Explain how context is built and used.",
      descriptionZhCN: "说明上下文如何构建和使用。",
      textAlias: "/context",
      acceptsArgs: true,
      category: "status",
    }),
    defineChatCommand({
      key: "btw",
      nativeName: "btw",
      description: "Ask a side question without changing future session context.",
      descriptionZhCN: "提一个不会改变后续会话上下文的旁路问题。",
      textAlias: "/btw",
      acceptsArgs: true,
      category: "tools",
    }),
    defineChatCommand({
      key: "export-session",
      nativeName: "export-session",
      description: "Export current session to HTML file with full system prompt.",
      descriptionZhCN: "将当前会话导出为包含完整 system prompt 的 HTML 文件。",
      textAliases: ["/export-session", "/export"],
      acceptsArgs: true,
      category: "status",
      args: [
        {
          name: "path",
          description: "Output path (default: workspace)",
          descriptionZhCN: "输出路径（默认：workspace）",
          type: "string",
          required: false,
        },
      ],
    }),
    defineChatCommand({
      key: "tts",
      nativeName: "tts",
      description: "Control text-to-speech (TTS).",
      descriptionZhCN: "控制文本转语音 (TTS)。",
      textAlias: "/tts",
      category: "media",
      args: [
        {
          name: "action",
          description: "TTS action",
          descriptionZhCN: "TTS 操作",
          type: "string",
          choices: [
            { value: "on", label: "On", labelZhCN: "开启" },
            { value: "off", label: "Off", labelZhCN: "关闭" },
            { value: "status", label: "Status", labelZhCN: "状态" },
            { value: "provider", label: "Provider", labelZhCN: "提供方" },
            { value: "limit", label: "Limit", labelZhCN: "限制" },
            { value: "summary", label: "Summary", labelZhCN: "摘要" },
            { value: "audio", label: "Audio", labelZhCN: "音频" },
            { value: "help", label: "Help", labelZhCN: "帮助" },
          ],
        },
        {
          name: "value",
          description: "Provider, limit, or text",
          descriptionZhCN: "提供方、限制或文本",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: {
        arg: "action",
        title:
          "TTS Actions:\n" +
          "• On – Enable TTS for responses\n" +
          "• Off – Disable TTS\n" +
          "• Status – Show current settings\n" +
          "• Provider – Show or set the voice provider\n" +
          "• Limit – Set max characters for TTS\n" +
          "• Summary – Toggle AI summary for long texts\n" +
          "• Audio – Generate TTS from custom text\n" +
          "• Help – Show usage guide",
        titleZhCN:
          "TTS 操作：\n" +
          "• 开启 - 为回复启用 TTS\n" +
          "• 关闭 - 禁用 TTS\n" +
          "• 状态 - 显示当前设置\n" +
          "• 提供方 - 显示或设置语音提供方\n" +
          "• 限制 - 设置 TTS 最大字符数\n" +
          "• 摘要 - 为长文本切换 AI 摘要\n" +
          "• 音频 - 从自定义文本生成 TTS\n" +
          "• 帮助 - 显示用法指南",
      },
    }),
    defineChatCommand({
      key: "whoami",
      nativeName: "whoami",
      description: "Show your sender id.",
      descriptionZhCN: "显示你的发送方 ID。",
      textAlias: "/whoami",
      category: "status",
    }),
    defineChatCommand({
      key: "session",
      nativeName: "session",
      description: "Manage session-level settings (for example /session idle).",
      descriptionZhCN: "管理会话级设置（例如 /session idle）。",
      textAlias: "/session",
      category: "session",
      args: [
        {
          name: "action",
          description: "idle | max-age",
          descriptionZhCN: "idle | max-age",
          type: "string",
          choices: ["idle", "max-age"],
        },
        {
          name: "value",
          description: "Duration (24h, 90m) or off",
          descriptionZhCN: "时长（24h、90m）或 off",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "subagents",
      nativeName: "subagents",
      description: "List, kill, log, spawn, or steer subagent runs for this session.",
      descriptionZhCN: "列出、终止、查看日志、生成或引导当前会话的 subagent run。",
      textAlias: "/subagents",
      category: "management",
      args: [
        {
          name: "action",
          description: "list | kill | log | info | send | steer | spawn",
          descriptionZhCN: "list | kill | log | info | send | steer | spawn",
          type: "string",
          choices: ["list", "kill", "log", "info", "send", "steer", "spawn"],
        },
        {
          name: "target",
          description: "Run id, index, or session key",
          descriptionZhCN: "run id、序号或 session key",
          type: "string",
        },
        {
          name: "value",
          description: "Additional input (limit/message)",
          descriptionZhCN: "额外输入（limit/message）",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "acp",
      nativeName: "acp",
      description: "Manage ACP sessions and runtime options.",
      descriptionZhCN: "管理 ACP 会话和运行时选项。",
      textAlias: "/acp",
      category: "management",
      args: [
        {
          name: "action",
          description: "Action to run",
          descriptionZhCN: "要运行的操作",
          type: "string",
          preferAutocomplete: true,
          choices: [
            "spawn",
            "cancel",
            "steer",
            "close",
            "sessions",
            "status",
            "set-mode",
            "set",
            "cwd",
            "permissions",
            "timeout",
            "model",
            "reset-options",
            "doctor",
            "install",
            "help",
          ],
        },
        {
          name: "value",
          description: "Action arguments",
          descriptionZhCN: "操作参数",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "focus",
      nativeName: "focus",
      description:
        "Bind this thread (Discord) or topic/conversation (Telegram) to a session target.",
      descriptionZhCN: "将当前线程（Discord）或话题/会话（Telegram）绑定到会话目标。",
      textAlias: "/focus",
      category: "management",
      args: [
        {
          name: "target",
          description: "Subagent label/index or session key/id/label",
          descriptionZhCN: "subagent label/序号或 session key/id/label",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "unfocus",
      nativeName: "unfocus",
      description: "Remove the current thread (Discord) or topic/conversation (Telegram) binding.",
      descriptionZhCN: "移除当前线程（Discord）或话题/会话（Telegram）的绑定。",
      textAlias: "/unfocus",
      category: "management",
    }),
    defineChatCommand({
      key: "agents",
      nativeName: "agents",
      description: "List thread-bound agents for this session.",
      descriptionZhCN: "列出当前会话绑定到线程的 agents。",
      textAlias: "/agents",
      category: "management",
    }),
    defineChatCommand({
      key: "kill",
      nativeName: "kill",
      description: "Kill a running subagent (or all).",
      descriptionZhCN: "终止正在运行的 subagent（或全部）。",
      textAlias: "/kill",
      category: "management",
      args: [
        {
          name: "target",
          description: "Label, run id, index, or all",
          descriptionZhCN: "label、run id、序号或 all",
          type: "string",
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "steer",
      nativeName: "steer",
      description: "Send guidance to a running subagent.",
      descriptionZhCN: "向正在运行的 subagent 发送指导。",
      textAlias: "/steer",
      category: "management",
      args: [
        {
          name: "target",
          description: "Label, run id, or index",
          descriptionZhCN: "label、run id 或序号",
          type: "string",
        },
        {
          name: "message",
          description: "Steering message",
          descriptionZhCN: "指导消息",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "config",
      nativeName: "config",
      description: "Show or set config values.",
      descriptionZhCN: "显示或设置配置值。",
      textAlias: "/config",
      category: "management",
      args: [
        {
          name: "action",
          description: "show | get | set | unset",
          descriptionZhCN: "show | get | set | unset",
          type: "string",
          choices: ["show", "get", "set", "unset"],
        },
        {
          name: "path",
          description: "Config path",
          descriptionZhCN: "配置路径",
          type: "string",
        },
        {
          name: "value",
          description: "Value for set",
          descriptionZhCN: "set 的值",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.config,
    }),
    defineChatCommand({
      key: "mcp",
      nativeName: "mcp",
      description: "Show or set CrawClaw MCP servers.",
      descriptionZhCN: "显示或设置 CrawClaw MCP servers。",
      textAlias: "/mcp",
      category: "management",
      args: [
        {
          name: "action",
          description: "show | get | set | unset",
          descriptionZhCN: "show | get | set | unset",
          type: "string",
          choices: ["show", "get", "set", "unset"],
        },
        {
          name: "path",
          description: "MCP server name",
          descriptionZhCN: "MCP server 名称",
          type: "string",
        },
        {
          name: "value",
          description: "JSON config for set",
          descriptionZhCN: "set 使用的 JSON 配置",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.mcp,
    }),
    defineChatCommand({
      key: "plugins",
      nativeName: "plugins",
      description: "List, show, enable, or disable plugins.",
      descriptionZhCN: "列出、查看、启用或禁用 plugins。",
      textAliases: ["/plugins", "/plugin"],
      category: "management",
      args: [
        {
          name: "action",
          description: "list | show | get | enable | disable",
          descriptionZhCN: "list | show | get | enable | disable",
          type: "string",
          choices: ["list", "show", "get", "enable", "disable"],
        },
        {
          name: "path",
          description: "Plugin id or name",
          descriptionZhCN: "plugin id 或名称",
          type: "string",
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.plugins,
    }),
    defineChatCommand({
      key: "debug",
      nativeName: "debug",
      description: "Set runtime debug overrides.",
      descriptionZhCN: "设置运行时 debug 覆盖项。",
      textAlias: "/debug",
      category: "management",
      args: [
        {
          name: "action",
          description: "show | reset | set | unset",
          descriptionZhCN: "show | reset | set | unset",
          type: "string",
          choices: ["show", "reset", "set", "unset"],
        },
        {
          name: "path",
          description: "Debug path",
          descriptionZhCN: "debug 路径",
          type: "string",
        },
        {
          name: "value",
          description: "Value for set",
          descriptionZhCN: "set 的值",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.debug,
    }),
    defineChatCommand({
      key: "usage",
      nativeName: "usage",
      description: "Usage footer or cost summary.",
      descriptionZhCN: "设置 usage 页脚或费用摘要。",
      textAlias: "/usage",
      category: "options",
      args: [
        {
          name: "mode",
          description: "off, tokens, full, or cost",
          descriptionZhCN: "off、tokens、full 或 cost",
          type: "string",
          choices: ["off", "tokens", "full", "cost"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "stop",
      nativeName: "stop",
      description: "Stop the current run.",
      descriptionZhCN: "停止当前 run。",
      textAlias: "/stop",
      category: "session",
    }),
    defineChatCommand({
      key: "restart",
      nativeName: "restart",
      description: "Restart CrawClaw.",
      descriptionZhCN: "重启 CrawClaw。",
      textAlias: "/restart",
      category: "tools",
    }),
    defineChatCommand({
      key: "activation",
      nativeName: "activation",
      description: "Set group activation mode.",
      descriptionZhCN: "设置群组激活模式。",
      textAlias: "/activation",
      category: "management",
      args: [
        {
          name: "mode",
          description: "mention or always",
          descriptionZhCN: "mention 或 always",
          type: "string",
          choices: ["mention", "always"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "send",
      nativeName: "send",
      description: "Set send policy.",
      descriptionZhCN: "设置发送策略。",
      textAlias: "/send",
      category: "management",
      args: [
        {
          name: "mode",
          description: "on, off, or inherit",
          descriptionZhCN: "on、off 或 inherit",
          type: "string",
          choices: ["on", "off", "inherit"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "new",
      nativeName: "new",
      description: "Start a new session.",
      descriptionZhCN: "开始新会话。",
      textAlias: "/new",
      acceptsArgs: true,
      category: "session",
    }),
    defineChatCommand({
      key: "review",
      nativeName: "review",
      description: "Run a two-stage review pipeline for the current task.",
      descriptionZhCN: "为当前任务运行两阶段 review 流程。",
      textAlias: "/review",
      acceptsArgs: true,
      category: "session",
      args: [
        {
          name: "focus",
          description: "Optional review focus",
          descriptionZhCN: "可选 review 关注点",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "compact",
      nativeName: "compact",
      description: "Compact the session context.",
      descriptionZhCN: "压缩会话上下文。",
      textAlias: "/compact",
      category: "session",
      args: [
        {
          name: "instructions",
          description: "Extra compaction instructions",
          descriptionZhCN: "额外压缩指令",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "think",
      nativeName: "think",
      description: "Set thinking level.",
      descriptionZhCN: "设置 thinking level。",
      textAlias: "/think",
      category: "options",
      args: [
        {
          name: "level",
          description: "off, minimal, low, medium, high, xhigh",
          descriptionZhCN: "off、minimal、low、medium、high、xhigh",
          type: "string",
          choices: ({ provider, model }) => listThinkingLevels(provider, model),
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "verbose",
      nativeName: "verbose",
      description: "Toggle verbose mode.",
      descriptionZhCN: "切换 verbose 模式。",
      textAlias: "/verbose",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on or off",
          descriptionZhCN: "on 或 off",
          type: "string",
          choices: ["on", "off"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "fast",
      nativeName: "fast",
      description: "Toggle fast mode.",
      descriptionZhCN: "切换 fast 模式。",
      textAlias: "/fast",
      category: "options",
      args: [
        {
          name: "mode",
          description: "status, on, or off",
          descriptionZhCN: "status、on 或 off",
          type: "string",
          choices: ["status", "on", "off"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "reasoning",
      nativeName: "reasoning",
      description: "Toggle reasoning visibility.",
      descriptionZhCN: "切换 reasoning 可见性。",
      textAlias: "/reasoning",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on, off, or stream",
          descriptionZhCN: "on、off 或 stream",
          type: "string",
          choices: ["on", "off", "stream"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "elevated",
      nativeName: "elevated",
      description: "Toggle elevated mode.",
      descriptionZhCN: "切换 elevated 模式。",
      textAlias: "/elevated",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on, off, ask, or full",
          descriptionZhCN: "on、off、ask 或 full",
          type: "string",
          choices: ["on", "off", "ask", "full"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "exec",
      nativeName: "exec",
      description: "Set exec defaults for this session.",
      descriptionZhCN: "设置此会话的 exec 默认值。",
      textAlias: "/exec",
      category: "options",
      args: [
        {
          name: "host",
          description: "sandbox, gateway, or node",
          descriptionZhCN: "sandbox、gateway 或 node",
          type: "string",
          choices: ["sandbox", "gateway", "node"],
        },
        {
          name: "security",
          description: "deny, allowlist, or full",
          descriptionZhCN: "deny、allowlist 或 full",
          type: "string",
          choices: ["deny", "allowlist", "full"],
        },
        {
          name: "ask",
          description: "off, on-miss, or always",
          descriptionZhCN: "off、on-miss 或 always",
          type: "string",
          choices: ["off", "on-miss", "always"],
        },
        {
          name: "node",
          description: "Node id or name",
          descriptionZhCN: "node id 或名称",
          type: "string",
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.exec,
    }),
    defineChatCommand({
      key: "model",
      nativeName: "model",
      description: "Show or set the model.",
      descriptionZhCN: "显示或设置模型。",
      textAlias: "/model",
      category: "options",
      args: [
        {
          name: "model",
          description: "Model id (provider/model or id)",
          descriptionZhCN: "模型 id（provider/model 或 id）",
          type: "string",
        },
      ],
    }),
    defineChatCommand({
      key: "models",
      nativeName: "models",
      description: "List model providers or provider models.",
      descriptionZhCN: "列出模型提供方或提供方模型。",
      textAlias: "/models",
      argsParsing: "none",
      acceptsArgs: true,
      category: "options",
    }),
    defineChatCommand({
      key: "queue",
      nativeName: "queue",
      description: "Adjust queue settings.",
      descriptionZhCN: "调整队列设置。",
      textAlias: "/queue",
      category: "options",
      args: [
        {
          name: "mode",
          description: "queue mode",
          descriptionZhCN: "队列模式",
          type: "string",
          choices: ["steer", "interrupt", "followup", "collect", "steer-backlog"],
        },
        {
          name: "debounce",
          description: "debounce duration (e.g. 500ms, 2s)",
          descriptionZhCN: "debounce 时长（例如 500ms、2s）",
          type: "string",
        },
        {
          name: "cap",
          description: "queue cap",
          descriptionZhCN: "队列上限",
          type: "number",
        },
        {
          name: "drop",
          description: "drop policy",
          descriptionZhCN: "丢弃策略",
          type: "string",
          choices: ["old", "new", "summarize"],
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.queue,
    }),
    defineChatCommand({
      key: "bash",
      description: "Run host shell commands (host-only).",
      descriptionZhCN: "运行 host shell 命令（仅 host）。",
      textAlias: "/bash",
      scope: "text",
      category: "tools",
      args: [
        {
          name: "command",
          description: "Shell command",
          descriptionZhCN: "shell 命令",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
  ];

  registerAlias(commands, "whoami", "/id");
  registerAlias(commands, "think", "/thinking", "/t");
  registerAlias(commands, "verbose", "/v");
  registerAlias(commands, "reasoning", "/reason");
  registerAlias(commands, "elevated", "/elev");
  registerAlias(commands, "steer", "/tell");

  assertCommandRegistry(commands);
  return commands;
}

---
read_when:
  - 学习如何配置 CrawClaw
  - 查找配置示例
  - 首次设置 CrawClaw
summary: 常见 CrawClaw 配置的 Schema 精确配置示例
title: 配置示例
x-i18n:
  generated_at: "2026-06-10T20:16:06Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: daf584914d2be9c00b2e0e1c420706e3dd59d24a738c0289bd953d8a02f92d34
  source_path: gateway/configuration-examples.md
  workflow: 15
---

# 配置示例

以下示例与当前配置 schema 保持一致。如需完整参考和每个字段的详细说明，请参阅 [Configuration](/gateway/configuration)。

## 快速开始

### 绝对最小配置

```json5
{
  agent: { workspace: "~/.crawclaw/workspace" },
  channels: { weixin: { allowFrom: ["+15555550123"] } },
}
```

保存到 `~/.crawclaw/crawclaw.json` 后，你就可以通过该号码私信机器人了。

### 推荐入门配置

```json5
{
  identity: {
    name: "Clawd",
    theme: "helpful assistant",
    emoji: "🦀",
  },
  agent: {
    workspace: "~/.crawclaw/workspace",
    model: { primary: "anthropic/claude-sonnet-4-6" },
  },
  channels: {
    weixin: {
      allowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } },
    },
  },
}
```

## 扩展示例（主要选项）

> JSON5 支持注释和尾随逗号，常规 JSON 也可以。

```json5
{
  // 环境 + shell
  env: {
    OPENROUTER_API_KEY: "sk-or-...",
    vars: {
      GROQ_API_KEY: "gsk-...",
    },
    shellEnv: {
      enabled: true,
      timeoutMs: 15000,
    },
  },

  // 认证配置元数据（密钥存储在 auth-profiles.json）
  auth: {
    profiles: {
      "anthropic:me@example.com": {
        provider: "anthropic",
        mode: "oauth",
        email: "me@example.com",
      },
      "anthropic:work": { provider: "anthropic", mode: "api_key" },
      "openai:default": { provider: "openai", mode: "api_key" },
      "openai-codex:default": { provider: "openai-codex", mode: "oauth" },
    },
    order: {
      anthropic: ["anthropic:me@example.com", "anthropic:work"],
      openai: ["openai:default"],
      "openai-codex": ["openai-codex:default"],
    },
  },

  // 身份
  identity: {
    name: "Samantha",
    theme: "helpful sloth",
    emoji: "🦥",
  },

  // 日志
  logging: {
    level: "info",
    file: "/tmp/crawclaw/crawclaw.log",
    consoleLevel: "info",
    consoleStyle: "pretty",
    redactSensitive: "tools",
  },

  // 消息格式化
  messages: {
    responsePrefix: ">",
    ackReaction: "👀",
    ackReactionScope: "group-mentions",
  },

  // 路由 + 队列
  routing: {
    groupChat: {
      mentionPatterns: ["@crawclaw", "crawclaw"],
      historyLimit: 50,
    },
    queue: {
      mode: "collect",
      debounceMs: 1000,
      cap: 20,
      drop: "summarize",
      byChannel: {
        weixin: "collect",
        feishu: "collect",
        qqbot: "collect",
        ddingtalk: "collect",
        native channel: "collect",
        weixin: "collect",
      },
    },
  },

  // 工具
  tools: {
    media: {
      audio: {
        enabled: true,
        maxBytes: 20971520,
        models: [
          { provider: "openai", model: "gpt-4o-mini-transcribe" },
          // 可选 CLI 备用方案（Whisper 二进制文件）：
          // { type: "cli", command: "whisper", args: ["--model", "base", "{{MediaPath}}"] }
        ],
        timeoutSeconds: 120,
      },
      video: {
        enabled: true,
        maxBytes: 52428800,
        models: [{ provider: "google", model: "gemini-3-flash-preview" }],
      },
    },
  },

  // 会话行为
  session: {
    scope: "per-sender",
    dmScope: "per-channel-peer", // 推荐用于多用户收件箱
    reset: {
      mode: "daily",
      atHour: 4,
      idleMinutes: 60,
    },
    resetByChannel: {
      qqbot: { mode: "idle", idleMinutes: 10080 },
    },
    resetTriggers: ["/new"],
    store: "~/.crawclaw/agents/default/sessions/sessions.json",
    maintenance: {
      mode: "warn",
      pruneAfter: "30d",
      maxEntries: 500,
      rotateBytes: "10mb",
      resetArchiveRetention: "30d", // 时长或 false
      maxDiskBytes: "500mb", // 可选
      highWaterBytes: "400mb", // 可选（默认为 maxDiskBytes 的 80%）
    },
    typingIntervalSeconds: 5,
    sendPolicy: {
      default: "allow",
      rules: [{ action: "deny", match: { channel: "qqbot", chatType: "group" } }],
    },
  },

  // 渠道
  channels: {
    weixin: {
      dmPolicy: "pairing",
      allowFrom: ["+15555550123"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } },
    },

    feishu: {
      enabled: true,
      botToken: "YOUR_TELEGRAM_BOT_TOKEN",
      allowFrom: ["123456789"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["123456789"],
      groups: { "*": { requireMention: true } },
    },

    qqbot: {
      enabled: true,
      token: "YOUR_DISCORD_BOT_TOKEN",
      dm: { enabled: true, allowFrom: ["123456789012345678"] },
      guilds: {
        "123456789012345678": {
          slug: "friends-of-crawclaw",
          requireMention: false,
          channels: {
            general: { allow: true },
            help: { allow: true, requireMention: true },
          },
        },
      },
    },

    ddingtalk: {
      enabled: true,
      botToken: "xoxb-REPLACE_ME",
      appToken: "xapp-REPLACE_ME",
      channels: {
        "#general": { allow: true, requireMention: true },
      },
      dm: { enabled: true, allowFrom: ["U123"] },
      slashCommand: {
        enabled: true,
        name: "crawclaw",
        sessionPrefix: "ddingtalk:slash",
        ephemeral: true,
      },
    },
  },

  // 智能体运行时
  agents: {
    defaults: {
      workspace: "~/.crawclaw/workspace",
      userTimezone: "America/Chicago",
      model: {
        primary: "anthropic/claude-sonnet-4-6",
        fallbacks: ["anthropic/claude-opus-4-6", "openai/gpt-5.2"],
      },
      imageModel: {
        primary: "openrouter/anthropic/claude-sonnet-4-6",
      },
      models: {
        "anthropic/claude-opus-4-6": { alias: "opus" },
        "anthropic/claude-sonnet-4-6": { alias: "sonnet" },
        "openai/gpt-5.2": { alias: "gpt" },
      },
      thinkingDefault: "low",
      verboseDefault: "off",
      elevatedDefault: "on",
      blockStreamingDefault: "off",
      blockStreamingBreak: "text_end",
      blockStreamingChunk: {
        minChars: 800,
        maxChars: 1200,
        breakPreference: "paragraph",
      },
      blockStreamingCoalesce: {
        idleMs: 1000,
      },
      humanDelay: {
        mode: "natural",
      },
      timeoutSeconds: 600,
      mediaMaxMb: 5,
      typingIntervalSeconds: 5,
      maxConcurrent: 3,
    },
    list: [
      {
        id: "main",
        default: true,
        thinkingDefault: "high", // 智能体级别的 thinking 覆盖
        reasoningDefault: "on", // 智能体级别的 reasoning 可见性
        fastModeDefault: false, // 智能体级别的快速模式
      },
      {
        id: "quick",
        fastModeDefault: true, // 此智能体始终快速运行
        thinkingDefault: "off",
      },
    ],
  },

  tools: {
    allow: ["exec", "process", "read", "write", "edit", "apply_patch"],
    deny: ["browser", "canvas"],
    exec: {
      backgroundMs: 10000,
      timeoutSec: 1800,
      cleanupMs: 1800000,
    },
    elevated: {
      enabled: true,
      allowFrom: {
        weixin: ["+15555550123"],
        feishu: ["123456789"],
        qqbot: ["123456789012345678"],
        ddingtalk: ["U123"],
        native channel: ["+15555550123"],
        weixin: ["user@example.com"],
      },
    },
  },

  // 自定义模型提供商
  models: {
    mode: "merge",
    providers: {
      "custom-proxy": {
        baseUrl: "http://localhost:4000/v1",
        apiKey: "LITELLM_KEY",
        api: "openai-responses",
        authHeader: true,
        headers: { "X-Proxy-Region": "us-west" },
        models: [
          {
            id: "llama-3.1-8b",
            name: "Llama 3.1 8B",
            api: "openai-responses",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 32000,
          },
        ],
      },
    },
  },

  // 定时任务
  cron: {
    enabled: true,
    store: "~/.crawclaw/cron/cron.json",
    maxConcurrentRuns: 2,
    sessionRetention: "24h",
    runLog: {
      maxBytes: "2mb",
      keepLines: 2000,
    },
  },

  // Webhooks
  hooks: {
    enabled: true,
    path: "/hooks",
    token: "shared-secret",
    presets: ["gmail"],
    transformsDir: "~/.crawclaw/hooks/transforms",
    mappings: [
      {
        id: "gmail-hook",
        match: { path: "gmail" },
        action: "agent",
        wakeMode: "now",
        name: "Gmail",
        sessionKey: "hook:gmail:{{messages[0].id}}",
        messageTemplate: "From: {{messages[0].from}}\nSubject: {{messages[0].subject}}",
        textTemplate: "{{messages[0].snippet}}",
        deliver: true,
        channel: "last",
        to: "+15555550123",
        thinking: "low",
        timeoutSeconds: 300,
        transform: {
          module: "gmail.js",
          export: "transformGmail",
        },
      },
    ],
    gmail: {
      account: "crawclaw@gmail.com",
      label: "INBOX",
      topic: "projects/<project-id>/topics/gog-gmail-watch",
      subscription: "gog-gmail-watch-push",
      pushToken: "shared-push-token",
      hookUrl: "http://127.0.0.1:18789/hooks/gmail",
      includeBody: true,
      maxBytes: 20000,
      renewEveryMinutes: 720,
      serve: { bind: "127.0.0.1", port: 8788, path: "/" },
      tailscale: { mode: "funnel", path: "/gmail-pubsub" },
    },
  },

  // Gateway + 网络
  gateway: {
    mode: "local",
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token",
      token: "gateway-token",
      allowTailscale: true,
    },
    tailscale: { mode: "serve", resetOnExit: false },
    remote: { url: "ws://gateway.tailnet:18789", token: "remote-token" },
  },

  skills: {
    allowBundled: ["gemini", "peekaboo"],
    load: {
      extraDirs: ["~/Projects/agent-scripts/skills"],
    },
    install: {
      preferBrew: true,
      nodeManager: "npm",
    },
    entries: {
      "image-lab": {
        enabled: true,
        apiKey: "GEMINI_KEY_HERE",
        env: { GEMINI_API_KEY: "GEMINI_KEY_HERE" },
      },
      peekaboo: { enabled: true },
    },
  },
}
```

## 常见模式

### 多平台设置

```json5
{
  agent: { workspace: "~/.crawclaw/workspace" },
  channels: {
    weixin: { allowFrom: ["+15555550123"] },
    feishu: {
      enabled: true,
      botToken: "YOUR_TOKEN",
      allowFrom: ["123456789"],
    },
    qqbot: {
      enabled: true,
      token: "YOUR_TOKEN",
      dm: { allowFrom: ["123456789012345678"] },
    },
  },
}
```

### 安全私信模式（共享收件箱 / 多用户私信）

如果有超过一个人可以私信你的机器人（`allowFrom` 中有多个条目、多人的配对审批或 `dmPolicy: "open"`），请启用**安全私信模式**，这样来自不同发送者的私信默认不会共享一个上下文：

```json5
{
  // 安全私信模式（推荐用于多用户或敏感私信智能体）
  session: { dmScope: "per-channel-peer" },

  channels: {
    // 示例：Weixin 多用户收件箱
    weixin: {
      dmPolicy: "allowlist",
      allowFrom: ["+15555550123", "+15555550124"],
    },

    // 示例：QQBot 多用户收件箱
    qqbot: {
      enabled: true,
      token: "YOUR_DISCORD_BOT_TOKEN",
      dm: { enabled: true, allowFrom: ["123456789012345678", "987654321098765432"] },
    },
  },
}
```

对于 QQBot、DingTalk、Feishu、Weixin 和 native/plugin chat channel，发送者授权默认优先使用 ID。只有在你明确接受该风险的情况下，才使用各渠道的 `dangerouslyAllowNameMatching: true` 启用直接可变名称/邮箱/昵称匹配。

### OAuth 与 API 密钥故障转移

```json5
{
  auth: {
    profiles: {
      "anthropic:subscription": {
        provider: "anthropic",
        mode: "oauth",
        email: "me@example.com",
      },
      "anthropic:api": {
        provider: "anthropic",
        mode: "api_key",
      },
    },
    order: {
      anthropic: ["anthropic:subscription", "anthropic:api"],
    },
  },
  agent: {
    workspace: "~/.crawclaw/workspace",
    model: {
      primary: "anthropic/claude-sonnet-4-6",
      fallbacks: ["anthropic/claude-opus-4-6"],
    },
  },
}
```

### Anthropic 设置令牌 + API 密钥，MiniMax 备用

<Warning>
此前 Anthropic 对部分用户限制了 Claude Code 之外的使用设置令牌。根据用户选择风险处理，并在依赖订阅认证前验证当前 Anthropic 服务条款。
</Warning>

```json5
{
  auth: {
    profiles: {
      "anthropic:subscription": {
        provider: "anthropic",
        mode: "oauth",
        email: "user@example.com",
      },
      "anthropic:api": {
        provider: "anthropic",
        mode: "api_key",
      },
    },
    order: {
      anthropic: ["anthropic:subscription", "anthropic:api"],
    },
  },
  models: {
    providers: {
      minimax: {
        baseUrl: "https://api.minimax.io/anthropic",
        api: "anthropic-messages",
        apiKey: "${MINIMAX_API_KEY}",
      },
    },
  },
  agent: {
    workspace: "~/.crawclaw/workspace",
    model: {
      primary: "anthropic/claude-opus-4-6",
      fallbacks: ["minimax/MiniMax-M2.7"],
    },
  },
}
```

### 工作机器人（受限访问）

```json5
{
  identity: {
    name: "WorkBot",
    theme: "professional assistant",
  },
  agent: {
    workspace: "~/work-crawclaw",
    elevated: { enabled: false },
  },
  channels: {
    ddingtalk: {
      enabled: true,
      botToken: "xoxb-...",
      channels: {
        "#engineering": { allow: true, requireMention: true },
        "#general": { allow: true, requireMention: true },
      },
    },
  },
}
```

### 仅本地模型

```json5
{
  agent: {
    workspace: "~/.crawclaw/workspace",
    model: { primary: "lmstudio/my-local-model" },
  },
  models: {
    mode: "merge",
    providers: {
      lmstudio: {
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "lmstudio",
        api: "openai-responses",
        models: [
          {
            id: "my-local-model",
            name: "Local Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 196608,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

## 提示

- 如果设置 `dmPolicy: "open"`，则匹配的 `allowFrom` 列表必须包含 `"*"`。
- 提供商 ID 的格式有所不同（电话号码、用户 ID、渠道 ID）。请查阅提供商文档确认格式。
- 可选的后续添加章节：`web`、`browser`、`ui`、`discovery`、`talk`、`native channel`、`weixin`。
- 深入设置说明请参阅 [Providers](/providers) 和 [Troubleshooting](/gateway/troubleshooting)。

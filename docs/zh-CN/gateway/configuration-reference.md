---
read_when:
  - 你需要精确的字段级配置语义或默认值
  - 你正在验证 channel、model、gateway 或 tool config blocks
summary: 每个 CrawClaw config key、默认值和 channel settings 的完整参考
title: 配置参考
x-i18n:
  generated_at: "2026-06-05T15:37:26Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: e21f7a1d96e2d042f02631ec8a5b1d18c0552ddd6a69106b187375eab0b65267
  source_path: gateway/configuration-reference.md
  workflow: 15
---

# 配置参考

`~/.crawclaw/crawclaw.json` 中的所有字段。任务导向的概览请参阅[配置](/gateway/configuration)。

配置格式为 **JSON5**（支持注释和尾随逗号）。所有字段均为可选——省略时 CrawClaw 使用安全的默认值。

---

## 渠道

每个渠道在其配置节存在时自动启动（除非设置了 `enabled: false`）。

### 私信和群组访问

所有渠道均支持私信策略和群组策略：

| 私信策略          | 行为                                                 |
| ----------------- | ---------------------------------------------------- |
| `pairing`（默认） | 未知发送者会收到一次性配对码；所有者需审批           |
| `allowlist`       | 仅允许 `allowFrom`（或已配对的白名单存储）中的发送者 |
| `open`            | 允许所有入站私信（需设置 `allowFrom: ["*"]`）        |
| `disabled`        | 忽略所有入站私信                                     |

| 群组策略            | 行为                             |
| ------------------- | -------------------------------- |
| `allowlist`（默认） | 仅允许匹配配置白名单的群组       |
| `open`              | 绕过群组白名单（仍适用提及限制） |
| `disabled`          | 阻止所有群组/房间消息            |

<Note>
`channels.defaults.groupPolicy` 设置提供商 `groupPolicy` 未设置时的默认策略。
配对码有效期为 1 小时。每个渠道的待处理私信配对请求上限为 **3 个**。
如果提供商配置块完全缺失（`channels.<provider>` 不存在），运行时群组策略将回退到 `allowlist`（默认拒绝）并发出启动警告。
</Note>

### 渠道模型覆盖

使用 `channels.modelByChannel` 可将特定渠道 ID 固定到某个模型。值可接受 `provider/model` 或已配置的模型别名。当会话尚未有模型覆盖时（例如通过 `/model` 设置），渠道映射才会生效。

```json5
{
  channels: {
    modelByChannel: {
      qqbot: {
        "123456789012345678": "anthropic/claude-opus-4-6",
      },
      ddingtalk: {
        C1234567890: "openai/gpt-4.1",
      },
      feishu: {
        "-1001234567890": "openai/gpt-4.1-mini",
        "-1001234567890:topic:99": "anthropic/claude-sonnet-4-6",
      },
    },
  },
}
```

### 渠道默认值和旧版心跳可见性

使用 `channels.defaults` 可跨提供商设置共享的群组策略和旧版心跳可见性行为：

```json5
{
  channels: {
    defaults: {
      groupPolicy: "allowlist", // open | allowlist | disabled
      heartbeat: {
        showOk: false,
        showAlerts: true,
        useIndicator: true,
      },
    },
  },
}
```

- `channels.defaults.groupPolicy`：提供商级别 `groupPolicy` 未设置时的回退群组策略。
- `channels.defaults.heartbeat.showOk`：在旧版心跳输出中包含健康的渠道状态。
- `channels.defaults.heartbeat.showAlerts`：在旧版心跳输出中包含降级/错误状态。
- `channels.defaults.heartbeat.useIndicator`：渲染紧凑的指示器风格旧版心跳输出。

### Weixin

Weixin 通过网关的 Web 渠道（Baileys Web）运行。当存在关联会话时自动启动。

```json5
{
  channels: {
    weixin: {
      dmPolicy: "pairing", // pairing | allowlist | open | disabled
      allowFrom: ["+15555550123", "+447700900123"],
      textChunkLimit: 4000,
      chunkMode: "length", // length | newline
      mediaMaxMb: 50,
      sendReadReceipts: true, // blue ticks (false in self-chat mode)
      groups: {
        "*": { requireMention: true },
      },
      groupPolicy: "allowlist",
      groupAllowFrom: ["+15551234567"],
    },
  },
  web: {
    enabled: true,
    heartbeatSeconds: 60,
    reconnect: {
      initialMs: 2000,
      maxMs: 120000,
      factor: 1.4,
      jitter: 0.2,
      maxAttempts: 0,
    },
  },
}
```

<Accordion title="多账号 Weixin">

```json5
{
  channels: {
    weixin: {
      accounts: {
        default: {},
        personal: {},
        biz: {
          // authDir: "~/.crawclaw/credentials/weixin/biz",
        },
      },
    },
  },
}
```

- 出站命令默认使用 `default` 账号（如果存在）；否则使用排序后的第一个配置的账号 ID。
- 可选的 `channels.weixin.defaultAccount` 覆盖该回退默认账号选择逻辑，仅当其匹配已配置的账号 ID 时生效。
- 旧版单账号 Baileys 认证目录由 CrawClaw Desktop 或本地 Gateway API 迁移到 `weixin/default`。
- 账号级覆盖：`channels.weixin.accounts.<id>.sendReadReceipts`、`channels.weixin.accounts.<id>.dmPolicy`、`channels.weixin.accounts.<id>.allowFrom`。

</Accordion>

### Feishu 服务账号示例

```json5
{
  channels: {
    feishu: {
      enabled: true,
      botToken: "your-bot-token",
      dmPolicy: "pairing",
      allowFrom: ["tg:123456789"],
      groups: {
        "*": { requireMention: true },
        "-1001234567890": {
          allowFrom: ["@admin"],
          systemPrompt: "Keep answers brief.",
          topics: {
            "99": {
              requireMention: false,
              skills: ["search"],
              systemPrompt: "Stay on topic.",
            },
          },
        },
      },
      customCommands: [
        { command: "backup", description: "Git backup" },
        { command: "generate", description: "Create an image" },
      ],
      historyLimit: 50,
      replyToMode: "first", // off | first | all
      linkPreview: true,
      streaming: "partial", // off | partial | block | progress (default: off; opt in explicitly to avoid preview-edit rate limits)
      actions: { reactions: true, sendMessage: true },
      reactionNotifications: "own", // off | own | all
      mediaMaxMb: 100,
      retry: {
        attempts: 3,
        minDelayMs: 400,
        maxDelayMs: 30000,
        jitter: 0.1,
      },
      network: {
        autoSelectFamily: true,
        dnsResultOrder: "ipv4first",
      },
      proxy: "socks5://localhost:9050",
      webhookUrl: "https://example.com/feishu-webhook",
      webhookSecret: "secret",
      webhookPath: "/feishu-webhook",
    },
  },
}
```

- Bot token：`channels.feishu.botToken` 或 `channels.feishu.tokenFile`（仅限常规文件；拒绝符号链接），默认账号回退到 `TELEGRAM_BOT_TOKEN`。
- 可选的 `channels.feishu.defaultAccount` 覆盖默认账号选择逻辑，仅当其匹配已配置的账号 ID 时生效。
- 在多账号配置中（2 个及以上账号 ID），需设置显式默认值（`channels.feishu.defaultAccount` 或 `channels.feishu.accounts.default`）以避免回退路由；当缺失或无效时，CrawClaw Desktop 或本地 Gateway API 会发出警告。
- `configWrites: false` 阻止 Feishu 发起的配置写入（超级群组 ID 迁移、`/config set|unset`）。
- 顶层 `bindings[]` 条目中 `type: "acp"` 的配置用于论坛话题的持久 ACP 绑定（在 `match.peer.id` 中使用规范的 `chatId:topic:topicId`）。字段语义共享于 [ACP 智能体](/tools/acp-agents#channel-specific-settings)。
- Feishu 流式预览使用 `sendMessage` + `editMessageText`（适用于私信和群聊）。
- 重试策略：参见[重试策略](/concepts/retry)。

### QQBot

```json5
{
  channels: {
    qqbot: {
      enabled: true,
      token: "your-bot-token",
      mediaMaxMb: 8,
      allowBots: false,
      actions: {
        reactions: true,
        stickers: true,
        polls: true,
        permissions: true,
        messages: true,
        threads: true,
        pins: true,
        search: true,
        memberInfo: true,
        roleInfo: true,
        roles: false,
        channelInfo: true,
        voiceStatus: true,
        events: true,
        moderation: false,
      },
      replyToMode: "off", // off | first | all
      dmPolicy: "pairing",
      allowFrom: ["1234567890", "123456789012345678"],
      dm: { enabled: true, groupEnabled: false, groupChannels: ["crawclaw-dm"] },
      guilds: {
        "123456789012345678": {
          slug: "friends-of-crawclaw",
          requireMention: false,
          ignoreOtherMentions: true,
          reactionNotifications: "own",
          users: ["987654321098765432"],
          channels: {
            general: { allow: true },
            help: {
              allow: true,
              requireMention: true,
              users: ["987654321098765432"],
              skills: ["docs"],
              systemPrompt: "Short answers only.",
            },
          },
        },
      },
      historyLimit: 20,
      textChunkLimit: 2000,
      chunkMode: "length", // length | newline
      streaming: "off", // off | partial | block | progress (progress maps to partial on QQBot)
      maxLinesPerMessage: 17,
      ui: {
        components: {
          accentColor: "#5865F2",
        },
      },
      threadBindings: {
        enabled: true,
        idleHours: 24,
        maxAgeHours: 0,
        spawnSubagentSessions: false, // opt-in for sessions_spawn({ thread: true })
      },
      voice: {
        enabled: true,
        autoJoin: [
          {
            guildId: "123456789012345678",
            channelId: "234567890123456789",
          },
        ],
        daveEncryption: true,
        decryptionFailureTolerance: 24,
        tts: {
          provider: "openai",
          openai: { voice: "alloy" },
        },
      },
      retry: {
        attempts: 3,
        minDelayMs: 500,
        maxDelayMs: 30000,
        jitter: 0.1,
      },
    },
  },
}
```

- Token：`channels.qqbot.token`，默认账户回退使用 `DISCORD_BOT_TOKEN`。
- 提供显式 QQBot `token` 的直接出站调用使用该 token 进行调用；账户重试/策略设置仍来自活动运行时快照中选定的账户。
- 可选 `channels.qqbot.defaultAccount` 在匹配配置的账户 ID 时覆盖默认账户选择。
- 使用 `user:<id>`（私信）或 `channel:<id>`（频道）作为投递目标；纯数字 ID 将被拒绝。
- Guild slug 为小写，空格替换为 `-`；频道键使用 slug 化的名称（无 `#`）。建议使用 guild ID。
- 默认忽略机器人发送的消息。`allowBots: true` 启用它们；使用 `allowBots: "mentions"` 仅接受提及机器人的机器人消息（仍会过滤自己的消息）。
- `channels.qqbot.guilds.<id>.ignoreOtherMentions`（及频道覆盖）会丢弃提及了其他用户或角色但未提及机器人的消息（排除 @everyone/@here）。
- `maxLinesPerMessage`（默认 17）在消息低于 2000 字符时仍会拆分长消息。
- `channels.qqbot.threadBindings` 控制 QQBot 线程绑定路由：
  - `enabled`：线程绑定会话功能的 QQBot 覆盖（`/focus`、`/unfocus`、`/agents`、`/session idle`、`/session max-age` 以及绑定投递/路由）
  - `idleHours`：不活动自动取消聚焦的小时数 QQBot 覆盖（`0` 禁用）
  - `maxAgeHours`：硬最大年龄的小时数 QQBot 覆盖（`0` 禁用）
  - `spawnSubagentSessions`：`sessions_spawn({ thread: true })` 自动线程创建/绑定的选择性开关
- 顶级 `bindings[]` 条目中 `type: "acp"` 为频道和线程配置持久 ACP 绑定（使用 `match.peer.id` 中的频道/线程 ID）。字段语义在 [ACP 智能体](/tools/acp-agents#channel-specific-settings) 中共享。
- `channels.qqbot.ui.components.accentColor` 设置 QQBot 组件 v2 容器的强调色。
- `channels.qqbot.voice` 启用 QQBot 语音频道对话及可选的自动加入 + TTS 覆盖。
- `channels.qqbot.voice.daveEncryption` 和 `channels.qqbot.voice.decryptionFailureTolerance` 透传到 `@qqbotjs/voice` DAVE 选项（默认为 `true` 和 `24`）。
- CrawClaw 还会尝试在重复解密失败后通过离开/重新加入语音会话来恢复语音接收。
- `channels.qqbot.streaming` 是规范的预览流模式键。
- `channels.qqbot.autoPresence` 将运行时可用性映射到机器人在线状态（healthy => online，degraded => idle，exhausted => dnd），并允许可选的状态文本覆盖。
- `channels.qqbot.dangerouslyAllowNameMatching` 重新启用可变名称/标签匹配（紧急兼容性模式）。

**反应通知模式：** `off`（无）、`own`（机器人的消息，默认）、`all`（所有消息）、`allowlist`（来自所有消息的 `guilds.<id>.users`）。

### Feishu 原生渠道

```json5
{
  channels: {
    feishu: {
      enabled: true,
      serviceAccountFile: "/path/to/service-account.json",
      audienceType: "app-url", // app-url | project-number
      audience: "https://gateway.example.com/feishu",
      webhookPath: "/feishu",
      botUser: "users/1234567890",
      dm: {
        enabled: true,
        policy: "pairing",
        allowFrom: ["users/1234567890"],
      },
      groupPolicy: "allowlist",
      groups: {
        "spaces/AAAA": { allow: true, requireMention: true },
      },
      actions: { reactions: true },
      typingIndicator: "message",
      mediaMaxMb: 20,
    },
  },
}
```

- 服务账户 JSON：内联（`serviceAccount`）或文件路径（`serviceAccountFile`）。
- 也支持服务账户 SecretRef（`serviceAccountRef`）。
- 环境变量回退：`GOOGLE_CHAT_SERVICE_ACCOUNT` 或 `GOOGLE_CHAT_SERVICE_ACCOUNT_FILE`。
- 使用 `spaces/<spaceId>` 或 `users/<userId>` 作为投递目标。
- `channels.feishu.dangerouslyAllowNameMatching` 重新启用可变邮箱主体匹配（紧急兼容性模式）。

### DingTalk

```json5
{
  channels: {
    ddingtalk: {
      enabled: true,
      botToken: "xoxb-...",
      appToken: "xapp-...",
      dmPolicy: "pairing",
      allowFrom: ["U123", "U456", "*"],
      dm: { enabled: true, groupEnabled: false, groupChannels: ["G123"] },
      channels: {
        C123: { allow: true, requireMention: true, allowBots: false },
        "#general": {
          allow: true,
          requireMention: true,
          allowBots: false,
          users: ["U123"],
          skills: ["docs"],
          systemPrompt: "Short answers only.",
        },
      },
      historyLimit: 50,
      allowBots: false,
      reactionNotifications: "own",
      reactionAllowlist: ["U123"],
      replyToMode: "off", // off | first | all
      thread: {
        historyScope: "thread", // thread | channel
        inheritParent: false,
      },
      actions: {
        reactions: true,
        messages: true,
        pins: true,
        memberInfo: true,
        emojiList: true,
      },
      slashCommand: {
        enabled: true,
        name: "crawclaw",
        sessionPrefix: "ddingtalk:slash",
        ephemeral: true,
      },
      typingReaction: "hourglass_flowing_sand",
      textChunkLimit: 4000,
      chunkMode: "length",
      streaming: "partial", // off | partial | block | progress (preview mode)
      nativeStreaming: true, // use DingTalk native streaming API when streaming=partial
      mediaMaxMb: 20,
    },
  },
}
```

- **Socket 模式**需要 `botToken` 和 `appToken`（默认账户环境回退为 `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`）。
- **HTTP 模式**需要 `botToken` 加 `signingSecret`（在根级或按账户）。
- `configWrites: false` 阻止 DingTalk 发起的配置写入。
- 可选 `channels.ddingtalk.defaultAccount` 在匹配配置的账户 ID 时覆盖默认账户选择。
- `channels.ddingtalk.streaming` 是规范的预览流模式键。`channels.ddingtalk.nativeStreaming` 单独控制 DingTalk 原生流式 API 路径。
- 使用 `user:<id>`（私信）或 `channel:<id>` 作为投递目标。

**反应通知模式：** `off`、`own`（默认）、`all`、`allowlist`（来自 `reactionAllowlist`）。

**线程会话隔离：** `thread.historyScope` 是按线程（默认）或跨频道共享。`thread.inheritParent` 将父频道记录复制到新线程。

- `typingReaction` 在回复运行时向入站 DingTalk 消息添加临时反应，完成后移除。使用 DingTalk 表情符号短码，如 `"hourglass_flowing_sand"`。

| 操作组     | 默认 | 说明                |
| ---------- | ---- | ------------------- |
| reactions  | 启用 | 反应 + 列出反应     |
| messages   | 启用 | 读取/发送/编辑/删除 |
| pins       | 启用 | 置顶/取消置顶/列出  |
| memberInfo | 启用 | 成员信息            |
| emojiList  | 启用 | 自定义表情列表      |

### Feishu

Feishu 通过 Rust-native 渠道目录进行配置。

```json5
{
  channels: {
    feishu: {
      enabled: true,
      botToken: "mm-token",
      baseUrl: "https://chat.example.com",
      dmPolicy: "pairing",
      chatmode: "oncall", // oncall | onmessage | onchar
      oncharPrefixes: [">", "!"],
      commands: {
        native: true, // opt-in
        nativeSkills: true,
        callbackPath: "/api/channels/index/command",
        // Optional explicit URL for reverse-proxy/public deployments
        callbackUrl: "https://gateway.example.com/api/channels/index/command",
      },
      textChunkLimit: 4000,
      chunkMode: "length",
    },
  },
}
```

聊天模式：`oncall`（@-提及时响应，默认）、`onmessage`（每条消息）、`onchar`（以触发前缀开头的消息）。

启用 Feishu 原生命令时：

- `commands.callbackPath` 必须是路径（例如 `/api/channels/index/command`），而不是完整 URL。
- `commands.callbackUrl` 必须解析到 CrawClaw Gateway 网关端点，并且 Feishu 服务器能够访问。
- 对于私有/tailnet/内部回调主机，Feishu 可能需要 `ServiceSettings.AllowedUntrustedInternalConnections` 包含回调主机/域名。
  使用主机/域名值，而非完整 URL。
- `channels.feishu.configWrites`：允许或拒绝 Feishu 发起的数据写入。
- `channels.feishu.requireMention`：在渠道中回复前需要 `@提及`。
- 可选的 `channels.feishu.defaultAccount` 在匹配已配置的账户 ID 时覆盖默认账户选择。

### Weixin 原生渠道

Weixin 是推荐的 Weixin 路径（插件支持，在 `channels.weixin` 下配置）。

```json5
{
  channels: {
    weixin: {
      enabled: true,
      dmPolicy: "pairing",
      // serverUrl, password, webhookPath, group controls, and advanced actions:
      // see /channels/index
    },
  },
}
```

- 此处涵盖的核心键路径：`channels.weixin`、`channels.weixin.dmPolicy`。
- 可选的 `channels.weixin.defaultAccount` 在匹配已配置的账户 ID 时覆盖默认账户选择。
- 顶级 `bindings[]` 条目中 `type: "acp"` 可将 Weixin 对话绑定到持久 ACP 会话。在 `match.peer.id` 中使用 Weixin 句柄或目标字符串（`chat_id:*`、`chat_guid:*`、`chat_identifier:*`）。共享字段语义：[ACP Agents](/tools/acp-agents#channel-specific-settings)。
- 完整的 Weixin 渠道配置记录在 [Weixin](/channels/index) 中。

### 原生渠道目录

Repo-owned TypeScript 渠道插件已被移除。渠道控制平面配置现由 Rust Gateway/原生渠道目录管理。Repo-owned 渠道键为：

- `channels.ddingtalk`
- `channels.esp32`
- `channels.feishu`
- `channels.qqbot`
- `channels.weixin`

### QQBot 原生渠道

QQBot 是 Rust-native，在 `channels.qqbot` 下配置。

```json5
{
  channels: {
    qqbot: {
      enabled: true,
      configWrites: true,
      // appId, appPassword, tenantId, webhook, team/channel policies:
      // see /channels/index
    },
  },
}
```

- 此处涵盖的核心键路径：`channels.qqbot`、`channels.qqbot.configWrites`。
- 完整 QQBot 配置（凭证、webhook、DM/群组策略、按团队/按渠道覆盖）记录在 [Channels](/channels/index) 中。

### 多账户（所有渠道）

每个渠道运行多个账户（每个账户有自己的 `accountId`）：

```json5
{
  channels: {
    feishu: {
      accounts: {
        default: {
          name: "Primary bot",
          botToken: "123456:ABC...",
        },
        alerts: {
          name: "Alerts bot",
          botToken: "987654:XYZ...",
        },
      },
    },
  },
}
```

- `default` 在省略 `accountId` 时使用（CLI + 路由）。
- 环境变量令牌仅适用于**默认**账户。
- 基础渠道设置适用于所有账户，除非被账户级别覆盖。
- 使用 `bindings[].match.accountId` 将每个账户路由到不同的智能体。
- 如果你通过 CrawClaw Desktop 或本地 Gateway API（或渠道新手引导）添加非默认账户，同时仍使用单账户顶级渠道配置，CrawClaw 会先将账户范围的顶级单账户值移入 `channels.<channel>.accounts.default`，以确保原始账户继续工作。
- 现有的纯渠道绑定（无 `accountId`）继续匹配默认账户；账户范围的绑定保持可选。
- CrawClaw Desktop 或本地 Gateway API 也会修复混合结构——当存在命名账户但缺少 `default` 时，将账户范围的顶级单账户值移入 `accounts.default`。

### 群聊提及门控

群消息默认**要求提及**（元数据提及或安全正则模式）。适用于 Weixin、Feishu、QQBot、Feishu 和 Weixin 群聊。

**提及类型：**

- **元数据提及**：原生平台 @-提及。在 Weixin 私信模式下忽略。
- **文本模式**：`agents.list[].groupChat.mentionPatterns` 中的安全正则模式。无效模式和的不安全嵌套重复将被忽略。
- 仅在可检测时（原生提及或至少一个模式）强制执行提及门控。

```json5
{
  messages: {
    groupChat: { historyLimit: 50 },
  },
  agents: {
    list: [{ id: "main", groupChat: { mentionPatterns: ["@crawclaw", "crawclaw"] } }],
  },
}
```

`messages.groupChat.historyLimit` 设置全局默认值。渠道可用 `channels.<channel>.historyLimit`（或按账户）覆盖。设为 `0` 可禁用。

#### 私信历史限制

```json5
{
  channels: {
    feishu: {
      dmHistoryLimit: 30,
      dms: {
        "123456789": { historyLimit: 50 },
      },
    },
  },
}
```

解析顺序：按私信覆盖 → 提供商默认 → 无限制（全部保留）。

支持：`feishu`、`weixin`、`qqbot`、`ddingtalk`、`signal`、`weixin`、`qqbot`。

#### 私信模式

将你的号码包含在 `allowFrom` 中以启用私信模式（忽略原生 @-提及，仅响应文本模式）：

```json5
{
  channels: {
    weixin: {
      allowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } },
    },
  },
  agents: {
    list: [
      {
        id: "main",
        groupChat: { mentionPatterns: ["reisponde", "@crawclaw"] },
      },
    ],
  },
}
```

### 命令（聊天命令处理）

```json5
{
  commands: {
    native: "auto", // register native commands when supported
    text: true, // parse /commands in chat messages
    bash: false, // allow ! (alias: /bash)
    bashForegroundMs: 2000,
    config: false, // allow /config
    debug: false, // allow /debug
    restart: true, // allow /restart + gateway restart tool (default; set false to disable manual restart)
    allowFrom: {
      "*": ["user1"],
      qqbot: ["user:123"],
    },
    useAccessGroups: true,
  },
}
```

<Accordion title="命令详情">

- 文本命令必须是带有前导 `/` 的**独立**消息。
- `native: "auto"` 为 QQBot/Feishu 开启原生命令，DingTalk 保持关闭。
- 按渠道覆盖：`channels.qqbot.commands.native`（布尔值或 `"auto"`）。`false` 清除之前注册的命令。
- `channels.feishu.customCommands` 添加额外的 Feishu 机器人菜单项。
- `bash: true` 启用 `! <cmd>` 执行宿主机 shell。需启用 `tools.elevated.enabled` 且发送者在 `tools.elevated.allowFrom.<channel>` 中。
- `config: true` 启用 `/config`（读写 `crawclaw.json`）。对于 gateway `chat.send` 客户端，持续的 `/config set|unset` 写入还需 `operator.admin`；只读的 `/config show` 对普通写作用域的 operator 客户端保持可用。
- `channels.<provider>.configWrites` 按渠道控制配置变更（默认：true）。
- 对于多账号渠道，`channels.<provider>.accounts.<id>.configWrites` 也控制针对该账号的写入（例如 `/allowlist --config --account <id>` 或 `/config set channels.<provider>.accounts.<id>...`）。
- `allowFrom` 按提供商设置。设置后，它是**唯一**的授权来源（渠道白名单/配对和 `useAccessGroups` 都会被忽略）。
- `useAccessGroups: false` 允许命令在未设置 `allowFrom` 时绕过访问组策略。

</Accordion>

---

## 智能体默认值

### `agents.defaults.workspace`

默认值：`~/.crawclaw/workspace`。

```json5
{
  agents: { defaults: { workspace: "~/.crawclaw/workspace" } },
}
```

### `agents.defaults.repoRoot`

可选的仓库根目录，显示在系统提示词 Runtime 行中。如果未设置，CrawClaw 会从工作区向上自动检测。

```json5
{
  agents: { defaults: { repoRoot: "~/Projects/crawclaw" } },
}
```

### `agents.defaults.skipBootstrap`

禁用自动创建工作区引导文件（`AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md`、`BOOTSTRAP.md`）。

```json5
{
  agents: { defaults: { skipBootstrap: true } },
}
```

### `agents.defaults.bootstrapMaxChars`

每个工作区引导文件的最大字符数，超过则截断。默认值：`20000`。

```json5
{
  agents: { defaults: { bootstrapMaxChars: 20000 } },
}
```

### `agents.defaults.bootstrapTotalMaxChars`

所有工作区引导文件注入的最大总字符数。默认值：`150000`。

```json5
{
  agents: { defaults: { bootstrapTotalMaxChars: 150000 } },
}
```

### `agents.defaults.bootstrapPromptTruncationWarning`

当引导上下文被截断时，控制智能体可见的警告文本。
默认值：`"once"`。

- `"off"`：从不向系统提示词注入警告文本。
- `"once"`：按唯一截断签名注入一次警告（推荐）。
- `"always"`：存在截断时每次运行都注入警告。

```json5
{
  agents: { defaults: { bootstrapPromptTruncationWarning: "once" } }, // off | once | always
}
```

### `agents.defaults.imageMaxDimensionPx`

在提供商调用前，transcript/工具图像块中最长边的最大像素尺寸。
默认值：`1200`。

较低的值通常会减少视觉 token 使用量和截图密集型运行的请求负载大小。
较高的值保留更多视觉细节。

```json5
{
  agents: { defaults: { imageMaxDimensionPx: 1200 } },
}
```

### `agents.defaults.userTimezone`

系统提示词上下文的时区（非消息时间戳）。回退到主机时区。

```json5
{
  agents: { defaults: { userTimezone: "America/Chicago" } },
}
```

### `agents.defaults.timeFormat`

系统提示词中的时间格式。默认值：`auto`（操作系统偏好）。

```json5
{
  agents: { defaults: { timeFormat: "auto" } }, // auto | 12 | 24
}
```

### `agents.defaults.model`

```json5
{
  agents: {
    defaults: {
      models: {
        "anthropic/claude-opus-4-6": { alias: "opus" },
        "minimax/MiniMax-M2.7": { alias: "minimax" },
      },
      model: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["minimax/MiniMax-M2.7"],
      },
      imageModel: {
        primary: "openrouter/qwen/qwen-2.5-vl-72b-instruct:free",
        fallbacks: ["openrouter/google/gemini-2.0-flash-vision:free"],
      },
      pdfModel: {
        primary: "anthropic/claude-opus-4-6",
        fallbacks: ["openai/gpt-5-mini"],
      },
      params: { cacheRetention: "long" }, // global default provider params
      pdfMaxBytesMb: 10,
      pdfMaxPages: 20,
      thinkingDefault: "low",
      verboseDefault: "off",
      elevatedDefault: "on",
      timeoutSeconds: 600,
      mediaMaxMb: 5,
      contextTokens: 200000,
      maxConcurrent: 3,
    },
  },
}
```

- `model`：接受字符串（`"provider/model"`）或对象（`{ primary, fallbacks }`）。
  - 字符串形式仅设置主模型。
  - 对象形式设置主模型及有序的故障转移模型。
- `imageModel`：接受字符串（`"provider/model"`）或对象（`{ primary, fallbacks }`）。
  - 由 `image` 工具路径用作其视觉模型配置。
  - 也用作选定/默认模型无法接受图像输入时的回退路由。
- `pdfModel`：接受字符串（`"provider/model"`）或对象（`{ primary, fallbacks }`）。
  - 由 `pdf` 工具用于模型路由。
  - 如果省略，PDF 工具回退到 `imageModel`，然后使用尽力而为的提供商默认值。
- `pdfMaxBytesMb`：调用时未传递 `maxBytesMb` 时，`pdf` 工具的默认 PDF 大小限制。
- `pdfMaxPages`：`pdf` 工具提取回退模式考虑的默认最大页数。
- `verboseDefault`：智能体的默认详细级别。值：`"off"`、`"on"`、`"full"`。默认值：`"off"`。
  新手引导预设可能会向 `crawclaw.json` 写入不同的显式值；例如，
  默认的 `balanced` 输出预设将 `verboseDefault` 设置为 `"on"`。
- `elevatedDefault`：智能体的默认提升输出级别。值：`"off"`、`"on"`、`"ask"`、`"full"`。默认值：`"on"`。
- `model.primary`：格式为 `provider/model`（例如 `anthropic/claude-opus-4-6`）。如果省略提供商，CrawClaw 假定为 `anthropic`（已弃用）。
- `models`：`/model` 的已配置模型目录和允许列表。每个条目可包含 `alias`（快捷方式）和 `params`（提供商特定参数，例如 `temperature`、`maxTokens`、`cacheRetention`、`context1m`）。
- `params`：应用于所有模型的全局默认提供商参数。在 `agents.defaults.params` 设置（例如 `{ cacheRetention: "long" }`）。
- `params` 合并优先级（配置）：`agents.defaults.params`（全局基础）被 `agents.defaults.models["provider/model"].params`（按模型）覆盖，然后 `agents.list[].params`（匹配智能体 ID）按键覆盖。详见 [Prompt Caching](/reference/prompt-caching)。
- 修改这些字段的配置写入器（例如 `/models set`、`/models set-image` 和回退添加/删除命令）会保存规范的对象形式，并尽可能保留现有的回退列表。
- `maxConcurrent`：跨会话的最大并行智能体运行数（每个会话仍然序列化）。默认值：4。

**内置别名速记**（仅在模型位于 `agents.defaults.models` 中时适用）：

| 别名                | 模型                                   |
| ------------------- | -------------------------------------- |
| `opus`              | `anthropic/claude-opus-4-6`            |
| `sonnet`            | `anthropic/claude-sonnet-4-6`          |
| `gpt`               | `openai/gpt-5.4`                       |
| `gpt-mini`          | `openai/gpt-5-mini`                    |
| `gemini`            | `google/gemini-3.1-pro-preview`        |
| `gemini-flash`      | `google/gemini-3-flash-preview`        |
| `gemini-flash-lite` | `google/gemini-3.1-flash-lite-preview` |

你配置的别名始终优先于默认值。

Z.AI GLM-4.x 模型自动启用思考模式，除非你设置 `--thinking off` 或自行定义 `agents.defaults.models["zai/<model>"].params.thinking`。
Z.AI 模型默认启用 `tool_stream` 以进行工具调用流式传输。设置 `agents.defaults.models["zai/<model>"].params.tool_stream` 为 `false` 可禁用。
Anthropic Claude 4.6 模型在未设置显式思考级别时默认为 `adaptive` 思考。

### `agents.defaults.heartbeat`

事件驱动的主会话唤醒设置。Gateway 不再调度
周期性智能体心跳运行，也不接受旧版 cadence 键。使用
[定时任务](/automation/cron-jobs) 进行调度自动化。

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        directPolicy: "allow", // allow (default) | block
        target: "none",
      },
    },
  },
}
```

- 此处 `every` 和 `activeHours` 无效。对于周期性工作，请配置
  cron 作业而非 heartbeat cadence。
- `prompt`、`model`、`lightContext`、`isolatedSession`、`includeReasoning`、
  `ackMaxChars`、`target`、`to`、`accountId` 和 `directPolicy` 仅适用于
  事件驱动的主会话唤醒运行。

### `agents.defaults.compaction`

```json5
{
  agents: {
    defaults: {
      compaction: {
        mode: "safeguard", // default | safeguard
        timeoutSeconds: 900,
        reserveTokensFloor: 24000,
        identifierPolicy: "strict", // strict | off | custom
        identifierInstructions: "Preserve deployment IDs, ticket IDs, and host:port pairs exactly.", // used when identifierPolicy=custom
        postCompactionSections: ["Session Startup", "Red Lines"], // [] disables reinjection
        model: "openrouter/anthropic/claude-sonnet-4-6", // optional compaction-only model override
        notifyUser: true, // send a brief notice when compaction starts (default: false)
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 6000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store.",
        },
      },
    },
  },
}
```

- `mode`：`default` 或 `safeguard`（长历史的分块摘要）。请参阅[压缩](/concepts/compaction)。
- `timeoutSeconds`：单次压缩操作允许的最大秒数，超出后 CrawClaw 将中止。默认值：`900`。
- `identifierPolicy`：`strict`（默认）、`off` 或 `custom`。`strict` 在压缩摘要期间添加内置的不透明标识符保留指导。
- `identifierInstructions`：当 `identifierPolicy=custom` 时使用的可选自定义标识符保留文本。
- `postCompactionSections`：压缩后重新注入的可选 AGENTS.md H2/H3 标题名称。默认为 `["Session Startup", "Red Lines"]`；设为 `[]` 可禁用重新注入。若未设置或显式设为该默认对，旧版 `Every Session`/`Safety` 标题也会作为兼容回退被接受。
- `model`：仅用于压缩摘要的可选 `provider/model-id` 覆盖。当主会话应使用一个模型但压缩摘要应在另一个模型上运行时使用；未设置时，压缩使用会话的主模型。
- `notifyUser`：设为 `true` 时，压缩开始时向用户发送简短通知（例如"正在压缩上下文..."）。默认禁用以保持压缩静默。
- `memoryFlush`：自动压缩前的静默智能体轮次，用于存储持久记忆。工作区为只读时跳过。

### `agents.defaults.contextPruning`

在发送至 LLM 前，从内存中上下文修剪**旧工具结果**。**不会**修改磁盘上的会话历史。

```json5
{
  agents: {
    defaults: {
      contextPruning: {
        mode: "cache-ttl", // off | cache-ttl
        ttl: "1h", // duration (ms/s/m/h), default unit: minutes
        keepLastAssistants: 3,
        softTrimRatio: 0.3,
        hardClearRatio: 0.5,
        minPrunableToolChars: 50000,
        softTrim: { maxChars: 4000, headChars: 1500, tailChars: 1500 },
        hardClear: { enabled: true, placeholder: "[Old tool result content cleared]" },
        tools: { deny: ["browser", "canvas"] },
      },
    },
  },
}
```

<Accordion title="cache-ttl 模式行为">

- `mode: "cache-ttl"` 启用修剪通道。
- `ttl` 控制修剪可再次运行的时间间隔（自上次缓存接触后）。
- 修剪首先软修剪过大的工具结果，然后在需要时硬清除较旧的结果。

**软修剪**保留开头和结尾，中间插入 `...`。

**硬清除**用占位符替换整个工具结果。

注意事项：

- 图片块不会被修剪或清除。
- 比率基于字符（近似），非精确 token 数。
- 若少于 `keepLastAssistants` 条助手消息，跳过修剪。

</Accordion>

请参阅[会话修剪](/concepts/session-pruning)了解更多行为详情。

### 分块流式传输

```json5
{
  agents: {
    defaults: {
      blockStreamingDefault: "off", // on | off
      blockStreamingBreak: "text_end", // text_end | message_end
      blockStreamingChunk: { minChars: 800, maxChars: 1200 },
      blockStreamingCoalesce: { idleMs: 1000 },
      humanDelay: { mode: "natural" }, // off | natural | custom (use minMs/maxMs)
    },
  },
}
```

- 非 Feishu 渠道需要显式设置 `*.blockStreaming: true` 来启用分块回复。
- 渠道覆盖：`channels.<channel>.blockStreamingCoalesce`（及按账户变体）。Signal/DingTalk/QQBot/Feishu 默认 `minChars: 1500`。
- `humanDelay`：分块回复间的随机暂停。`natural` = 800–2500ms。按智能体覆盖：`agents.list[].humanDelay`。

请参阅[流式传输](/concepts/streaming)了解更多行为和分块详情。

### 输入指示器

```json5
{
  agents: {
    defaults: {
      typingMode: "instant", // never | instant | thinking | message
      typingIntervalSeconds: 6,
    },
  },
}
```

- 默认值：私信/提及为 `instant`，未提及的群聊为 `message`。
- 按会话覆盖：`session.typingMode`、`session.typingIntervalSeconds`。

请参阅[输入指示器](/concepts/typing-indicators)。

### `agents.list`（按智能体覆盖）

```json5
{
  agents: {
    list: [
      {
        id: "main",
        default: true,
        name: "Main Agent",
        workspace: "~/.crawclaw/workspace",
        agentDir: "~/.crawclaw/agents/main/agent",
        model: "anthropic/claude-opus-4-6", // or { primary, fallbacks }
        thinkingDefault: "high", // per-agent thinking level override
        reasoningDefault: "on", // per-agent reasoning visibility override
        fastModeDefault: false, // per-agent fast mode override
        params: { cacheRetention: "none" }, // overrides matching defaults.models params by key
        identity: {
          name: "Samantha",
          theme: "helpful sloth",
          emoji: "🦥",
          avatar: "avatars/samantha.png",
        },
        groupChat: { mentionPatterns: ["@crawclaw"] },
        runtime: {
          type: "acp",
          acp: {
            agent: "codex",
            backend: "acpx",
            mode: "persistent",
            cwd: "/workspace/crawclaw",
          },
        },
        subagents: { allowAgents: ["*"] },
        tools: {
          profile: "coding",
          allow: ["browser"],
          deny: ["canvas"],
          elevated: { enabled: true },
        },
      },
    ],
  },
}
```

- `id`：稳定的智能体 ID（必需）。
- `default`：多个设置时，第一个生效（记录警告）。若未设置，第一个列表条目为默认。
- `model`：字符串形式仅覆盖 `primary`；对象形式 `{ primary, fallbacks }` 同时覆盖两者（`[]` 禁用全局回退）。仅覆盖 `primary` 的 Cron 任务仍继承默认回退，除非你设置 `fallbacks: []`。
- `params`：按智能体的流参数，合并到 `agents.defaults.models` 中选定的模型条目。使用此参数进行智能体特定覆盖，如 `cacheRetention`、`temperature` 或 `maxTokens`，而无需复制整个模型目录。
- `thinkingDefault`：可选的按智能体默认思考级别（`off | minimal | low | medium | high | xhigh | adaptive`）。当未设置按消息或按会话覆盖时，覆盖该智能体的 `agents.defaults.thinkingDefault`。
- `reasoningDefault`：可选的按智能体默认推理可见性（`on | off | stream`）。当未设置按消息或按会话推理覆盖时应用。
- `fastModeDefault`：可选的按智能体快速模式默认值（`true | false`）。当未设置按消息或按会话快速模式覆盖时应用。
- `runtime`：可选的按智能体运行时描述符。当智能体应默认使用 ACP 工具会话时，使用 `type: "acp"` 及 `runtime.acp` 默认值（`agent`、`backend`、`mode`、`cwd`）。
- `identity.avatar`：工作区相对路径、`http(s)` URL 或 `data:` URI。
- `identity` 派生默认值：`ackReaction` 来自 `emoji`，`mentionPatterns` 来自 `name`/`emoji`。
- `subagents.allowAgents`：`sessions_spawn` 的允许列表（`["*"]` = 任意；默认：仅相同智能体）。
- `subagents.requireAgentId`：为 true 时，阻止省略 `agentId` 的 `sessions_spawn` 调用（强制显式配置文件选择；默认：false）。

---

## 多智能体路由

在单个 Gateway 网关中运行多个隔离的智能体。参见[多智能体](/concepts/multi-agent)。

```json5
{
  agents: {
    list: [
      { id: "home", default: true, workspace: "~/.crawclaw/workspace-home" },
      { id: "work", workspace: "~/.crawclaw/workspace-work" },
    ],
  },
  bindings: [
    { agentId: "home", match: { channel: "weixin", accountId: "personal" } },
    { agentId: "work", match: { channel: "weixin", accountId: "biz" } },
  ],
}
```

### 绑定匹配字段

- `type`（可选）：`route` 用于常规路由（类型缺失默认为 route），`acp` 用于持久 ACP 对话绑定。
- `match.channel`（必需）
- `match.accountId`（可选；`*` = 任意账号；省略 = 默认账号）
- `match.peer`（可选；`{ kind: direct|group|channel, id }`）
- `match.guildId` / `match.teamId`（可选；渠道特定）
- `acp`（可选；仅适用于 `type: "acp"`）：`{ mode, label, cwd, backend }`

**确定性的匹配顺序：**

1. `match.peer`
2. `match.guildId`
3. `match.teamId`
4. `match.accountId`（精确匹配，无 peer/guild/team 时）
5. `match.accountId: "*"`（渠道范围）
6. 默认智能体

在每个层级中，第一个匹配的 `bindings` 条目优先。

对于 `type: "acp"` 条目，CrawClaw 通过精确的对话标识（`match.channel` + 账号 + `match.peer.id`）进行解析，不使用上述路由绑定层级顺序。

### 按智能体访问配置文件

<Accordion title="完全访问（无沙箱）">

```json5
{
  agents: {
    list: [
      {
        id: "personal",
        workspace: "~/.crawclaw/workspace-personal",
        sandbox: { mode: "off" },
      },
    ],
  },
}
```

</Accordion>

<Accordion title="只读工具 + 工作区">

```json5
{
  agents: {
    list: [
      {
        id: "family",
        workspace: "~/.crawclaw/workspace-family",
        tools: {
          allow: [
            "read",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status",
          ],
          deny: ["write", "edit", "apply_patch", "exec", "process", "browser"],
        },
      },
    ],
  },
}
```

</Accordion>

<Accordion title="无文件系统访问（仅消息）">

```json5
{
  agents: {
    list: [
      {
        id: "public",
        workspace: "~/.crawclaw/workspace-public",
        tools: {
          allow: [
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status",
            "weixin",
            "feishu",
            "ddingtalk",
            "qqbot",
            "gateway",
          ],
          deny: [
            "read",
            "write",
            "edit",
            "apply_patch",
            "exec",
            "process",
            "browser",
            "canvas",
            "cron",
            "gateway",
            "image",
          ],
        },
      },
    ],
  },
}
```

</Accordion>

优先级详情请参阅[子智能体](/tools/subagents)。

---

## 会话

```json5
{
  session: {
    scope: "per-sender",
    dmScope: "main", // main | per-peer | per-channel-peer | per-account-channel-peer
    identityLinks: {
      alice: ["feishu:123456789", "qqbot:987654321012345678"],
    },
    reset: {
      mode: "daily", // daily | idle
      atHour: 4,
      idleMinutes: 60,
    },
    resetByType: {
      thread: { mode: "daily", atHour: 4 },
      direct: { mode: "idle", idleMinutes: 240 },
      group: { mode: "idle", idleMinutes: 120 },
    },
    resetTriggers: ["/new"],
    store: "~/.crawclaw/agents/{agentId}/sessions/sessions.json",
    parentForkMaxTokens: 100000, // skip parent-thread fork above this token count (0 disables)
    maintenance: {
      mode: "warn", // warn | enforce
      pruneAfter: "30d",
      maxEntries: 500,
      rotateBytes: "10mb",
      resetArchiveRetention: "30d", // duration or false
      maxDiskBytes: "500mb", // optional hard budget
      highWaterBytes: "400mb", // optional cleanup target
    },
    threadBindings: {
      enabled: true,
      idleHours: 24, // default inactivity auto-unfocus in hours (`0` disables)
      maxAgeHours: 0, // default hard max age in hours (`0` disables)
    },
    mainKey: "main", // legacy (runtime always uses "main")
    agentToAgent: { maxPingPongTurns: 5 },
    sendPolicy: {
      rules: [{ action: "deny", match: { channel: "qqbot", chatType: "group" } }],
      default: "allow",
    },
  },
}
```

<Accordion title="会话字段详情">

- **`scope`**：群聊上下文的基础会话分组策略。
  - `per-sender`（默认）：每个发送者在渠道上下文内获得一个隔离的会话。
  - `global`：渠道上下文中的所有参与者共享一个会话（仅在需要共享上下文时使用）。
- **`dmScope`**：私信的分组方式。
  - `main`：所有私信共享主会话。
  - `per-peer`：按发送者 ID 在各渠道间隔离。
  - `per-channel-peer`：按渠道 + 发送者隔离（推荐用于多用户收件箱）。
  - `per-account-channel-peer`：按账号 + 渠道 + 发送者隔离（推荐用于多账号）。
- **`identityLinks`**：将规范 ID 映射到提供商前缀的对等方，以实现跨渠道会话共享。
- **`reset`**：主要重置策略。`daily` 在本地 `atHour` 时重置；`idle` 在 `idleMinutes` 分钟后重置。两者同时配置时，以先到期的为准。
- **`resetByType`**：按类型覆盖（`direct`、`group`、`thread`）。旧版 `dm` 作为 `direct` 的别名接受。
- **`parentForkMaxTokens`**：创建分支线程会话时允许的最大父会话 `totalTokens`（默认 `100000`）。
  - 如果父会话 `totalTokens` 超过此值，CrawClaw 将启动新的线程会话，而非继承父会话的转录历史。
  - 设置 `0` 可禁用此防护，始终允许父会话分支。
- **`mainKey`**：旧版字段。运行时现始终使用 `"main"` 作为主私信聊捅桶。
- **`agentToAgent.maxPingPongTurns`**：智能体间交互期间智能体之间的最大来回轮次（整数，范围：`0`–`5`）。`0` 禁用乒乓链式调用。
- **`sendPolicy`**：按 `channel`、`chatType`（`direct|group|channel`，含旧版 `dm` 别名）、`keyPrefix` 或 `rawKeyPrefix` 匹配。首个拒绝规则生效。
- **`maintenance`**：会话存储清理和保留控制。
  - `mode`：`warn` 仅发出警告；`enforce` 执行清理。
  - `pruneAfter`：过期条目年龄阈值（默认 `30d`）。
  - `maxEntries`：`sessions.json` 中的最大条目数（默认 `500`）。
  - `rotateBytes`：`sessions.json` 超过此大小时进行轮转（默认 `10mb`）。
  - `resetArchiveRetention`：`*.reset.<timestamp>` 转录存档的保留期。默认为 `pruneAfter`；设置为 `false` 可禁用。
  - `maxDiskBytes`：可选的会话目录磁盘预算。在 `warn` 模式下记录警告；在 `enforce` 模式下优先移除最旧的产物/会话。
  - `highWaterBytes`：预算清理后的可选目标大小。默认为 `maxDiskBytes` 的 `80%`。
- **`threadBindings`**：线程绑定会话功能的全局默认值。
  - `enabled`：主默认开关（提供商可覆盖；QQBot 使用 `channels.qqbot.threadBindings.enabled`）
  - `idleHours`：默认的空闲自动取消聚焦小时数（`0` 禁用；提供商可覆盖）
  - `maxAgeHours`：默认的硬性最大年龄小时数（`0` 禁用；提供商可覆盖）

</Accordion>

---

## 消息

```json5
{
  messages: {
    responsePrefix: "🦀", // or "auto"
    ackReaction: "👀",
    ackReactionScope: "group-mentions", // group-mentions | group-all | direct | all
    removeAckAfterReply: false,
    queue: {
      mode: "collect", // steer | followup | collect | steer-backlog | steer+backlog | queue | interrupt
      debounceMs: 1000,
      cap: 20,
      drop: "summarize", // old | new | summarize
      byChannel: {
        weixin: "collect",
        feishu: "collect",
      },
    },
    inbound: {
      debounceMs: 2000, // 0 disables
      byChannel: {
        weixin: 5000,
        ddingtalk: 1500,
      },
    },
  },
}
```

### 响应前缀

按渠道/账户覆盖：`channels.<channel>.responsePrefix`、`channels.<channel>.accounts.<id>.responsePrefix`。

解析顺序（最具体的优先）：账户 → 渠道 → 全局。`""` 禁用并停止级联。`"auto"` 推导 `[{identity.name}]`。

**模板变量：**

| 变量              | 描述           | 示例                        |
| ----------------- | -------------- | --------------------------- |
| `{model}`         | 短模型名称     | `claude-opus-4-6`           |
| `{modelFull}`     | 完整模型标识符 | `anthropic/claude-opus-4-6` |
| `{provider}`      | 提供商名称     | `anthropic`                 |
| `{thinkingLevel}` | 当前思考级别   | `high`, `low`, `off`        |
| `{identity.name}` | 智能体身份名称 | （与 `"auto"` 相同）        |

变量不区分大小写。`{think}` 是 `{thinkingLevel}` 的别名。

### 确认反应

- 默认为活跃智能体的 `identity.emoji`，否则为 `"👀"`。设为 `""` 可禁用。
- 按渠道覆盖：`channels.<channel>.ackReaction`、`channels.<channel>.accounts.<id>.ackReaction`。
- 解析顺序：账户 → 渠道 → `messages.ackReaction` → 身份回退。
- 范围：`group-mentions`（默认）、`group-all`、`direct`、`all`。
- `removeAckAfterReply`：回复后移除确认（DingTalk/QQBot/Feishu/Feishu 独有）。

### 入站防抖

将同一发送者的快速纯文本消息批处理为单个智能体回合。媒体/附件立即刷新。控制命令绕过防抖。

### TTS（文本转语音）

```json5
{
  messages: {
    tts: {
      auto: "always", // off | always | inbound | tagged
      mode: "final", // final | all
      provider: "qwen3-tts",
      summaryModel: "openai/gpt-4.1-mini",
      modelOverrides: { enabled: true },
      maxTextLength: 4000,
      timeoutMs: 30000,
      prefsPath: "~/.crawclaw/settings/tts.json",
      providers: {
        "qwen3-tts": {
          enabled: true,
          runtime: "qwen-tts",
          baseUrl: "http://127.0.0.1:8013",
          profiles: {
            assistant: {
              voice: "Cherry",
              speed: 1.0,
            },
          },
        },
      },
    },
  },
}
```

- `auto` 控制自动 TTS。`/tts off|always|inbound|tagged` 按会话覆盖。
- `summaryModel` 覆盖 `agents.defaults.model.primary` 用于自动摘要。
- `modelOverrides` 默认启用；`modelOverrides.allowProvider` 默认为 `false`（选择启用）。
- Desktop 语音使用本地 `qwen3-tts` 原生提供商。默认产品运行时不会调用 ElevenLabs、Microsoft 或 OpenAI TTS API。
- 提供商特定设置位于 `messages.tts.providers.<provider>` 下。

---

## Talk

Talk 模式的默认值（macOS；已归档的移动运行时有单独兼容性默认值）。

```json5
{
  talk: {
    provider: "qwen3-tts",
    providers: {
      "qwen3-tts": {
        voiceId: "Cherry",
        outputFormat: "wav",
        voiceAliases: {
          assistant: "Cherry",
        },
      },
    },
    silenceTimeoutMs: 1500,
    interruptOnSpeech: true,
  },
}
```

- `talk.provider` 在配置了多个提供商时选择活跃的 Talk 提供商。
- `talk.providers.*.apiKey` 接受明文字符串或 SecretRef 对象，用于需要凭证的提供商。
- `talk.providers.*.voiceAliases` 允许 Talk 指令使用友好名称。
- `silenceTimeoutMs` 控制 Talk 模式在用户静默后等待多长时间才发送 transcript。未设置则保持平台默认暂停窗口（macOS 和 Android 为 `700 ms`，iOS 为 `900 ms`）。

---

## 工具

### 工具配置文件

`tools.profile` 在 `tools.allow`/`tools.deny` 之前设置基础白名单：

本地新手引导在未设置时将新本地配置默认设置为 `tools.profile: "coding"`
（保留现有显式配置文件）。记忆维护工具仅限特殊智能体；
新手引导不会为其添加 `main` 智能体的 `tools.alsoAllow` 覆盖。

部分工具在配置文件允许/拒绝策略之前有生命周期限制。运行时条件工具
仍需要其运行时/插件/渠道能力，`session_summary_file_read`、
`session_summary_file_edit` 等特殊智能体专用工具不是主智能体的默认项。

| 配置文件    | 包含内容                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `minimal`   | 仅 `session_status`                                                                                                          |
| `coding`    | `group:fs`, `group:runtime`, `group:web`, `sessions_spawn`, `sessions_yield`, `session_status`, `browser`, `discover_skills` |
| `messaging` | `group:messaging`, `session_status`                                                                                          |

### 工具组

| 组                      | 工具                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `group:runtime`         | `bash`, `process`, `grep`, `find`, `ls`                                                                                 |
| `group:fs`              | `read`, `write`, `edit`, `apply_patch`                                                                                  |
| `group:web`             | `web_search`, `web_fetch`                                                                                               |
| `group:sessions`        | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `sessions_yield`, `subagents`, `session_status` |
| `group:ui`              | `browser`, `canvas`                                                                                                     |
| `group:messaging`       | `message`                                                                                                               |
| `group:automation`      | `cron`, `gateway`                                                                                                       |
| `group:skills`          | `discover_skills`                                                                                                       |
| `group:workflow`        | `workflow`, `workflowize`                                                                                               |
| `group:review`          | `review_task`                                                                                                           |
| `group:memory`          | `knowledge_recall`, `knowledge_reflect`, `knowledge_ingest`, `knowledge_model_list`, `knowledge_model_create`           |
| `group:session_summary` | `session_summary_file_read`, `session_summary_file_edit`                                                                |
| `group:media`           | `image`, `pdf`, `tts`                                                                                                   |
| `group:crawclaw`        | 所有内置工具（不包含提供商插件）                                                                                        |

组展开不会绕过生命周期限制。例如，将 `group:memory` 添加到白名单不会向 `main` 暴露知识工具，
除非主机为当前轮次打开了这些工具，或者运行是匹配的特殊智能体。

### `tools.allow` / `tools.deny`

```json5
{
  tools: { deny: ["browser", "canvas"] },
}
```

### `tools.byProvider`

进一步限制特定提供商或模型的工具。顺序：基础配置文件 → 提供商配置文件 → allow/deny。

```json5
{
  tools: {
    profile: "coding",
    byProvider: {
      "google-antigravity": { profile: "minimal" },
      "openai/gpt-5.2": { allow: ["group:fs", "sessions_list"] },
    },
  },
}
```

### `tools.elevated`

控制提升权限（宿主机）执行访问：

```json5
{
  tools: {
    elevated: {
      enabled: true,
      allowFrom: {
        weixin: ["+15555550123"],
        qqbot: ["1234567890123", "987654321098765432"],
      },
    },
  },
}
```

- 按智能体覆盖（`agents.list[].tools.elevated`）只能进一步限制。
- `/elevated on|off|ask|full` 按会话存储状态；内联指令仅适用于单条消息。

### `tools.exec`

```json5
{
  tools: {
    exec: {
      backgroundMs: 10000,
      timeoutSec: 1800,
      cleanupMs: 1800000,
      notifyOnExit: true,
      notifyOnExitEmptySuccess: false,
      applyPatch: {
        enabled: false,
        allowModels: ["gpt-5.2"],
      },
    },
  },
}
```

### `tools.loopDetection`

工具循环安全检查**默认禁用**。设置 `enabled: true` 以激活检测。
设置可在全局 `tools.loopDetection` 中定义，并在 `agents.list[].tools.loopDetection` 按智能体覆盖。

```json5
{
  tools: {
    loopDetection: {
      enabled: true,
      historySize: 30,
      warningThreshold: 10,
      criticalThreshold: 20,
      globalCircuitBreakerThreshold: 30,
      detectors: {
        genericRepeat: true,
        knownPollNoProgress: true,
        pingPong: true,
      },
    },
  },
}
```

- `historySize`：用于循环分析的最大工具调用历史保留数。
- `warningThreshold`：警告的无进展重复模式阈值。
- `criticalThreshold`：阻止关键循环的更高重复阈值。
- `globalCircuitBreakerThreshold`：任何无进展运行的硬停止阈值。
- `detectors.genericRepeat`：对相同工具/相同参数重复调用发出警告。
- `detectors.knownPollNoProgress`：对已知轮询工具（`process.poll`、`command_status` 等）无进展发出警告/阻止。
- `detectors.pingPong`：对交替无进展配对模式发出警告/阻止。
- 如果 `warningThreshold >= criticalThreshold` 或 `criticalThreshold >= globalCircuitBreakerThreshold`，验证将失败。

### `tools.web`

```json5
{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "searxng",
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
      fetch: {
        enabled: true,
        maxChars: 50000,
        maxCharsCap: 50000,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        userAgent: "custom-ua",
      },
    },
  },
}
```

### `tools.media`

配置入站媒体理解（图像/音频/视频）：

```json5
{
  tools: {
    media: {
      concurrency: 2,
      audio: {
        enabled: true,
        maxBytes: 20971520,
        scope: {
          default: "deny",
          rules: [{ action: "allow", match: { chatType: "direct" } }],
        },
        models: [
          { provider: "openai", model: "gpt-4o-mini-transcribe" },
          { type: "cli", command: "whisper", args: ["--model", "base", "{{MediaPath}}"] },
        ],
      },
      video: {
        enabled: true,
        maxBytes: 52428800,
        models: [{ provider: "google", model: "gemini-3-flash-preview" }],
      },
    },
  },
}
```

<Accordion title="媒体模型条目字段">

**提供商条目**（`type: "provider"` 或省略）：

- `provider`：API 提供商 ID（`openai`、`anthropic`、`google`/`gemini`、`groq` 等）
- `model`：模型 ID 覆盖
- `profile` / `preferredProfile`：`auth-profiles.json` 配置文件选择

**CLI 条目**（`type: "cli"`）：

- `command`：要执行的可执行文件
- `args`：模板化参数（支持 `{{MediaPath}}`、`{{Prompt}}`、`{{MaxChars}}` 等）

**公共字段：**

- `capabilities`：可选列表（`image`、`audio`、`video`）。默认值：`openai`/`anthropic`/`minimax` → image，`google` → image+audio+video，`groq` → audio。
- `prompt`、`maxChars`、`maxBytes`、`timeoutSeconds`、`language`：按条目覆盖。
- 失败时回退到下一个条目。

提供商认证遵循标准顺序：`auth-profiles.json` → 环境变量 → `models.providers.*.apiKey`。

</Accordion>

### `tools.agentToAgent`

```json5
{
  tools: {
    agentToAgent: {
      enabled: false,
      allow: ["home", "work"],
    },
  },
}
```

### `tools.sessions`

控制哪些会话可被会话工具（`sessions_list`、`sessions_history`、`sessions_send`）作为目标。

默认值：`tree`（当前会话及其衍生的会话，例如子智能体）。

```json5
{
  tools: {
    sessions: {
      // "self" | "tree" | "agent" | "all"
      visibility: "tree",
    },
  },
}
```

说明：

- `self`：仅当前会话密钥。
- `tree`：当前会话及其派生的会话（子智能体）。
- `agent`：属于当前智能体 ID 的任何会话（如果你在同一智能体 ID 下运行按发送者划分的会话，也可能包含其他用户）。
- `all`：任何会话。跨智能体定位仍需要 `tools.agentToAgent`。

### `tools.sessions_spawn`

控制 `sessions_spawn` 的内联附件支持。

```json5
{
  tools: {
    sessions_spawn: {
      attachments: {
        enabled: false, // opt-in: set true to allow inline file attachments
        maxTotalBytes: 5242880, // 5 MB total across all files
        maxFiles: 50,
        maxFileBytes: 1048576, // 1 MB per file
        retainOnSessionKeep: false, // keep attachments when cleanup="keep"
      },
    },
  },
}
```

说明：

- 附件仅支持 `runtime: "subagent"`。ACP 运行时拒绝它们。
- 文件被物化到子工作区的 `.crawclaw/attachments/<uuid>/` 中，并附带 `.manifest.json`。
- 附件内容自动从 transcript 持久化中删除。
- Base64 输入通过严格的字母表/填充检查和预解码大小守卫进行验证。
- 目录权限为 `0700`，文件权限为 `0600`。
- 清理遵循 `cleanup` 策略：`delete` 始终删除附件；`keep` 仅在 `retainOnSessionKeep: true` 时保留。

### `agents.defaults.subagents`

```json5
{
  agents: {
    defaults: {
      subagents: {
        model: "minimax/MiniMax-M2.7",
        maxConcurrent: 8,
        runTimeoutSeconds: 900,
        archiveAfterMinutes: 60,
      },
    },
  },
}
```

- `model`：派生子智能体的默认模型。如果省略，子智能体继承调用者的模型。
- `runTimeoutSeconds`：`sessions_spawn` 的默认超时时间（秒），当工具调用省略 `runTimeoutSeconds` 时使用。`0` 表示无超时。
- 按子智能体的工具策略：`tools.subagents.tools.allow` / `tools.subagents.tools.deny`。

---

## 自定义提供商和 base URL

CrawClaw 使用内置模型目录。通过配置中的 `models.providers` 或 `~/.crawclaw/agents/<agentId>/agent/models.json` 添加自定义提供商。

```json5
{
  models: {
    mode: "merge", // merge (default) | replace
    providers: {
      "custom-proxy": {
        baseUrl: "http://localhost:4000/v1",
        apiKey: "LITELLM_KEY",
        api: "openai-completions", // openai-completions | openai-responses | anthropic-messages | google-generative-ai
        models: [
          {
            id: "llama-3.1-8b",
            name: "Llama 3.1 8B",
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
}
```

- 使用 `authHeader: true` + `headers` 满足自定义认证需求。
- 匹配提供商 ID 的合并优先级：
  - 非空智能体 `models.json` `baseUrl` 值优先。
  - 非空智能体 `apiKey` 值仅在该提供商在当前配置/认证配置文件上下文中未被 SecretRef 管理时才优先。
  - SecretRef 管理的提供商 `apiKey` 值从源标记刷新（环境引用的 `ENV_VAR_NAME`，文件/执行引用的 `secretref-managed`），而不是持久化解析后的密钥。
  - SecretRef 管理的提供商 header 值从源标记刷新（环境引用的 `secretref-env:ENV_VAR_NAME`，文件/执行引用的 `secretref-managed`）。
  - 空或缺失的智能体 `apiKey`/`baseUrl` 回退到配置中的 `models.providers`。
  - 仅显式配置的提供商模型条目写入智能体 `models.json`；运行时提供商元数据仍由 Rust 拥有。
  - 当你希望配置完全重写 `models.json` 时使用 `models.mode: "replace"`。
  - 标记持久化是源授权的：标记从活动源配置快照（预解析）写入，而非从解析后的运行时密钥值写入。

### 提供商字段详情

- `models.mode`：提供商目录行为（`merge` 或 `replace`）。
- `models.providers`：按提供商 ID 键控的自定义提供商映射。
- `models.providers.*.api`：请求适配器（`openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 等）。
- `models.providers.*.apiKey`：提供商凭证（优先使用 SecretRef/环境变量替换）。
- `models.providers.*.auth`：认证策略（`api-key`、`token`、`oauth`、`aws-sdk`）。
- `models.providers.*.injectNumCtxForOpenAICompat`：对于 Ollama + `openai-completions`，向请求中注入 `options.num_ctx`（默认：`true`）。
- `models.providers.*.authHeader`：需要时强制将凭证放在 `Authorization` header 中。
- `models.providers.*.baseUrl`：上游 API base URL。
- `models.providers.*.headers`：用于代理/租户路由的额外静态 headers。
- `models.providers.*.models`：显式提供商模型目录条目。
- `models.providers.*.models.*.compat.supportsDeveloperRole`：可选的兼容性提示。对于 `api: "openai-completions"` 且非空非原生 `baseUrl`（主机不是 `api.openai.com`）的情况，CrawClaw 在运行时强制将其设为 `false`。空/省略的 `baseUrl` 保持默认 OpenAI 行为。
- `models.bedrockDiscovery`：Bedrock 自动发现设置根。
- `models.bedrockDiscovery.enabled`：开启/关闭发现轮询。
- `models.bedrockDiscovery.region`：发现的 AWS 区域。
- `models.bedrockDiscovery.providerFilter`：目标发现的可选提供商 ID 过滤器。
- `models.bedrockDiscovery.refreshInterval`：发现刷新的轮询间隔。
- `models.bedrockDiscovery.defaultContextWindow`：发现模型的备用上下文窗口。
- `models.bedrockDiscovery.defaultMaxTokens`：发现模型的备用最大输出 token 数。

### 提供商示例

<Accordion title="Cerebras (GLM 4.6 / 4.7)">

```json5
{
  env: { CEREBRAS_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: {
        primary: "cerebras/zai-glm-4.7",
        fallbacks: ["cerebras/zai-glm-4.6"],
      },
      models: {
        "cerebras/zai-glm-4.7": { alias: "GLM 4.7 (Cerebras)" },
        "cerebras/zai-glm-4.6": { alias: "GLM 4.6 (Cerebras)" },
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      cerebras: {
        baseUrl: "https://api.cerebras.ai/v1",
        apiKey: "${CEREBRAS_API_KEY}",
        api: "openai-completions",
        models: [
          { id: "zai-glm-4.7", name: "GLM 4.7 (Cerebras)" },
          { id: "zai-glm-4.6", name: "GLM 4.6 (Cerebras)" },
        ],
      },
    },
  },
}
```

使用 `cerebras/zai-glm-4.7` 连接 Cerebras；使用 `zai/glm-4.7` 连接 Z.AI 直连。

</Accordion>

<Accordion title="OpenCode">

```json5
{
  agents: {
    defaults: {
      model: { primary: "opencode/claude-opus-4-6" },
      models: { "opencode/claude-opus-4-6": { alias: "Opus" } },
    },
  },
}
```

设置 `OPENCODE_API_KEY`（或 `OPENCODE_ZEN_API_KEY`）。使用 `opencode/...` 引用 Zen 目录，或 `opencode-go/...` 引用 Go 目录。通过 CrawClaw Desktop 或本地 Gateway API 配置。

</Accordion>

<Accordion title="Z.AI (GLM-4.7)">

```json5
{
  agents: {
    defaults: {
      model: { primary: "zai/glm-4.7" },
      models: { "zai/glm-4.7": {} },
    },
  },
}
```

设置 `ZAI_API_KEY`。接受 `z.ai/*` 和 `z-ai/*` 作为别名。通过 CrawClaw Desktop 或本地 Gateway API 配置。

- 通用端点：`https://api.z.ai/api/paas/v4`
- 编程端点（默认）：`https://api.z.ai/api/coding/paas/v4`
- 对于通用端点，使用 base URL 覆盖定义自定义提供商。

</Accordion>

<Accordion title="Moonshot AI (Kimi)">

```json5
{
  env: { MOONSHOT_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "moonshot/kimi-k2.5" },
      models: { "moonshot/kimi-k2.5": { alias: "Kimi K2.5" } },
    },
  },
  models: {
    mode: "merge",
    providers: {
      moonshot: {
        baseUrl: "https://api.moonshot.ai/v1",
        apiKey: "${MOONSHOT_API_KEY}",
        api: "openai-completions",
        models: [
          {
            id: "kimi-k2.5",
            name: "Kimi K2.5",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 256000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

中国端点：`baseUrl: "https://api.moonshot.cn/v1"` 或通过 CrawClaw Desktop 或本地 Gateway API 配置。

</Accordion>

<Accordion title="Kimi Coding">

```json5
{
  env: { KIMI_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "kimi-coding/k2p5" },
      models: { "kimi-coding/k2p5": { alias: "Kimi K2.5" } },
    },
  },
}
```

Anthropic 兼容的内置提供商。通过 CrawClaw Desktop 或本地 Gateway API 配置。

</Accordion>

<Accordion title="Synthetic (Anthropic 兼容)">

```json5
{
  env: { SYNTHETIC_API_KEY: "sk-..." },
  agents: {
    defaults: {
      model: { primary: "synthetic/hf:MiniMaxAI/MiniMax-M2.5" },
      models: { "synthetic/hf:MiniMaxAI/MiniMax-M2.5": { alias: "MiniMax M2.5" } },
    },
  },
  models: {
    mode: "merge",
    providers: {
      synthetic: {
        baseUrl: "https://api.synthetic.new/anthropic",
        apiKey: "${SYNTHETIC_API_KEY}",
        api: "anthropic-messages",
        models: [
          {
            id: "hf:MiniMaxAI/MiniMax-M2.5",
            name: "MiniMax M2.5",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 192000,
            maxTokens: 65536,
          },
        ],
      },
    },
  },
}
```

Base URL 应省略 `/v1`（Anthropic 客户端会追加）。通过 CrawClaw Desktop 或本地 Gateway API 配置。

</Accordion>

<Accordion title="MiniMax M2.7（直连）">

```json5
{
  agents: {
    defaults: {
      model: { primary: "minimax/MiniMax-M2.7" },
      models: {
        "minimax/MiniMax-M2.7": { alias: "Minimax" },
      },
    },
  },
  models: {
    mode: "merge",
    providers: {
      minimax: {
        baseUrl: "https://api.minimax.io/anthropic",
        apiKey: "${MINIMAX_API_KEY}",
        api: "anthropic-messages",
        models: [
          {
            id: "MiniMax-M2.7",
            name: "MiniMax M2.7",
            reasoning: true,
            input: ["text"],
            cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.12 },
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

设置 `MINIMAX_API_KEY`。通过 CrawClaw Desktop 或本地 Gateway API 配置。
模型目录现在默认仅 M2.7。

</Accordion>

<Accordion title="本地模型（LM Studio）">

请参阅[本地模型](/gateway/local-models)。简而言之：通过 LM Studio Responses API 在高性能硬件上运行大型本地模型；保持托管模型合并作为回退。

</Accordion>

---

## Skills

```json5
{
  skills: {
    allowBundled: ["gemini", "peekaboo"],
    load: {
      extraDirs: ["~/Projects/agent-scripts/skills"],
    },
    install: {
      preferBrew: true,
      nodeManager: "npm", // npm | pnpm | yarn
    },
    entries: {
      "image-lab": {
        apiKey: { source: "env", provider: "default", id: "GEMINI_API_KEY" }, // 或明文字符串
        env: { GEMINI_API_KEY: "GEMINI_KEY_HERE" },
      },
      peekaboo: { enabled: true },
      sag: { enabled: false },
    },
  },
}
```

- `allowBundled`：仅针对捆绑 Skills 的可选允许列表（managed/workspace Skills 不受影响）。
- `entries.<skillKey>.enabled: false` 即使 Skills 已捆绑/安装也会禁用该 Skill。
- `entries.<skillKey>.apiKey`：为声明主要环境变量的 Skills 提供的便捷方式（明文字符串或 SecretRef 对象）。

---

## 插件

```json5
{
  plugins: {
    enabled: true,
    allow: ["my-plugin"],
    deny: [],
    load: {
      paths: ["~/Projects/oss/my-plugin"],
    },
    entries: {
      "my-plugin": {
        enabled: true,
        config: {},
      },
    },
  },
}
```

- 从 `~/.crawclaw/extensions`、`<workspace>/.crawclaw/extensions` 以及 `plugins.load.paths` 加载。
- 发现机制通过 Rust 运行时注册表接受原生 CrawClaw 插件。
- 配置变更通过 Gateway 网关实时重配置应用。
- `allow`：可选白名单（仅加载列出的插件）。`deny` 优先。
- `plugins.entries.<id>.apiKey`：插件级 API 密钥便利字段（当插件支持时）。
- `plugins.entries.<id>.env`：插件作用域的环境变量映射。
- `plugins.entries.<id>.subagent.allowModelOverride`：显式信任此插件请求后台子智能体运行时的 `provider` 和 `model` 覆盖。
- `plugins.entries.<id>.subagent.allowedModels`：可信子智能体覆盖的规范 `provider/model` 目标可选白名单。仅在你有意允许任何模型时使用 `"*"`。
- `plugins.entries.<id>.config`：插件定义的配置对象（当有原生 CrawClaw 插件 schema 时进行验证）。
- `plugins.installs`：CrawClaw Desktop 或本地 Gateway API 使用的 CLI 管理安装元数据。
  - 包含 `source`、`spec`、`sourcePath`、`installPath`、`version`、`resolvedName`、`resolvedVersion`、`resolvedSpec`、`integrity`、`shasum`、`resolvedAt`、`installedAt`。
  - 将 `plugins.installs.*` 视为托管状态；优先使用 Desktop 和 Gateway API 操作而非手动编辑。

参见[插件](/tools/plugin)。

---

## 浏览器

```json5
{
  browser: {
    enabled: true,
    evaluateEnabled: true,
    defaultProfile: "crawclaw",
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: true, // 默认信任网络模式
      // allowPrivateNetwork: true, // 旧版别名
      // hostnameAllowlist: ["*.example.com", "example.com"],
      // allowedHostnames: ["localhost"],
    },
    profiles: {
      crawclaw: { color: "#FF4500" },
      work: { color: "#0066CC" },
    },
    color: "#FF4500",
    // headless: false,
    // extraArgs: [],
  },
}
```

- `evaluateEnabled: false` 禁用 `act:evaluate` 和 `wait --fn`。
- `ssrfPolicy.dangerouslyAllowPrivateNetwork` 未设置时默认为 `true`（信任网络模式）。
- 设置 `ssrfPolicy.dangerouslyAllowPrivateNetwork: false` 可启用严格的仅公有网络浏览器导航。
- `ssrfPolicy.allowPrivateNetwork` 仍作为旧版别名受支持。
- 在严格模式下，使用 `ssrfPolicy.hostnameAllowlist` 和 `ssrfPolicy.allowedHostnames` 进行明确例外配置。
- 控制服务：仅限 local loopback（端口从 `gateway.port` 派生，默认 `18791`）。
- 捆绑的浏览器工具由 Rust 原生插件注册表注册，并使用托管的 `agent-browser` 运行时。

---

## Gateway 网关

```json5
{
  gateway: {
    mode: "local", // local | remote
    port: 18789,
    bind: "loopback",
    auth: {
      mode: "token", // none | token | password | trusted-proxy
      token: "your-token",
      // password: "your-password", // or CRAWCLAW_GATEWAY_PASSWORD
      // trustedProxy: { userHeader: "x-forwarded-user" }, // for mode=trusted-proxy; see /gateway/trusted-proxy-auth
      allowTailscale: true,
      rateLimit: {
        maxAttempts: 10,
        windowMs: 60000,
        lockoutMs: 300000,
        exemptLoopback: true,
      },
    },
    tailscale: {
      mode: "off", // off | serve | funnel
      resetOnExit: false,
    },
    browserClients: {
      enabled: true,
      basePath: "/crawclaw",
      // allowedOrigins: ["https://control.example.com"], // required for non-loopback browser-client access
      // dangerouslyAllowHostHeaderOriginFallback: false, // dangerous Host-header origin fallback mode
      // allowInsecureAuth: false,
    },
    remote: {
      url: "ws://gateway.tailnet:18789",
      transport: "ssh", // ssh | direct
      token: "your-token",
      // password: "your-password",
    },
    trustedProxies: ["10.0.0.1"],
    // Optional. Default false.
    allowRealIpFallback: false,
    tools: {
      // Additional /tools/invoke HTTP denies
      deny: ["browser"],
      // Remove tools from the default HTTP deny list
      allow: ["gateway"],
    },
  },
}
```

<Accordion title="Gateway 字段详情">

- `mode`：`local`（运行网关）或 `remote`（连接远程网关）。除非是 `local`，否则 Gateway 网关拒绝启动。
- `port`：WS + HTTP 复用的单一端口。优先级：`--port` > `CRAWCLAW_GATEWAY_PORT` > `gateway.port` > `18789`。
- `bind`：`auto`、`loopback`（默认）、`lan`（`0.0.0.0`）、`tailnet`（仅 Tailscale IP）或 `custom`。
- **旧版绑定别名**：在 `gateway.bind` 中使用绑定模式值（`auto`、`loopback`、`lan`、`tailnet`、`custom`），而非主机别名（`0.0.0.0`、`127.0.0.1`、`localhost`、`::`、`::1`）。
- **认证**：默认必须认证。非 loopback 绑定需要共享的 token/password。CrawClaw Desktop 可在设置期间生成 token。
- 如果同时配置了 `gateway.auth.token` 和 `gateway.auth.password`（包括 SecretRefs），需显式设置 `gateway.auth.mode` 为 `token` 或 `password`。当两者均已配置且 mode 未设置时，启动和服务安装/修复流程将失败。
- `gateway.auth.mode: "none"`：显式无认证模式。仅用于可信的 local loopback 设置；新手引导不会提供此选项。
- `gateway.auth.mode: "trusted-proxy"`：将认证委托给身份感知反向代理，并信任来自 `gateway.trustedProxies` 的身份头（参见[可信代理认证](/gateway/trusted-proxy-auth)）。
- `gateway.auth.allowTailscale`：当为 `true` 时，Tailscale Serve 身份头可满足浏览器客户端/WebSocket 认证（通过 `tailscale whois` 验证）；HTTP API 端点仍需 token/password 认证。此无 token 流程假设网关主机是可信的。当 `tailscale.mode = "serve"` 时默认为 `true`。
- `gateway.auth.rateLimit`：可选的失败认证限制器。按客户端 IP 和认证范围应用。被阻止的尝试返回 `429` + `Retry-After`。
  - `gateway.auth.rateLimit.exemptLoopback` 默认为 `true`；当你有意要让 localhost 流量也被限速时（用于测试设置或严格代理部署）可设置为 `false`。
- 浏览器来源的 WS 认证尝试始终被限速，loopback 豁免被禁用（纵深防御，抵御基于浏览器的 localhost 暴力破解）。
- `tailscale.mode`：`serve`（仅 tailnet，loopback 绑定）或 `funnel`（公开，需要认证）。
- `browserClients.allowedOrigins`：Gateway WebSocket 连接的显式浏览器来源白名单。当浏览器客户端预期来自非 loopback 来源时需要。
- `browserClients.dangerouslyAllowHostHeaderOriginFallback`：危险模式，启用 Host 头来源回退，用于有意依赖 Host 头来源策略的部署。
- `remote.transport`：`ssh`（默认）或 `direct`（ws/wss）。对于 `direct`，`remote.url` 必须为 `ws://` 或 `wss://`。
- `CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS=1`：客户端断路器覆盖，允许明文 `ws://` 到可信私有网络 IP；默认仍仅对 loopback 的明文保持限制。
- `gateway.remote.token` / `.password` 是远程客户端凭证字段。它们本身不配置网关认证。
- `gateway.channelHealthCheckMinutes`：渠道健康监控间隔（分钟）。设置为 `0` 可全局禁用健康监控重启。默认值：`5`。
- `gateway.channelStaleEventThresholdMinutes`：僵尸套接字阈值（分钟）。保持此值大于或等于 `gateway.channelHealthCheckMinutes`。默认值：`30`。
- `gateway.channelMaxRestartsPerHour`：滚动一小时内每个渠道/账号的最大健康监控重启次数。默认值：`10`。
- `channels.<provider>.healthMonitor.enabled`：在保持全局监控启用的同时，按渠道选择退出健康监控重启。
- `channels.<provider>.accounts.<accountId>.healthMonitor.enabled`：多账号渠道的按账号覆盖。设置后优先于渠道级覆盖。
- 本地网关调用路径仅在 `gateway.auth.*` 未设置时才能使用 `gateway.remote.*` 作为回退。
- 如果 `gateway.auth.token` / `gateway.auth.password` 通过 SecretRef 显式配置且未解析，则解析失败关闭（无远程回退掩盖）。
- `trustedProxies`：终止 TLS 的反向代理 IP。只列出你控制的代理。
- `allowRealIpFallback`：当为 `true` 时，如果 `X-Forwarded-For` 缺失则接受 `X-Real-IP`。默认为 `false`（默认失败关闭行为）。
- `gateway.tools.deny`：HTTP `POST /tools/invoke` 额外阻止的工具名（扩展默认拒绝列表）。
- `gateway.tools.allow`：从默认 HTTP 拒绝列表中移除的工具名。

</Accordion>

### OpenAI 兼容端点

- Chat Completions：默认禁用。通过 `gateway.http.endpoints.chatCompletions.enabled: true` 启用。
- Responses API：`gateway.http.endpoints.responses.enabled`。
- Rust 原生 Responses 端点当前仅支持文本。这些 URL 输入加固密钥预留用于启用文件或图像输入的部署：
  - `gateway.http.endpoints.responses.maxUrlParts`
  - `gateway.http.endpoints.responses.files.urlAllowlist`
  - `gateway.http.endpoints.responses.images.urlAllowlist`
    空白名单视为未设置；使用 `gateway.http.endpoints.responses.files.allowUrl=false`
    和/或 `gateway.http.endpoints.responses.images.allowUrl=false` 来禁用 URL 获取。
- 可选响应加固头：
  - `gateway.http.securityHeaders.strictTransportSecurity`（仅为控制的 HTTPS 来源设置；参见[可信代理认证](/gateway/trusted-proxy-auth#tls-termination-and-hsts)）

### 多实例隔离

在同一主机上运行多个网关，使用唯一端口和状态目录：

```bash
CRAWCLAW_CONFIG_PATH=~/.crawclaw/a.json \
CRAWCLAW_STATE_DIR=~/.crawclaw-a \
cargo run -q -p crawclaw-gateway -- --bind loopback --port 18789
```

对于本地开发，为每个实例显式设置 `CRAWCLAW_STATE_DIR` 和 `--port`。

参见[多网关](/gateway/multiple-gateways)。

### `gateway.tls`

```json5
{
  gateway: {
    tls: {
      enabled: false,
      autoGenerate: false,
      certPath: "/etc/crawclaw/tls/server.crt",
      keyPath: "/etc/crawclaw/tls/server.key",
      caPath: "/etc/crawclaw/tls/ca-bundle.crt",
    },
  },
}
```

- `enabled`：在网关监听器启用 TLS 终止（HTTPS/WSS）（默认：`false`）。
- `autoGenerate`：当未配置显式文件时自动生成本地自签名证书/密钥对；仅用于本地/开发。
- `certPath`：TLS 证书文件的文件系统路径。
- `keyPath`：TLS 私钥文件的文件系统路径；保持权限受限。
- `caPath`：用于客户端验证或自定义信任链的可选 CA 证书包路径。

## 钩子

```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
    maxBodyBytes: 262144,
    defaultSessionKey: "hook:ingress",
    allowRequestSessionKey: false,
    allowedSessionKeyPrefixes: ["hook:"],
    allowedAgentIds: ["hooks", "main"],
    presets: ["gmail"],
    transformsDir: "~/.crawclaw/hooks/transforms",
    mappings: [
      {
        match: { path: "gmail" },
        action: "agent",
        agentId: "hooks",
        wakeMode: "now",
        name: "Gmail",
        sessionKey: "hook:gmail:{{messages[0].id}}",
        messageTemplate: "From: {{messages[0].from}}\nSubject: {{messages[0].subject}}\n{{messages[0].snippet}}",
        deliver: true,
        channel: "last",
        model: "openai/gpt-5.2-mini",
      },
    ],
  },
}
```

认证：`Authorization: Bearer <token>` 或 `x-crawclaw-token: <token>`。

**端点：**

- `POST /hooks/wake` → `{ text, mode?: "now" }`
- `POST /hooks/agent` → `{ message, name?, agentId?, sessionKey?, wakeMode?, deliver?, channel?, to?, model?, thinking?, timeoutSeconds? }`
  - 仅在 `hooks.allowRequestSessionKey=true` 时接受请求 payload 中的 `sessionKey`（默认：`false`）。
- `POST /hooks/<name>` → 通过 `hooks.mappings` 解析

<Accordion title="映射详情">

- `match.path` 匹配 `/hooks` 后的子路径（例如 `/hooks/gmail` → `gmail`）。
- `match.source` 匹配通用路径的 payload 字段。
- `{{messages[0].subject}}` 等模板从 payload 中读取。
- `transform` 可指向返回钩子动作的 JS/TS 模块。
  - `transform.module` 必须是相对路径，且位于 `hooks.transformsDir` 内（绝对路径和路径遍历将被拒绝）。
- `agentId` 路由到特定智能体；未知 ID 回退到默认智能体。
- `allowedAgentIds`：限制显式路由（`*` 或省略 = 允许所有，`[]` = 拒绝所有）。
- `defaultSessionKey`：钩子智能体运行（无显式 `sessionKey` 时）使用的可选固定会话密钥。
- `allowRequestSessionKey`：允许 `/hooks/agent` 调用方设置 `sessionKey`（默认：`false`）。
- `allowedSessionKeyPrefixes`：显式 `sessionKey` 值（请求 + 映射）的可选前缀允许列表，例如 `["hook:"]`。
- `deliver: true` 将最终回复发送到渠道；`channel` 默认为 `last`。
- `model` 覆盖此钩子运行的 LLM（如果设置了模型目录则必须在允许列表中）。

</Accordion>

### Gmail 集成

```json5
{
  hooks: {
    gmail: {
      account: "crawclaw@gmail.com",
      topic: "projects/<project-id>/topics/gog-gmail-watch",
      subscription: "gog-gmail-watch-push",
      pushToken: "shared-push-token",
      hookUrl: "http://127.0.0.1:18789/hooks/gmail",
      includeBody: true,
      maxBytes: 20000,
      renewEveryMinutes: 720,
      serve: { bind: "127.0.0.1", port: 8788, path: "/" },
      tailscale: { mode: "funnel", path: "/gmail-pubsub" },
      model: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      thinking: "off",
    },
  },
}
```

- CrawClaw 通过常规 `/hooks/gmail` 映射路径接收 Gmail PubSub 回调。从你自己的服务管理器运行和续订 `gog gmail watch serve`，然后将其推送 URL 指向配置的 CrawClaw 钩子 URL。

---

## 设备发现

### mDNS (Bonjour)

```json5
{
  discovery: {
    mdns: {
      mode: "minimal", // minimal | full | off
    },
  },
}
```

- `minimal`（默认）：从 TXT 记录中省略 `sshPort`。
- `full`：包含 `sshPort`。
- 主机名默认为 `crawclaw`。使用 `CRAWCLAW_MDNS_HOSTNAME` 覆盖。

### 广域网（DNS-SD）

```json5
{
  discovery: {
    wideArea: { enabled: true },
  },
}
```

在 `~/.crawclaw/dns/` 下写入单播 DNS-SD 区域。对于跨网络发现，请配合 DNS 服务器（推荐 CoreDNS）+ Tailscale 分割 DNS 使用。

设置：通过 CrawClaw Desktop 或本地 Gateway API 配置。

---

## 环境

### `env`（内联环境变量）

```json5
{
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
}
```

- 仅当进程环境变量中缺少该键时，才会应用内联环境变量。
- `.env` 文件：CWD `.env` + `~/.crawclaw/.env`（两者都不会覆盖已存在的变量）。
- `shellEnv`：从你的登录 shell 配置中导入缺失的预期键。
- 完整优先级参见[环境变量](/help/environment)。

### 环境变量替换

在任意配置字符串中通过 `${VAR_NAME}` 引用环境变量：

```json5
{
  gateway: {
    auth: { token: "${CRAWCLAW_GATEWAY_TOKEN}" },
  },
}
```

- 仅匹配大写名称：`[A-Z_][A-Z0-9_]*`。
- 缺失/空变量在配置加载时抛出错误。
- 使用 `$${VAR}` 转义得到字面量 `${VAR}`。
- 可与 `$include` 配合使用。

---

## 密钥管理

SecretRef 是增量式的：明文值仍然有效。

### `SecretRef`

使用以下对象格式：

```json5
{ source: "env" | "file" | "exec", provider: "default", id: "..." }
```

验证规则：

- `provider` 格式：`^[a-z][a-z0-9_-]{0,63}$`
- `source: "env"` id 格式：`^[A-Z][A-Z0-9_]{0,127}$`
- `source: "file"` id：绝对 JSON 指针（例如 `"/providers/openai/apiKey"`）
- `source: "exec"` id 格式：`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$`
- `source: "exec"` id 不得包含 `.` 或 `..` 斜杠分隔的路径段（例如 `a/../b` 被拒绝）

### 支持的凭证范围

- 规范矩阵：[SecretRef 凭证范围](/reference/secretref-credential-surface)
- `secrets apply` 目标支持 `crawclaw.json` 凭证路径。
- `auth-profiles.json` ref 包含在运行时解析和审计覆盖中。

### 密钥提供商配置

```json5
{
  secrets: {
    providers: {
      default: { source: "env" }, // optional explicit env provider
      filemain: {
        source: "file",
        path: "~/.crawclaw/secrets.json",
        mode: "json",
        timeoutMs: 5000,
      },
      vault: {
        source: "exec",
        command: "/usr/local/bin/crawclaw-vault-resolver",
        passEnv: ["PATH", "VAULT_ADDR"],
      },
    },
    defaults: {
      env: "default",
      file: "filemain",
      exec: "vault",
    },
  },
}
```

注意事项：

- `file` 提供商支持 `mode: "json"` 和 `mode: "singleValue"`（singleValue 模式下 `id` 必须为 `"value"`）。
- `exec` 提供商需要绝对 `command` 路径，并使用协议负载在 stdin/stdout 上通信。
- 默认情况下，符号链接命令路径被拒绝。设置 `allowSymlinkCommand: true` 以允许符号链接路径，同时验证解析后的目标路径。
- 若配置了 `trustedDirs`，则对解析后的目标路径应用受信任目录检查。
- `exec` 子环境默认最小化；使用 `passEnv` 显式传递所需变量。
- SecretRef 在激活时解析到内存快照，之后请求路径仅读取该快照。
- 激活时应用活动范围过滤：启用范围上未解析的 ref 会导致启动/重载失败，而非活动范围则跳过并记录诊断。

---

## 凭证存储

```json5
{
  auth: {
    profiles: {
      "anthropic:me@example.com": { provider: "anthropic", mode: "oauth", email: "me@example.com" },
      "anthropic:work": { provider: "anthropic", mode: "api_key" },
    },
    order: {
      anthropic: ["anthropic:me@example.com", "anthropic:work"],
    },
  },
}
```

- 每个智能体的配置文件存储在 `<agentDir>/auth-profiles.json`。
- `auth-profiles.json` 支持值级引用（`api_key` 用 `keyRef`，`token` 用 `tokenRef`）用于静态凭证模式。
- OAuth 模式配置文件（`auth.profiles.<id>.mode = "oauth"`）不支持 SecretRef 支持的凭证配置文件。
- 静态运行时凭证来自内存中已解析的快照；发现时会清除旧版静态 `auth.json` 条目。
- 从 `~/.crawclaw/credentials/oauth.json` 导入旧版 OAuth。
- 参见 [OAuth](/concepts/oauth)。
- 密钥运行时行为和 `audit/configure/apply` 工具：[密钥管理](/gateway/secrets)。

### `auth.cooldowns`

```json5
{
  auth: {
    cooldowns: {
      billingBackoffHours: 5,
      billingBackoffHoursByProvider: { anthropic: 3, openai: 8 },
      billingMaxHours: 24,
      failureWindowHours: 24,
      overloadedProfileRotations: 1,
      overloadedBackoffMs: 0,
      rateLimitedProfileRotations: 1,
    },
  },
}
```

- `billingBackoffHours`：配置文件因计费/额度不足失败时的基础退避时间（小时）（默认：`5`）。
- `billingBackoffHoursByProvider`：计费退避小时数的可选按提供商覆盖。
- `billingMaxHours`：计费退避指数增长的时间上限（小时）（默认：`24`）。
- `failureWindowHours`：用于退避计数器的滚动时间窗口（小时）（默认：`24`）。
- `overloadedProfileRotations`：过载错误在切换到模型回退之前同一提供商凭证配置文件的最大轮换次数（默认：`1`）。
- `overloadedBackoffMs`：重试过载提供商/配置文件轮换之前的固定延迟（默认：`0`）。
- `rateLimitedProfileRotations`：限流错误在切换到模型回退之前同一提供商凭证配置文件的最大轮换次数（默认：`1`）。

---

## 日志

```json5
{
  logging: {
    level: "info",
    file: "/tmp/crawclaw/crawclaw.log",
    consoleLevel: "info",
    consoleStyle: "pretty", // pretty | compact | json
    redactSensitive: "tools", // off | tools
    redactPatterns: ["\\bTOKEN\\b\\s*[=:]\\s*([\"']?)([^\\s\"']+)\\1"],
  },
}
```

- 默认日志文件：`/tmp/crawclaw/crawclaw-YYYY-MM-DD.log`。
- 设置 `logging.file` 以获得稳定路径。
- 使用 `--verbose` 时 `consoleLevel` 提升到 `debug`。
- `maxFileBytes`：写入被禁止前的最大日志文件大小（正整数；默认值：`524288000` = 500 MB）。生产部署使用外部日志轮转。

---

## 诊断

```json5
{
  diagnostics: {
    enabled: true,
    flags: ["feishu.*"],
    stuckSessionWarnMs: 30000,

    otel: {
      enabled: false,
      endpoint: "https://otel-collector.example.com:4318",
      protocol: "http/protobuf", // http/protobuf | grpc
      headers: { "x-tenant-id": "my-org" },
      serviceName: "crawclaw-gateway",
      traces: true,
      metrics: true,
      logs: false,
      sampleRate: 1.0,
      flushIntervalMs: 5000,
    },

    cacheTrace: {
      enabled: false,
      includeMessages: true,
      includePrompt: true,
      includeSystem: true,
    },
  },
}
```

- `enabled`：检测输出的主开关（默认：`true`）。
- `flags`：启用目标日志输出的标志字符串数组（支持通配符如 `"feishu.*"` 或 `"*"`）。
- `stuckSessionWarnMs`：会话保持处理状态时发出卡住会话警告的年龄阈值（毫秒）。
- `otel.enabled`：启用 OpenTelemetry 导出管道（默认：`false`）。
- `otel.endpoint`：OTel 导出的收集器 URL。
- `otel.protocol`：`"http/protobuf"`（默认）或 `"grpc"`。
- `otel.headers`：随 OTel 导出请求发送的额外 HTTP/gRPC 元数据头。
- `otel.serviceName`：资源属性的服务名称。
- `otel.traces` / `otel.metrics` / `otel.logs`：启用跟踪、指标或日志导出。
- `otel.sampleRate`：跟踪采样率 `0`–`1`。
- `otel.flushIntervalMs`：定期遥测刷新间隔（毫秒）。
- `cacheTrace.enabled`：为嵌入式运行记录缓存跟踪快照（默认：`false`）。
- `cacheTrace.includeMessages` / `includePrompt` / `includeSystem`：控制缓存跟踪输出中包含的内容（均默认：`true`）。

---

## 更新

```json5
{
  update: {
    channel: "stable", // stable | beta | dev
    checkOnStart: true,

    auto: {
      enabled: false,
      stableDelayHours: 6,
      stableJitterHours: 12,
      betaCheckIntervalHours: 1,
    },
  },
}
```

- `channel`：npm/git 安装的发布通道——`"stable"`、`"beta"` 或 `"dev"`。
- `checkOnStart`：Gateway 启动时检查 npm 更新（默认：`true`）。
- `auto.enabled`：启用包安装的后台自动更新（默认：`false`）。
- `auto.stableDelayHours`：stable 通道自动应用前的最小延迟小时数（默认：`6`；最大：`168`）。
- `auto.stableJitterHours`：额外的 stable 通道发布扩散窗口小时数（默认：`12`；最大：`168`）。
- `auto.betaCheckIntervalHours`：beta 通道检查的运行频率小时数（默认：`1`；最大：`24`）。

---

## ACP

```json5
{
  acp: {
    enabled: false,
    dispatch: { enabled: true },
    backend: "acpx",
    defaultAgent: "main",
    allowedAgents: ["main", "ops"],
    maxConcurrentSessions: 10,

    stream: {
      coalesceIdleMs: 50,
      maxChunkChars: 1000,
      repeatSuppression: true,
      deliveryMode: "live", // live | final_only
      hiddenBoundarySeparator: "paragraph", // none | space | newline | paragraph
      maxOutputChars: 50000,
      maxSessionUpdateChars: 500,
    },

    runtime: {
      ttlMinutes: 30,
    },
  },
}
```

- `enabled`：全局 ACP 功能门控（默认：`false`）。
- `dispatch.enabled`：ACP 会话轮次调度的独立门控（默认：`true`）。设为 `false` 可保持 ACP 命令可用，同时阻止执行。
- `backend`：默认 ACP 运行时后端 ID（必须与已注册的 ACP 运行时插件匹配）。
- `defaultAgent`：当衍生项未指定明确目标时的回退 ACP 目标智能体 ID。
- `allowedAgents`：ACP 运行时会话允许的智能体 ID 允许列表；空表示无额外限制。
- `maxConcurrentSessions`：最大并发活跃 ACP 会话数。
- `stream.coalesceIdleMs`：流式文本的空闲刷新窗口（毫秒）。
- `stream.maxChunkChars`：分割流式块投射前的最大块大小。
- `stream.repeatSuppression`：抑制每轮重复的状态/工具行（默认：`true`）。
- `stream.deliveryMode`：`"live"` 增量流式传输；`"final_only"` 缓冲至轮次终止事件。
- `stream.hiddenBoundarySeparator`：隐藏工具事件后可见文本前的分隔符（默认：`"paragraph"`）。
- `stream.maxOutputChars`：每个 ACP 轮次投射的最大助手输出字符数。
- `stream.maxSessionUpdateChars`：投射的 ACP 状态/更新行的最大字符数。
- `runtime.ttlMinutes`：ACP 会话工作线程在符合清理条件前的空闲 TTL（分钟）。

---

## 终端

```json5
{
  cli: {
    banner: {
      taglineMode: "off", // random | default | off
    },
  },
}
```

- `cli.banner.taglineMode` 控制终端横幅标语的保留样式：
  - `"random"`（默认）：轮换有趣/季节性标语。
  - `"default"`：固定中性标语（`All your chats, one CrawClaw.`）。
  - `"off"`：不显示标语文本（仍显示横幅标题/版本）。
- 若要隐藏整个横幅（不仅仅是标语），请设置环境变量 `CRAWCLAW_HIDE_BANNER=1`。

---

## 身份

参见 `agents.list` 身份字段，位于[智能体默认值](#agent-defaults)。

---

## Bridge（传统，已移除）

当前版本不再包含 TCP bridge。`bridge.*` 键不再是配置 schema 的一部分（验证失败直到移除；CrawClaw Desktop 或本地 Gateway API 可以剥离未知键）。

<Accordion title="传统 bridge 配置（历史参考）">

```json
{
  "bridge": {
    "enabled": true,
    "port": 18790,
    "bind": "tailnet",
    "tls": {
      "enabled": true,
      "autoGenerate": true
    }
  }
}
```

</Accordion>

---

## Cron

```json5
{
  cron: {
    enabled: true,
    maxConcurrentRuns: 2,
    webhook: "https://example.invalid/legacy", // deprecated fallback for stored notify:true jobs
    webhookToken: "replace-with-dedicated-token", // optional bearer token for outbound webhook auth
    sessionRetention: "24h", // duration string or false
    runLog: {
      maxBytes: "2mb", // default 2_000_000 bytes
      keepLines: 2000, // default 2000
    },
  },
}
```

- `sessionRetention`：在从 `sessions.json` 修剪之前，保留已完成的隔离 cron 运行会话的时长。同时控制已归档已删除 cron 记录的清理。默认值：`24h`；设为 `false` 可禁用。
- `runLog.maxBytes`：运行日志文件（`cron/runs/<jobId>.jsonl`）在修剪前的最大大小。默认值：`2_000_000` 字节。
- `runLog.keepLines`：触发运行日志修剪时保留的最新行数。默认值：`2000`。
- `webhookToken`：用于 cron webhook POST 投递的 bearer 令牌（`delivery.mode = "webhook"`），若省略则不发送认证 header。
- `webhook`：已废弃的传统回退 webhook URL（http/https），仅用于仍具有 `notify: true` 的已存储任务。

### `cron.retry`

```json5
{
  cron: {
    retry: {
      maxAttempts: 3,
      backoffMs: [30000, 60000, 300000],
      retryOn: ["rate_limit", "overloaded", "network", "timeout", "server_error"],
    },
  },
}
```

- `maxAttempts`：一次性任务在瞬态错误上的最大重试次数（默认：`3`；范围：`0`–`10`）。
- `backoffMs`：每次重试尝试的退避延迟数组，以毫秒为单位（默认：`[30000, 60000, 300000]`；1–10 个条目）。
- `retryOn`：触发重试的错误类型 — `"rate_limit"`、`"overloaded"`、`"network"`、`"timeout"`、`"server_error"`。省略则重试所有瞬态类型。

仅适用于一次性 cron 任务。周期性任务使用单独的错误处理。

### `cron.failureAlert`

```json5
{
  cron: {
    failureAlert: {
      enabled: false,
      after: 3,
      cooldownMs: 3600000,
      mode: "announce",
      accountId: "main",
    },
  },
}
```

- `enabled`：为 cron 任务启用失败告警（默认：`false`）。
- `after`：触发告警前的连续失败次数（正整数，最小：`1`）。
- `cooldownMs`：同一任务重复告警之间的最小毫秒数（非负整数）。
- `mode`：投递模式 — `"announce"` 通过频道消息发送；`"webhook"` 发布到配置的 webhook。
- `accountId`：用于限定告警投递范围的可选账户或频道 ID。

请参阅 [Cron 任务](/automation/cron-jobs)。隔离的 cron 执行作为[后台任务](/automation/tasks)进行跟踪。

---

## 媒体模型模板变量

在 `tools.media.models[].args` 中展开的模板占位符：

| 变量               | 描述                                   |
| ------------------ | -------------------------------------- |
| `{{Body}}`         | 完整入站消息体                         |
| `{{RawBody}}`      | 原始消息体（无历史/发送者包装）        |
| `{{BodyStripped}}` | 去除群提及后的消息体                   |
| `{{From}}`         | 发送者标识                             |
| `{{To}}`           | 目标标识                               |
| `{{MessageSid}}`   | 渠道消息 ID                            |
| `{{SessionId}}`    | 当前会话 UUID                          |
| `{{IsNewSession}}` | 创建新会话时为 `"true"`                |
| `{{MediaUrl}}`     | 入站媒体伪 URL                         |
| `{{MediaPath}}`    | 本地媒体路径                           |
| `{{MediaType}}`    | 媒体类型（image/audio/document/…）     |
| `{{Transcript}}`   | 音频转录                               |
| `{{Prompt}}`       | CLI 条目的解析媒体提示词               |
| `{{MaxChars}}`     | CLI 条目的解析最大输出字符数           |
| `{{ChatType}}`     | `"direct"` 或 `"group"`                |
| `{{GroupSubject}}` | 群组主题（尽力而为）                   |
| `{{GroupMembers}}` | 群成员预览（尽力而为）                 |
| `{{SenderName}}`   | 发送者显示名称（尽力而为）             |
| `{{SenderE164}}`   | 发送者电话号码（尽力而为）             |
| `{{Provider}}`     | 提供商提示（weixin、feishu、qqbot 等） |

---

## 配置包含（`$include`）

将配置拆分为多个文件：

```json5
// ~/.crawclaw/crawclaw.json
{
  gateway: { port: 18789 },
  agents: { $include: "./agents.json5" },
  broadcast: {
    $include: ["./clients/mueller.json5", "./clients/schmidt.json5"],
  },
}
```

**合并行为：**

- 单个文件：替换包含的对象。
- 文件数组：按顺序深度合并（后者覆盖前者）。
- 同级键：在包含之后合并（覆盖包含的值）。
- 嵌套包含：最深 10 层。
- 路径：相对于包含文件解析，但必须保持在顶级配置目录（`crawclaw.json` 的 `dirname`）内。仅在仍能解析到该边界内时，才允许使用绝对路径/`../` 形式。
- 错误：针对缺失文件、解析错误和循环包含的清晰错误消息。

---

_相关：[配置](/gateway/configuration) · [配置示例](/gateway/configuration-examples) · [Doctor](/gateway/doctor)_

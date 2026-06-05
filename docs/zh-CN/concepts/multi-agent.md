---
read_when: You want multiple isolated agents (workspaces + auth) in one gateway process.
status: active
summary: 多智能体路由：隔离的智能体、渠道账户和绑定
title: 多智能体路由
x-i18n:
  generated_at: "2026-06-05T14:14:18Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: b786f876e97700a926668bcd61cbe79f77c5c41a4d8a8879eed3fcfb93cf0446
  source_path: concepts/multi-agent.md
  workflow: 15
---

# 多智能体路由

目标：在一个运行的 Gateway 网关中托管多个**隔离的**智能体（独立工作空间 + `agentDir` + 会话），以及多个渠道账户（例如两个 Weixin）。入站消息通过绑定路由到智能体。

## 什么是“一个智能体”？

一个**智能体**是一个具有自身完整作用域的智能核心：

- **工作空间**（文件、AGENTS.md/SOUL.md/USER.md、本地笔记、人设规则）。
- **状态目录**（`agentDir`）用于认证配置、模型注册表和每个智能体的配置。
- **会话存储**（聊天历史 + 路由状态），位于 `~/.crawclaw/agents/<agentId>/sessions`。

认证配置是**每个智能体独立的**。每个智能体从自己的以下位置读取：

```text
~/.crawclaw/agents/<agentId>/agent/auth-profiles.json
```

主智能体凭证**不会自动共享**。切勿跨智能体重用 `agentDir`（这会导致认证/会话冲突）。如果你想共享凭证，请将 `auth-profiles.json` 复制到其他智能体的 `agentDir` 中。

Skills 是通过每个工作空间的 `skills/` 文件夹按智能体划分的，可共享的 skills 可从 `~/.crawclaw/skills` 获取。参见 [Skills：按智能体 vs 共享](/tools/skills#per-agent-vs-shared-skills)。

Gateway 网关可以托管**一个智能体**（默认）或**多个智能体**并行运行。

**工作空间注意事项：** 每个智能体的工作空间是**默认 cwd**，而不是硬[安全](/gateway/security)。

## 路径（快速映射）

- 配置：`~/.crawclaw/crawclaw.json`（或 `CRAWCLAW_CONFIG_PATH`）
- 状态目录：`~/.crawclaw`（或 `CRAWCLAW_STATE_DIR`）
- 工作空间：`~/.crawclaw/workspace`（或 `~/.crawclaw/workspace-<agentId>`）
- Agent 目录：`~/.crawclaw/agents/<agentId>/agent`（或 `agents.list[].agentDir`）
- 会话：`~/.crawclaw/agents/<agentId>/sessions`

### 单智能体模式（默认）

如果你不做任何配置，CrawClaw 以单智能体运行：

- `agentId` 默认为 **`main`**。
- 会话以 `agent:main:<mainKey>` 为键。
- 工作空间默认为 `~/.crawclaw/workspace`（或当设置了 `CRAWCLAW_PROFILE` 时为 `~/.crawclaw/workspace-<profile>`）。
- 状态默认为 `~/.crawclaw/agents/main/agent`。

## 智能体助手

使用智能体向导添加新的隔离智能体：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

然后添加 `bindings`（或让向导完成）来路由入站消息。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化验证。

## 快速开始

<Steps>
  <Step title="创建每个智能体工作空间">

使用向导或手动创建工作空间：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

每个智能体获得自己的工作空间，包含 `SOUL.md`、`AGENTS.md` 和可选的 `USER.md`，以及专用的 `agentDir` 和会话存储，位于 `~/.crawclaw/agents/<agentId>` 下。

  </Step>

  <Step title="创建渠道账户">

在你喜欢的渠道上为每个智能体创建一个账户：

- QQBot：每个智能体一个机器人，启用消息内容意图，复制每个令牌。
- 飞书：通过 BotFather 为每个智能体创建一个机器人，复制每个令牌。
- Weixin：为每个账户关联一个手机号码。

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

参见渠道指南：[QQBot](/channels/index)、[飞书](/channels/index)、[Weixin](/channels/index)。

  </Step>

  <Step title="添加智能体、账户和绑定">

在 `agents.list` 下添加智能体，在 `channels.<channel>.accounts` 下添加渠道账户，并用 `bindings` 连接它们（示例如下）。

  </Step>

  <Step title="重启并验证">

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

  </Step>
</Steps>

## 多个智能体 = 多个人，多个人格

使用**多智能体**时，每个 `agentId` 都成为一个**完全隔离的人格**：

- **不同的电话号码/账户**（每个渠道 `accountId`）。
- **不同的人格**（每个智能体的工作空间文件，如 `AGENTS.md` 和 `SOUL.md`）。
- **独立的认证 + 会话**（除非明确启用，否则不会交叉干扰）。

这让**多个人**共享一个 Gateway 网关服务器，同时保持他们的 AI“大脑”和数据隔离。

## 跨智能体记忆

默认情况下，智能体保持独立的工作空间、会话、持久记忆和认证。
如果你需要共享的长期上下文，请将其保存在明确的共享项目文档或共享持久笔记中，并在每个智能体的 `AGENTS.md` 中引用该边界。
不要依赖隐藏的跨智能体记录搜索。

## 一个 Weixin 号码，多个人（私信分流）

你可以在**一个 Weixin 账户**上，将**不同的 Weixin 私信**路由到不同的智能体。使用 `peer.kind: "direct"` 匹配发送者 E.164（如 `+15551234567`）。回复仍来自同一个 Weixin 号码（没有每个智能体的发送者身份）。

重要细节：私信会折叠到智能体的**主会话密钥**，因此真正的隔离需要**每人一个智能体**。

示例：

```json5
{
  agents: {
    list: [
      { id: "alex", workspace: "~/.crawclaw/workspace-alex" },
      { id: "mia", workspace: "~/.crawclaw/workspace-mia" },
    ],
  },
  bindings: [
    {
      agentId: "alex",
      match: { channel: "weixin", peer: { kind: "direct", id: "+15551230001" } },
    },
    {
      agentId: "mia",
      match: { channel: "weixin", peer: { kind: "direct", id: "+15551230002" } },
    },
  ],
  channels: {
    weixin: {
      dmPolicy: "allowlist",
      allowFrom: ["+15551230001", "+15551230002"],
    },
  },
}
```

注意事项：

- 私信访问控制是**每个 Weixin 账户全局的**（配对/白名单），不是按智能体的。
- 对于共享群组，将群组绑定到一个智能体或使用[广播群组](/channels/broadcast-groups)。

## 路由规则（消息如何选择智能体）

绑定是**确定性的**，**最具体优先**：

1. `peer` 匹配（精确的私信/群组/频道 ID）
2. `parentPeer` 匹配（线程继承）
3. `guildId + roles`（QQBot 角色路由）
4. `guildId`（QQBot）
5. `teamId`（DingTalk）
6. `accountId` 匹配某个渠道
7. 渠道级匹配（`accountId: "*"`）
8. 回退到默认智能体（`agents.list[].default`，否则为列表第一个条目，默认为 `main`）

如果在同一层级有多个绑定匹配，则配置顺序中第一个获胜。
如果绑定设置了多个匹配字段（例如 `peer` + `guildId`），则所有指定字段都必须匹配（`AND` 语义）。

重要的账户范围细节：

- 省略 `accountId` 的绑定仅匹配默认账户。
- 对渠道范围内所有账户使用 `accountId: "*"` 作为后备。
- 如果你稍后为同一智能体添加了带有明确账户 ID 的相同绑定，CrawClaw 会将现有仅渠道绑定升级为账户范围，而不是重复创建。

## 多账户/电话号码

支持**多账户**的渠道（如 Weixin）使用 `accountId` 标识每个登录。每个 `accountId` 可以路由到不同的智能体，因此一台服务器可以托管多个电话号码而不会混合会话。

如果你想在省略 `accountId` 时设置渠道范围的默认账户，请设置 `channels.<channel>.defaultAccount`（可选）。当未设置时，CrawClaw 如果存在则回退到 `default`，否则回退到第一个配置的账户 ID（排序后）。

支持此模式的常见渠道包括：

- `weixin`、`feishu`、`qqbot`、`ddingtalk` 和 `esp32`

## 概念

- `agentId`：一个“智能核心”（工作空间、每个智能体认证、每个智能体会话存储）。
- `accountId`：一个渠道账户实例（例如 Weixin 账户 `"personal"` vs `"biz"`）。
- `binding`：通过 `(channel, accountId, peer)` 将入站消息路由到 `agentId`，并可选择服务器/团队 ID。
- 私信折叠到 `agent:<agentId>:<mainKey>`（每个智能体的“主”；`session.mainKey`）。

## 平台示例

### 每个智能体一个 QQBot

每个 QQBot 机器人账户映射到唯一的 `accountId`。将每个账户绑定到一个智能体，并保持每个机器人的白名单。

```json5
{
  agents: {
    list: [
      { id: "main", workspace: "~/.crawclaw/workspace-main" },
      { id: "coding", workspace: "~/.crawclaw/workspace-coding" },
    ],
  },
  bindings: [
    { agentId: "main", match: { channel: "qqbot", accountId: "default" } },
    { agentId: "coding", match: { channel: "qqbot", accountId: "coding" } },
  ],
  channels: {
    qqbot: {
      groupPolicy: "allowlist",
      accounts: {
        default: {
          token: "DISCORD_BOT_TOKEN_MAIN",
          guilds: {
            "123456789012345678": {
              channels: {
                "222222222222222222": { allow: true, requireMention: false },
              },
            },
          },
        },
        coding: {
          token: "DISCORD_BOT_TOKEN_CODING",
          guilds: {
            "123456789012345678": {
              channels: {
                "333333333333333333": { allow: true, requireMention: false },
              },
            },
          },
        },
      },
    },
  },
}
```

注意事项：

- 将每个机器人邀请到服务器并启用消息内容意图。
- 令牌位于 `channels.qqbot.accounts.<id>.token`（默认账户可使用 `DISCORD_BOT_TOKEN`）。

### 每个智能体一个飞书机器人

```json5
{
  agents: {
    list: [
      { id: "main", workspace: "~/.crawclaw/workspace-main" },
      { id: "alerts", workspace: "~/.crawclaw/workspace-alerts" },
    ],
  },
  bindings: [
    { agentId: "main", match: { channel: "feishu", accountId: "default" } },
    { agentId: "alerts", match: { channel: "feishu", accountId: "alerts" } },
  ],
  channels: {
    feishu: {
      accounts: {
        default: {
          botToken: "123456:ABC...",
          dmPolicy: "pairing",
        },
        alerts: {
          botToken: "987654:XYZ...",
          dmPolicy: "allowlist",
          allowFrom: ["tg:123456789"],
        },
      },
    },
  },
}
```

注意事项：

- 使用 BotFather 为每个智能体创建一个机器人并复制每个令牌。
- 令牌位于 `channels.feishu.accounts.<id>.botToken`（默认账户可使用 `TELEGRAM_BOT_TOKEN`）。

### 每个智能体一个微信号

在启动网关之前关联每个账户：

使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 进行自动化。

`~/.crawclaw/crawclaw.json`（JSON5）：

```js
{
  agents: {
    list: [
      {
        id: "home",
        default: true,
        name: "Home",
        workspace: "~/.crawclaw/workspace-home",
        agentDir: "~/.crawclaw/agents/home/agent",
      },
      {
        id: "work",
        name: "Work",
        workspace: "~/.crawclaw/workspace-work",
        agentDir: "~/.crawclaw/agents/work/agent",
      },
    ],
  },

  // 确定性路由：第一个匹配获胜（最具体优先）。
  bindings: [
    { agentId: "home", match: { channel: "weixin", accountId: "personal" } },
    { agentId: "work", match: { channel: "weixin", accountId: "biz" } },

    // 可选的对端覆盖（示例：将特定群组发送到工作智能体）。
    {
      agentId: "work",
      match: {
        channel: "weixin",
        accountId: "personal",
        peer: { kind: "group", id: "1203630...@g.us" },
      },
    },
  ],

  // 默认关闭：智能体间消息必须明确启用 + 白名单。
  tools: {
    agentToAgent: {
      enabled: false,
      allow: ["home", "work"],
    },
  },

  channels: {
    weixin: {
      accounts: {
        personal: {
          // 可选覆盖。默认值：~/.crawclaw/credentials/weixin/personal
          // authDir: "~/.crawclaw/credentials/weixin/personal",
        },
        biz: {
          // 可选覆盖。默认值：~/.crawclaw/credentials/weixin/biz
          // authDir: "~/.crawclaw/credentials/weixin/biz",
        },
      },
    },
  },
}
```

## 示例：Weixin 日常聊天 + 飞书深度工作

按渠道分流：将 Weixin 路由到快速的日常智能体，Feishu 路由到 Opus 智能体。

```json5
{
  agents: {
    list: [
      {
        id: "chat",
        name: "Everyday",
        workspace: "~/.crawclaw/workspace-chat",
        model: "anthropic/claude-sonnet-4-6",
      },
      {
        id: "opus",
        name: "Deep Work",
        workspace: "~/.crawclaw/workspace-opus",
        model: "anthropic/claude-opus-4-6",
      },
    ],
  },
  bindings: [
    { agentId: "chat", match: { channel: "weixin" } },
    { agentId: "opus", match: { channel: "feishu" } },
  ],
}
```

注意事项：

- 如果你有一个渠道的多个账户，请将 `accountId` 添加到绑定中（例如 `{ channel: "weixin", accountId: "personal" }`）。
- 要将单个私信/群组路由到 Opus 而将其余保留在聊天上，请为该对端添加 `match.peer` 绑定；对端匹配始终优先于渠道范围的规则。

## 示例：同一渠道，一个对端到 Opus

保持 Weixin 在快速智能体上，但将一个私信路由到 Opus：

```json5
{
  agents: {
    list: [
      {
        id: "chat",
        name: "Everyday",
        workspace: "~/.crawclaw/workspace-chat",
        model: "anthropic/claude-sonnet-4-6",
      },
      {
        id: "opus",
        name: "Deep Work",
        workspace: "~/.crawclaw/workspace-opus",
        model: "anthropic/claude-opus-4-6",
      },
    ],
  },
  bindings: [
    {
      agentId: "opus",
      match: { channel: "weixin", peer: { kind: "direct", id: "+15551234567" } },
    },
    { agentId: "chat", match: { channel: "weixin" } },
  ],
}
```

对端绑定始终优先，因此请将它们放在渠道范围的规则之上。

## 绑定到 Weixin 群组的家庭智能体

将专用家庭智能体绑定到单个 Weixin 群组，启用提及门控和更严格的工具策略：

```json5
{
  agents: {
    list: [
      {
        id: "family",
        name: "Family",
        workspace: "~/.crawclaw/workspace-family",
        identity: { name: "Family Bot" },
        groupChat: {
          mentionPatterns: ["@family", "@familybot", "@Family Bot"],
        },
          mode: "all",
          scope: "agent",
        },
        tools: {
          allow: [
            "exec",
            "read",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "session_status",
          ],
          deny: ["write", "edit", "apply_patch", "browser", "canvas", "cron"],
        },
      },
    ],
  },
  bindings: [
    {
      agentId: "family",
      match: {
        channel: "weixin",
        peer: { kind: "group", id: "120363999999999999@g.us" },
      },
    },
  ],
}
```

注意事项：

- 工具允许/拒绝列表是**工具**，不是 skills。如果一个 skill 需要运行
- 为了更严格地门控，设置 `agents.list[].groupChat.mentionPatterns` 并保持渠道的群组白名单启用。

```js
{
  agents: {
    list: [
      {
        id: "personal",
        workspace: "~/.crawclaw/workspace-personal",
        },
        // 没有工具限制 - 所有工具可用
      },
      {
        id: "family",
        workspace: "~/.crawclaw/workspace-family",
          scope: "agent",  // 每个智能体一个运行时
          backend: "ssh",
          ssh: {
            target: "user@gateway-host:22",
            workspaceRoot: "/tmp/crawclaw-family",
          },
        },
        tools: {
          allow: ["read"],                    // 仅读取工具
          deny: ["exec", "write", "edit", "apply_patch"],    // 拒绝其他
        },
      },
    ],
  },
}
```

**好处：**

- **安全隔离**：限制不受信任智能体的工具
- **灵活的策略**：每个智能体不同的权限

注意：`tools.elevated` 是**全局的**且基于发送者；它不能按智能体配置。
如果你需要按智能体边界，使用 `agents.list[].tools` 拒绝 `exec`。
对于群组定向，使用 `agents.list[].groupChat.mentionPatterns`，以便 @提及能清晰地映射到目标智能体。

参见[子智能体](/tools/subagents)获取详细示例。

## 相关

- [渠道路由](/channels/channel-routing) — 消息如何路由到智能体
- [子智能体](/tools/subagents) — 生成后台智能体运行
- [ACP Agents](/tools/acp-agents) — 运行外部编码框架
- [在线状态](/concepts/presence) — 智能体在线状态和可用性
- [会话](/concepts/session) — 会话隔离和路由

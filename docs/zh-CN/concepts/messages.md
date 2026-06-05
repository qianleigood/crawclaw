---
read_when:
  - 解释入站消息如何变成回复
  - 澄清会话、队列模式或流式传输行为
  - 记录推理可见性和使用影响
summary: 消息流程、会话、队列和推理可见性
title: 消息
x-i18n:
  generated_at: "2026-06-05T14:13:05Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 508eeee5baa839070c184ed3a679232d5edb6c25b4ea34027d03e8b8cd457e88
  source_path: concepts/messages.md
  workflow: 15
---

# 消息

本页面将 CrawClaw 处理入站消息、会话、队列、流式传输和推理可见性的方式整合在一起。

## 消息流程（概览）

```
入站消息
  -> 路由/绑定 -> 会话键名
  -> 队列（如果有运行中的任务）
  -> 智能体运行（流式传输 + 工具）
  -> 出站回复（渠道限制 + 分块）
```

关键旋钮位于配置中：

- `messages.*` 用于前缀、队列和群组行为。
- `agents.defaults.*` 用于分块流式传输和分块默认值。
- 渠道覆盖（`channels.weixin.*`、`channels.feishu.*` 等）用于上限和流式传输切换。

参见[配置](/gateway/configuration)了解完整 schema。

## 入站去重

渠道在重新连接后可能重新投递同一条消息。CrawClaw 维护一个短期缓存，以渠道/账户/对端/会话/消息 id 为键，这样重复投递不会触发另一个智能体运行。

## 入站防抖

来自**同一发送者**的快速连续消息可以通过 `messages.inbound` 批处理为单个智能体轮次。防抖作用于每个渠道 + 对话的范围，并使用最新消息进行回复线程化/ID。

配置（全局默认值 + 按渠道覆盖）：

```json5
{
  messages: {
    inbound: {
      debounceMs: 2000,
      byChannel: {
        weixin: 5000,
        ddingtalk: 1500,
        qqbot: 1500,
      },
    },
  },
}
```

注意：

- 防抖适用于**纯文本**消息；媒体/附件立即刷新。
- 控制命令绕过防抖以保持独立。

## 会话和设备

会话由网关拥有，而非客户端。

- 私信折叠为智能体主会话键名。
- 群组/渠道获得自己的会话键名。
- 会话存储和转录位于网关主机上。

多个设备/渠道可以映射到同一会话，但历史记录不会完全同步回每个客户端。建议：使用一个主设备进行长对话以避免上下文分歧。浏览器和桌面客户端始终显示网关支持的会话转录，因此它们是真相来源。

详情：[会话管理](/concepts/session)。

## 入站正文和历史上下文

CrawClaw 将**提示正文**与**命令正文**分开：

- `Body`：发送给智能体的提示文本。这可能包括渠道信封和可选的历史包装器。
- `CommandBody`：用于指令/命令解析的原始用户文本。
- `RawBody`：`CommandBody` 的旧别名（为兼容性保留）。

当渠道提供历史记录时，它使用共享包装器：

- `[自你上次回复以来的聊天消息——作为上下文]`
- `[当前消息——回复此消息]`

对于**非私信聊天**（群组/渠道/房间），**当前消息正文**会添加发送者标签前缀（与历史条目使用的样式相同）。这保持了智能体提示中实时消息和队列/历史消息的一致性。

历史缓冲区是**待处理专用**的：它们包括未触发运行的群组消息（例如提及门控消息），并**排除**会话转录中已有的消息。

指令剥离仅适用于**当前消息**部分，以保持历史记录完整。包装历史记录的渠道应将 `CommandBody`（或 `RawBody`）设置为原始消息文本，并将 `Body` 保留为组合提示。历史缓冲区可通过 `messages.groupChat.historyLimit`（全局默认）和按渠道覆盖（如 `channels.ddingtalk.historyLimit` 或 `channels.feishu.accounts.<id>.historyLimit`）配置（设为 `0` 禁用）。

## 队列和跟进

如果已有运行中的任务，入站消息可以排队、操控到当前运行中，或收集为跟进轮次。

- 通过 `messages.queue`（和 `messages.queue.byChannel`）配置。
- 模式：`interrupt`、`steer`、`followup`、`collect`，以及积压变体。

详情：[队列](/concepts/queue)。

## 流式传输、分块和批处理

分块流式传输在模型生成文本块时发送部分回复。分块遵守渠道文本限制并避免拆分带围栏的代码。

关键设置：

- `agents.defaults.blockStreamingDefault`（`on|off`，默认关闭）
- `agents.defaults.blockStreamingBreak`（`text_end|message_end`）
- `agents.defaults.blockStreamingChunk`（`minChars|maxChars|breakPreference`）
- `agents.defaults.blockStreamingCoalesce`（基于空闲的批处理）
- `agents.defaults.humanDelay`（块回复之间类似人类的暂停）
- 渠道覆盖：`*.blockStreaming` 和 `*.blockStreamingCoalesce`（非 Feishu 渠道需要显式 `*.blockStreaming: true`）

详情：[流式传输 + 分块](/concepts/streaming)。

## 推理可见性和令牌

CrawClaw 可以暴露或隐藏模型推理：

- `/reasoning on|off|stream` 控制可见性。
- 推理内容在被模型生成时仍计入令牌使用量。
- Feishu 支持将推理流式传输到草稿气泡。

详情：[思维 + 推理指令](/tools/thinking)和[令牌使用](/reference/token-use)。

## 前缀、线程化和回复

出站消息格式化集中在 `messages` 中：

- `messages.responsePrefix`、`channels.<channel>.responsePrefix` 和 `channels.<channel>.accounts.<id>.responsePrefix`（出站前缀级联），以及 `channels.weixin.messagePrefix`（Weixin 入站前缀）
- 通过 `replyToMode` 和按渠道默认进行回复线程化

详情：[配置](/gateway/configuration-reference#messages)和渠道文档。

## 相关

- [流式传输](/concepts/streaming) — 实时消息传递
- [重试](/concepts/retry) — 消息传递重试行为
- [队列](/concepts/queue) — 消息处理队列
- [渠道](/channels) — 消息平台集成

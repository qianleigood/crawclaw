---
read_when:
  - 解释渠道上的流式传输或分块如何工作
  - 更改分块流式传输或渠道分块行为
  - 调试重复/提前的分块回复或渠道预览流式传输
summary: 流式传输和分块行为（分块回复、渠道预览流式传输、模式映射）
title: 流式传输和分块
x-i18n:
  generated_at: "2026-06-05T14:15:05Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 89efa20f235dce48e5df8716d91435bdbdb095ef4d78510d4c36af62f9d4c7e1
  source_path: concepts/streaming.md
  workflow: 15
---

# 流式传输 + 分块

CrawClaw 有两个独立的流式传输层：

- **分块流式传输（渠道）：** 当助手书写时发出完成的**分块**。这些是正常渠道消息（不是 token 增量）。
- **预览流式传输（飞书/QQBot/DingTalk）：** 在生成时更新临时**预览消息**。

目前**没有真正的 token 增量流式传输**到渠道消息。预览流式传输是基于消息的（发送 + 编辑/追加）。

## 分块流式传输（渠道消息）

分块流式传输在可用时以粗粒度分块发送助手输出。

```
模型输出
  └─ text_delta/events
       ├─ (blockStreamingBreak=text_end)
       │    └─ 分块器在缓冲区增长时发出分块
       └─ (blockStreamingBreak=message_end)
            └─ 分块器在 message_end 时刷新
                   └─ 渠道发送（分块回复）
```

图例：

- `text_delta/events`：模型流事件（非流式传输模型可能稀疏）。
- `chunker`：应用最小/最大边界 + 断开优先级的 `BlockReplyChunker`。
- `channel send`：实际出站消息（分块回复）。

**控制项：**

- `agents.defaults.blockStreamingDefault`：`"on"`/`"off"`（默认关闭）。
- 渠道覆盖：`*.blockStreaming`（及按账户变体）强制每个渠道 `"on"`/`"off"`。
- `agents.defaults.blockStreamingBreak`：`"text_end"` 或 `"message_end"`。
- `agents.defaults.blockStreamingChunk`：`{ minChars, maxChars, breakPreference? }`。
- `agents.defaults.blockStreamingCoalesce`：`{ minChars?, maxChars?, idleMs? }`（发送前合并流式分块）。
- 渠道硬上限：`*.textChunkLimit`（例如 `channels.weixin.textChunkLimit`）。
- 渠道分块模式：`*.chunkMode`（默认 `length`，`newline` 在长度分块前按空行（段落边界）拆分）。
- QQBot 软上限：`channels.qqbot.maxLinesPerMessage`（默认 17）拆分高回复以避免 UI 截断。

**边界语义：**

- `text_end`：分块器发出时分块立即流出；每个 `text_end` 时刷新。
- `message_end`：等待助手消息完成，然后刷新缓冲输出。

`message_end` 如果缓冲文本超过 `maxChars` 仍使用分块器，因此可以在末尾发出多个分块。

## 分块算法（低/高边界）

分块由 `BlockReplyChunker` 实现：

- **低边界：** 在缓冲区达到 `minChars` 前不发出（除非强制）。
- **高边界：** 优先在 `maxChars` 之前拆分；如果强制，则在 `maxChars` 处拆分。
- **断开优先级：** `paragraph` → `newline` → `sentence` → `whitespace` → 硬断开。
- **代码围栏：** 永远不在围栏内拆分；当在 `maxChars` 强制拆分时，关闭 + 重新打开围栏以保持 Markdown 有效。

`maxChars` 被限制在渠道 `textChunkLimit`，因此不能超过每个渠道的上限。

## 合并（合并流式分块）

启用分块流式传输时，CrawClaw 可以在发送前**合并连续的分块**。这减少了"单行刷屏"同时仍提供渐进式输出。

- 合并等待**空闲间隙**（`idleMs`）后再刷新。
- 缓冲区有 `maxChars` 上限，超出时会刷新。
- `minChars` 防止微小片段发送直到足够文本积累（最终刷新始终发送剩余文本）。
- 连接符来自 `blockStreamingChunk.breakPreference`
  (`paragraph` → `\n\n`、`newline` → `\n`、`sentence` → 空格)。
- 渠道覆盖可通过 `*.blockStreamingCoalesce`（包括按账户配置）使用。
- 除非覆盖，否则 Signal/DingTalk/QQBot 的默认合并 `minChars` 提高到 1500。

## 分块间的人类化节奏

启用分块流式传输时，你可以在分块回复之间添加**随机暂停**（第一个分块之后）。这使多气泡响应感觉更自然。

- 配置：`agents.defaults.humanDelay`（通过 `agents.list[].humanDelay` 按智能体覆盖）。
- 模式：`off`（默认）、`natural`（800–2500ms）、`custom`（`minMs`/`maxMs`）。
- 仅适用于**分块回复**，不适用于最终回复或工具摘要。

## "流式分块还是全部"

这映射到：

- **流式分块：** `blockStreamingDefault: "on"` + `blockStreamingBreak: "text_end"`（边走边发出）。非飞书渠道也需要 `*.blockStreaming: true`。
- **最后一次性流式：** `blockStreamingBreak: "message_end"`（一次性刷新，如果很长可能多个分块）。
- **无分块流式：** `blockStreamingDefault: "off"`（仅最终回复）。

**渠道注意：** 分块流式传输**默认为关闭**，除非 `*.blockStreaming` 明确设置为 `true`。渠道可以在没有分块回复的情况下流式传输实时预览（`channels.<channel>.streaming`）。

配置位置提醒：`blockStreaming*` 默认值位于 `agents.defaults` 下，不是根配置。

## 预览流式传输模式

规范键：`channels.<channel>.streaming`

模式：

- `off`：禁用预览流式传输。
- `partial`：单一预览，被最新文本替换。
- `block`：以分块/追加步骤更新预览。
- `progress`：生成期间的状态/进度预览，完成时给出最终答案。

### 渠道映射

| 渠道     | `off` | `partial` | `block` | `progress`       |
| -------- | ----- | --------- | ------- | ---------------- |
| 飞书     | ✅    | ✅        | ✅      | 映射到 `partial` |
| QQBot    | ✅    | ✅        | ✅      | 映射到 `partial` |
| DingTalk | ✅    | ✅        | ✅      | ✅               |

DingTalk 独有：

- `channels.ddingtalk.nativeStreaming` 在 `streaming=partial` 时切换 DingTalk 原生流式传输 API 调用（默认：`true`）。

### 运行时行为

飞书：

- 在私信和群聊/话题中使用 `sendMessage` + `editMessageText` 预览更新。
- 当飞书分块流式传输明确启用时跳过预览流式传输（避免双重流式传输）。
- `/reasoning stream` 可以将推理写入预览。

QQBot：

- 使用发送 + 编辑预览消息。
- `block` 模式使用内置预览分块器。
- 当 QQBot 分块流式传输明确启用时跳过预览流式传输。

DingTalk：

- `partial` 可以在可用时使用 DingTalk 原生流式传输（`chat.startStream`/`append`/`stop`）。
- `block` 使用追加式草稿预览。
- `progress` 使用状态预览文本，然后给出最终答案。

## 相关

- [消息](/concepts/messages) — 消息生命周期和传递
- [重试](/concepts/retry) — 传递失败时的重试行为
- [渠道](/channels) — 每个渠道的流式传输支持

---
summary: "使用 /btw 提出临时旁路问题"
read_when:
  - 你想围绕当前 session 问一个快速旁路问题
  - 你正在跨客户端实现或调试 BTW 行为
title: "BTW Side Questions"
x-i18n:
  generated_at: "2026-06-10T12:04:39Z"
  model: codex
  provider: openai
  source_hash: 86a14364cd56196f974b821ad7f21135d5655e8ed52fcfdd1d38793b99740a54
  source_path: tools/btw.md
  workflow: 15
---

# BTW Side Questions

`/btw` 让你围绕**当前 session** 提出一个快速旁路问题，同时不会把这个问题写入普通 conversation history。

它参考了 Claude Code 的 `/btw` 行为，但适配了 CrawClaw 的 Gateway 和 multi-channel architecture。

## 它会做什么

当你发送：

```text
/btw what changed?
```

CrawClaw 会：

1. snapshot 当前 session context，
2. 运行一个独立的 **tool-less** model call，
3. 只回答这个旁路问题，
4. 不影响 main run，
5. **不会**把 BTW 问题或答案写入 session history，
6. 将答案作为 **live side result** 发出，而不是普通 assistant message。

关键 mental model 是：

- same session context
- separate one-shot side query
- no tool calls
- no future context pollution
- no transcript persistence

## 它不会做什么

`/btw` **不会**：

- 创建新的 durable session，
- 继续未完成的 main task，
- 运行 tools 或 agent tool loops，
- 将 BTW question/answer 数据写入 transcript history，
- 出现在 `chat.history` 中，
- 在 reload 后保留。

它刻意是 **ephemeral** 的。

## Context 如何工作

BTW 只把当前 session 作为 **background context** 使用。

如果 main run 当前正在运行，CrawClaw 会 snapshot 当前 message state，并把 in-flight main prompt 作为 background context，同时明确告诉模型：

- 只回答旁路问题，
- 不要恢复或完成未结束的 main task，
- 不要发出 tool calls 或 pseudo-tool calls。

这样 BTW 既能理解当前 session 的背景，又能与 main run 保持隔离。

## Delivery model

BTW **不会**作为普通 assistant transcript message 交付。

在 Gateway protocol 层：

- 普通 assistant chat 使用 `chat` event
- BTW 使用 `chat.side_result` event

这种分离是有意设计的。如果 BTW 复用普通 `chat` event path，clients 会把它当成 regular conversation history。

因为 BTW 使用独立 live event，且不会从 `chat.history` replay，所以 reload 后会消失。

## Surface behavior

### desktop client

在 desktop client 中，BTW 会以内联形式渲染在当前 session view 中，但仍然是 ephemeral：

- 和普通 assistant reply 有明显区别
- 可以用 `Enter` 或 `Esc` dismiss
- reload 后不会 replay

### External channels

在 Feishu、Weixin 和 community chat 等 channels 上，BTW 会作为明确标记的一次性回复交付，因为这些 surfaces 没有本地 ephemeral overlay 概念。

答案仍然被视为 side result，而不是 normal session history。

### Browser clients / web

Gateway 会正确地以 `chat.side_result` 发出 BTW，且 BTW 不包含在 `chat.history` 中，因此 persistence contract 对 web 已经正确。

面向 browser 的 clients 仍需要专门的 `chat.side_result` consumer，才能在 browser 中 live 渲染 BTW。在该 client-side 支持落地之前，BTW 是一个 Gateway-level feature，完整支持 desktop client 和 external-channel behavior，但还不是完整 browser UX。

## 什么时候使用 BTW

当你想要下面这些内容时使用 `/btw`：

- 关于当前工作的快速澄清，
- 长时间 run 仍在进行时的事实性旁路答案，
- 不应成为未来 session context 的临时答案。

示例：

```text
/btw what file are we editing?
/btw what does this error mean?
/btw summarize the current task in one sentence
/btw what is 17 * 19?
```

## 什么时候不要使用 BTW

如果你希望答案成为 session 后续 working context 的一部分，不要使用 `/btw`。

这种情况下，应该在 main session 中正常提问。

## 相关

- [Slash commands](/tools/slash-commands)
- [Thinking Levels](/tools/thinking)
- [Session](/concepts/session)

---
read_when:
  - 你想从脚本或自动化触发 agent run
  - 你需要把 agent reply 投递回聊天渠道
summary: 通过 CrawClaw Desktop 或本地 Gateway API 触发 agent turn 并可选投递回复
title: Agent Send
---

# Agent Send

CrawClaw Desktop 或本地 Gateway API 可以在没有入站聊天消息的情况下运行单个 agent turn。它适用于脚本化 workflow、测试和程序化投递。

## 快速开始

<Steps>
  <Step title="运行一个简单 agent turn">
    使用 CrawClaw Desktop 进行交互式设置，或调用本地 Gateway API 自动化执行。

    请求会通过 Gateway 运行并返回回复。

  </Step>

  <Step title="指定 agent 或 session">
    使用 Desktop 或 Gateway API 传入目标 agent id、session id 或投递目标。
  </Step>

  <Step title="投递回复到渠道">
    使用 Desktop 或 Gateway API 配置 channel、reply target 和 account 覆盖。
  </Step>
</Steps>

## 常用参数

| 参数           | 说明                     |
| -------------- | ------------------------ |
| `message`      | 要发送的消息             |
| `to`           | 用目标派生 session key   |
| `agent`        | 目标 agent id            |
| `sessionId`    | 复用已有 session         |
| `deliver`      | 是否把回复投递到聊天渠道 |
| `channel`      | 投递渠道                 |
| `replyTo`      | 投递目标覆盖             |
| `replyChannel` | 投递渠道覆盖             |
| `replyAccount` | 投递账号覆盖             |
| `thinking`     | thinking level           |
| `verbose`      | verbose level            |
| `timeout`      | agent timeout            |

## 行为

- 默认通过 Gateway 运行。
- 会话选择由 `to`、`agent` 或 `sessionId` 决定。
- thinking 和 verbose 会持久化到 session store。
- 返回值可为普通文本或结构化 payload，具体取决于调用的 Gateway API。

## 相关页面

- [Gateway API](/gateway)
- [Slash commands](/tools/slash-commands)
- [Multi-Agent Routing](/concepts/multi-agent)

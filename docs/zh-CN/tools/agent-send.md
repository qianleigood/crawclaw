---
read_when:
  - 你想从脚本触发 agent turn
  - 你需要 `chat.send` 的请求和响应结构
summary: 通过 Gateway RPC 或本地 Gateway call helper 运行一个 agent turn
title: Agent Send
x-i18n:
  generated_at: "2026-06-10T20:26:28Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 64af00b20ede9251e0b9c9523ab86c10476a18009a45b1f39d6595816d7725cc
  source_path: tools/agent-send.md
  workflow: 15
---

# Agent Send

`chat.send` 可以在没有入站聊天消息的情况下运行单个 agent turn。它适用于脚本化 workflow、测试，以及需要复用 Desktop 同一套 Rust-native Gateway agent runtime 的本地自动化。

## 快速开始

<Steps>
  <Step title="运行一个简单 agent turn">
    使用 `sessionKey` 和 `message` 调用 Gateway RPC `chat.send`。

    ```bash
    curl -sS http://127.0.0.1:18789/rpc \
      -H "Authorization: Bearer $CRAWCLAW_GATEWAY_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "method": "chat.send",
        "id": "example-1",
        "params": {
          "sessionKey": "agent:main:main",
          "message": "Summarize the current project state"
        }
      }'
    ```

  </Step>

  <Step title="从本地 checkout 运行">
    Gateway 二进制也提供本地开发 shell 可用的 `call` helper。

    ```bash
    cargo run -q -p crawclaw-gateway -- call \
      --method chat.send \
      --params-json '{"sessionKey":"agent:main:main","message":"hello gateway"}'
    ```

  </Step>

  <Step title="指定 session 或 agent">
    使用 `sessionKey` 选择 transcript；需要使用非 `main` 的已配置 agent 时传入 `agentId`。
  </Step>
</Steps>

## 请求

`chat.send` 接受这些常用 params：

| 参数             | 说明                                        |
| ---------------- | ------------------------------------------- |
| `sessionKey`     | 必填 transcript/session key。别名：`key`。  |
| `message`        | 用户文本。别名：`text`、`prompt`。          |
| `agentId`        | 已配置的 agent id。默认 `main`。            |
| `idempotencyKey` | 重试时使用的稳定 run id。别名：`runId`。    |
| `channel`        | 合成 inbound channel 标签。默认 `gateway`。 |
| `from`           | 合成发送者 id。默认 `user`。                |
| `to`             | 合成接收者 id。默认 `agent:main`。          |
| `profile`        | 可选 agent run profile 对象。               |
| `provider`       | agent runtime 允许时的可选 provider 覆盖。  |
| `model`          | agent runtime 允许时的可选 model 覆盖。     |
| `reasoningLevel` | 传入 agent model selection 的可选推理级别。 |

也可以传完整的 `inbound` envelope 来替代 `message`；当 `inbound.threadId` 缺失时，Gateway 会用 `sessionKey` 补齐。

## 响应

成功调用会返回结构化 Gateway RPC response。常用字段包括：

- `result.status`：turn 完成时为 `completed`。
- `result.runId`：run id。
- `result.sessionKey`：写入的 session。
- `result.message.content`：assistant 回复文本。
- `result.contextSummary`：context projection 元数据。
- `result.events`：发出的 agent runtime events。

`chat.send` 返回 assistant message 和 event stream。它本身不会把回复投递到外部渠道；渠道投递使用 `channel.outbound.send` 等 channel outbound RPC。

## 相关页面

- [Gateway Protocol](/gateway/protocol)
- [OpenAI 兼容 Chat Completions](/gateway/openai-http-api)
- [Sub-agents](/tools/subagents) — 后台 sub-agent spawning
- [Sessions](/concepts/session) — session key 的工作方式

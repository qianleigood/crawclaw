---
read_when:
  - 集成期望使用 OpenAI Chat Completions 的工具
summary: 从 Gateway 暴露一个 Rust 原生的 OpenAI 兼容 /v1/chat/completions HTTP 端点
title: OpenAI Chat Completions
x-i18n:
  generated_at: "2026-06-05T14:28:41Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 3572ada78b915f4f422592eba1831c214f7bbecffe5d4de54a2714d1db6ee517
  source_path: gateway/openai-http-api.md
  workflow: 15
---

# OpenAI Chat Completions (HTTP)

CrawClaw Gateway 可以提供一个小型 Rust 原生的 OpenAI 兼容 Chat Completions 端点。

此端点**默认禁用**。需要先在配置中启用。

- `POST /v1/chat/completions`
- 与 Gateway 相同端口（WS + HTTP 复用）：`http://<gateway-host>:<port>/v1/chat/completions`

当任一 OpenAI 兼容 HTTP 端点启用时，Gateway 还会提供：

- `GET /v1/models`
- `GET /v1/models/{id}`
- `POST /v1/responses`

请求通过与 CrawClaw Desktop 相同的 Rust 原生 Gateway 智能体运行时处理。

## 认证

使用 Gateway 认证配置。将配置的令牌或密码作为 bearer 密钥发送：

- `Authorization: Bearer <token-or-password>`

注意事项：

- 当 `gateway.auth.mode="token"` 时，使用 `gateway.auth.token` 或 `CRAWCLAW_GATEWAY_TOKEN`。
- 当 `gateway.auth.mode="password"` 时，使用 `gateway.auth.password` 或 `CRAWCLAW_GATEWAY_PASSWORD`。
- 将此端点保持在 local loopback、tailnet 或私有入口。不要直接暴露到公共互联网。

## 安全边界

将此端点视为网关实例的完整操作员访问面。

- 这里的 HTTP bearer 认证不是窄粒度的每用户作用域模型。
- 请求通过与本地 Gateway API 相同的可信操作员路径运行。
- 如果目标智能体策略允许敏感工具，此端点可以使用它们。

参见[安全](/gateway/security)和[远程访问](/gateway/remote)。

## 智能体优先模型契约

CrawClaw 将 OpenAI 的 `model` 字段视为智能体目标，而不是原始提供商模型 ID。

- `model: "crawclaw"` 路由到 `main` 智能体。
- `model: "crawclaw/default"` 路由到 `main` 智能体。
- `model: "crawclaw/<agentId>"` 路由到特定智能体。

也接受兼容性别名：

- `model: "crawclaw:<agentId>"`
- `model: "agent:<agentId>"`

支持的请求头：

- `x-crawclaw-agent-id: <agentId>` 当 `model` 为 `crawclaw` 或 `crawclaw/default` 时覆盖目标智能体。
- `x-crawclaw-session-key: <sessionKey>` 设置显式会话路由。
- `x-crawclaw-message-channel: <channel>` 设置合成入口渠道上下文。

后端提供商/模型覆盖在所选智能体/提供商上配置。旧的 JS 兼容性头 `x-crawclaw-model` 不再是 Rust 原生 HTTP 表面的组成部分。

## 启用端点

将 `gateway.http.endpoints.chatCompletions.enabled` 设置为 `true`：

```json5
{
  gateway: {
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
}
```

## 请求支持

当前的 Rust 原生支持是有意精简的：

- 非流式 JSON 响应
- 文本 `messages` 内容
- 包含 `text` 或 `input_text` 的数组内容部分
- `system` 和 `developer` 消息合并到系统指令中
- `user` 用于在未提供 `x-crawclaw-session-key` 时派生稳定的会话密钥

当前不支持：

- `stream: true` SSE
- 图像内容部分
- 通过 OpenAI HTTP 兼容端点的客户端工具调用
- 每请求后端模型覆盖头

使用 CrawClaw Desktop 或本地 Gateway API 进行更丰富的原生智能体操作。

## 模型列表

`GET /v1/models` 返回 CrawClaw 智能体目标 ID：

- `crawclaw`
- `crawclaw/default`
- `crawclaw/main`

这些 ID 是用于智能体路由的兼容性目标。它们不是原始提供商模型目录。

## Open WebUI 快速设置

对于基本的 Open WebUI 连接：

- Base URL: `http://127.0.0.1:18789/v1`
- API key: 你的 Gateway bearer 令牌或密码
- Model: `crawclaw/default`

快速测试：

```bash
curl -sS http://127.0.0.1:18789/v1/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

## 示例

聊天补全：

```bash
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "crawclaw/default",
    "messages": [{"role":"user","content":"hi"}]
  }'
```

显式智能体和会话：

```bash
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-crawclaw-agent-id: research' \
  -H 'x-crawclaw-session-key: agent:research:openai-demo' \
  -d '{
    "model": "crawclaw",
    "messages": [{"role":"user","content":"summarize the current project"}]
  }'
```

列出模型：

```bash
curl -sS http://127.0.0.1:18789/v1/models \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

获取单个模型：

```bash
curl -sS http://127.0.0.1:18789/v1/models/crawclaw%2Fdefault \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

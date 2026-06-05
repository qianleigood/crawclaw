---
read_when:
  - 集成使用 OpenResponses API 的客户端
summary: 从 Gateway 暴露一个 Rust 原生的 OpenResponses 兼容 /v1/responses HTTP 端点
title: OpenResponses API
x-i18n:
  generated_at: "2026-06-05T14:25:30Z"
  model: MiniMax-M2.7-highspeed
  provider: minimax
  source_hash: 824823342a753acf1872b78776b73bbd26f73b82eb213c539650564e62db1158
  source_path: gateway/openresponses-http-api.md
  workflow: 15
---

# OpenResponses API (HTTP)

CrawClaw Gateway 可以托管一个小型的 Rust 原生 OpenResponses 兼容的 `POST /v1/responses` 端点。

此端点**默认禁用**。需先在配置中启用。

- `POST /v1/responses`
- 与 Gateway 同一端口（WS + HTTP 复用）：`http://<gateway-host>:<port>/v1/responses`

请求通过与 CrawClaw Desktop 相同的 Rust 原生 Gateway 智能体运行时处理。

## 认证、安全与路由

运行行为与 [OpenAI Chat Completions](/gateway/openai-http-api) 一致：

- 使用 `Authorization: Bearer <token-or-password>` 配合常规 Gateway 认证配置
- 将该端点视为网关实例的完全操作员访问
- 使用 `model: "crawclaw"`、`model: "crawclaw/default"`、`model: "crawclaw/<agentId>"` 或 `x-crawclaw-agent-id` 选择智能体
- 使用 `x-crawclaw-session-key` 进行显式会话路由
- 使用 `x-crawclaw-message-channel` 设置合成入口渠道上下文

使用 `gateway.http.endpoints.responses.enabled` 启用或禁用此端点。

相同的兼容层还包括：

- `GET /v1/models`
- `GET /v1/models/{id}`
- `POST /v1/chat/completions`

关于智能体目标模型的权威说明，请参见 [OpenAI Chat Completions](/gateway/openai-http-api#agent-first-model-contract)。

## 会话行为

默认情况下，端点会为每个请求生成一个新的会话键。

如果请求包含 `user` 字符串，Gateway 会从中派生一个稳定的会话键，以便重复调用可以共享同一个智能体会话。

如果请求包含 `x-crawclaw-session-key`，则该显式键优先。

## 请求支持

当前 Rust 原生支持有意保持精简：

- `input` 作为字符串
- `input` 作为 `message` 项数组
- `instructions` 合并到系统指令中
- 使用 `text` 或 `input_text` 的文本内容部分
- `function_call_output` 项作为文本合并到提示中
- 非流式 JSON 响应

已接受但目前忽略的字段：

- `tools`
- `tool_choice`
- `max_output_tokens`
- `metadata`
- `store`
- `truncation`
- `reasoning`

目前不支持的功能：

- `stream: true` SSE
- `previous_response_id` 连续性
- `input_image`
- `input_file`
- 客户端函数调用输出项作为结构化工具调用延续
- 每请求后端模型覆盖头

如需更丰富的原生智能体操作，请使用 CrawClaw Desktop 或本地 Gateway API。

## 响应格式

成功响应使用 OpenResponses 风格的外层结构：

```json
{
  "id": "resp_...",
  "object": "response",
  "status": "completed",
  "output_text": "...",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [{ "type": "output_text", "text": "...", "annotations": [] }]
    }
  ]
}
```

当通过此兼容路径无法获取提供商令牌计量时，`usage` 目前会以零计数形式呈现。

## 错误

错误使用如下 JSON 对象：

```json
{ "error": { "message": "...", "type": "invalid_request_error" } }
```

常见情况：

- `401` 认证缺失或无效
- `400` 请求体无效
- `404` 端点已禁用或模型未找到

## 示例

基本响应：

```bash
curl -sS http://127.0.0.1:18789/v1/responses \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "crawclaw/default",
    "input": "hi"
  }'
```

消息项输入：

```bash
curl -sS http://127.0.0.1:18789/v1/responses \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'x-crawclaw-agent-id: research' \
  -H 'x-crawclaw-session-key: agent:research:responses-demo' \
  -d '{
    "model": "crawclaw",
    "instructions": "Be concise.",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [{ "type": "input_text", "text": "Summarize the current project." }]
      }
    ]
  }'
```

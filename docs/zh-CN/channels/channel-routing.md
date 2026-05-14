---
read_when:
  - 更改渠道路由或收件箱行为
summary: 支持渠道的路由规则及共享上下文
title: 渠道路由
x-i18n:
  generated_at: "2026-02-01T20:22:21Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 1a322b5187e32c82fc1e8aac02437e2eeb7ba84e7b3a1db89feeab1dcf7dbbab
  source_path: channels/channel-routing.md
  workflow: 14
---

# 渠道与路由

CrawClaw 将回复**路由回消息来源的渠道**。模型不会选择渠道；路由是确定性的，由主机配置控制。

## 关键术语

- **渠道**：Rust-native 渠道 ID。
- **AccountId**：每个渠道的账户实例（在支持的情况下）。
- **AgentId**：隔离的工作区 + 会话存储（"大脑"）。
- **SessionKey**：用于存储上下文和控制并发的桶键。

## 会话键格式（示例）

私信会折叠到智能体的**主**会话：

- `agent:<agentId>:<mainKey>`（默认：`agent:main:main`）

群组和渠道按渠道隔离：

- 群组：`agent:<agentId>:<channel>:group:<id>`
- 渠道/房间：`agent:<agentId>:<channel>:channel:<id>`

线程：

- 渠道线程会在基础键后追加 `:thread:<threadId>`（在渠道支持时）。

示例：

- `agent:main:<channel>:group:<id>`

## 路由规则（如何选择智能体）

路由为每条入站消息选择**一个智能体**：

1. **精确对端匹配**（`bindings` 中的 `peer.kind` + `peer.id`）。
2. **父对端匹配**（线程继承）。
3. **账户匹配**（渠道上的 `accountId`）。
4. **渠道匹配**（该渠道上的任意账户）。
5. **默认智能体**（`agents.list[].default`，否则取列表第一项，兜底为 `main`）。

匹配到的智能体决定使用哪个工作区和会话存储。

## 配置概览

- `agents.list`：命名的智能体定义（工作区、模型等）。
- `bindings`：将入站渠道/账户/对端映射到智能体。

示例：

```json5
{
  agents: {
    list: [{ id: "support", name: "Support", workspace: "~/.crawclaw/workspace-support" }],
  },
  bindings: [
    { match: { channel: "internal", peer: { kind: "group", id: "group-123" } }, agentId: "support" },
  ],
}
```

## 会话存储

会话存储位于状态目录下（默认 `~/.crawclaw`）：

- `~/.crawclaw/agents/<agentId>/sessions/sessions.json`
- JSONL 记录文件与存储位于同一目录

你可以通过 `session.store` 和 `{agentId}` 模板来覆盖存储路径。

## 回复上下文

入站回复包含：

- `ReplyToId`、`ReplyToBody` 和 `ReplyToSender`（在可用时）。
- 引用的上下文会以 `[Replying to ...]` 块的形式追加到 `Body` 中。

这在所有渠道中保持一致。

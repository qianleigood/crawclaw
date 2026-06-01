---
read_when:
  - 你想端到端了解 CrawClaw OAuth
  - 你遇到了 token 失效或登出问题
  - 你想使用 setup-token 或 OAuth auth flow
  - 你想使用多个账户或 profile routing
summary: CrawClaw 中的 OAuth：token exchange、storage 和多账户模式
title: OAuth
---

# OAuth

CrawClaw 仍能理解 OAuth 形态的 auth profile 存储记录，但旧的捆绑 JavaScript provider login 和 refresh helper 已移除。Anthropic 订阅用户请使用 **setup-token** 流程，或在 Gateway 主机上复用本地 **Claude CLI** 登录。Anthropic 过去曾限制 Claude Code 之外的订阅使用，因此请自行核实当前条款并承担选择风险。

生产环境中的 Anthropic 推荐使用 API key，它比订阅 setup-token 更可预测。

CrawClaw provider setup 现在优先使用 API key、setup token 和 env-backed token；只有 provider 提供 Rust/native auth flow 时才使用 provider 原生流程。

## Token sink 为什么存在

OAuth provider 通常会在 login/refresh flow 中签发新的 refresh token。有些 provider 或 OAuth client 会在同一用户/app 签发新 token 时使旧 refresh token 失效。

实际症状：

- 你同时通过 CrawClaw 和 Claude Code / Codex CLI 登录，之后其中一个随机“被登出”。

为减少这种情况，CrawClaw 把 `auth-profiles.json` 当作 token sink：

- runtime 从同一个地方读取凭据。
- 多个 profile 可以保留，并被确定性路由。

## Storage

secret 按 agent 存储：

- Auth profiles（OAuth + API keys + 可选 value-level refs）：`~/.crawclaw/agents/<agentId>/agent/auth-profiles.json`
- 旧兼容文件：`~/.crawclaw/agents/<agentId>/agent/auth.json`（发现静态 `api_key` 条目时会 scrub）

旧导入文件仍支持，但不是主存储：

- `~/.crawclaw/credentials/oauth.json`（首次使用时导入到 `auth-profiles.json`）

以上路径都遵循 `$CRAWCLAW_STATE_DIR`。完整参考见 [/gateway/configuration](/gateway/configuration-reference#auth-storage)。

静态 secret refs 和 runtime snapshot activation 见 [Secrets Management](/gateway/secrets)。

## Anthropic setup-token

<Warning>
Anthropic setup-token 支持是技术兼容，不是政策保证。Anthropic 过去曾阻止 Claude Code 之外的部分订阅使用。请自行判断是否接受该风险，并核实当前条款。
</Warning>

在任意机器上运行：

```bash
claude setup-token
```

然后通过 CrawClaw Desktop 或本地 Gateway API 粘贴到 CrawClaw。该 token 会存为 token auth profile，不自动刷新。

## 已移除的捆绑 provider OAuth flows

旧的捆绑 JavaScript OpenAI Codex、Google Gemini CLI、MiniMax 和 GitHub Copilot login helper 已移除。已有 OAuth/token profile 仍可能存在于 auth-profile storage 中，但 CrawClaw 不再启动这些 provider-specific JS browser/device flows。

## Expiry

Profile 会存储 `expires` 时间戳。

- `expires` 仍在未来时，runtime 使用已存访问 token。
- 过期或无效时，该 profile 会被视为不可用，需要重新认证。

CrawClaw Desktop 不再运行旧的捆绑 JavaScript OAuth refresh code。请使用 provider 原生 setup path、setup-token flow 或 API key path 替换过期凭据。

## Multiple accounts 和 routing

推荐两种模式：

### 1. 分离 agent

如果希望个人和工作完全隔离，请使用独立 agent：独立 session、credential 和 workspace。通过 CrawClaw Desktop 或本地 Gateway API 创建 agent，然后分别配置 auth 并把聊天路由到对应 agent。

### 2. 单 agent 多 profile

`auth-profiles.json` 支持同一 provider 下多个 profile ID。

选择 profile 的方式：

- 通过配置排序（`auth.order`）全局选择。
- 通过 `/model ...@<profileId>` 在单个会话中选择。

示例：

- `/model Opus@anthropic:work`

查看已有 profile ID：使用 CrawClaw Desktop 或本地 Gateway API。

## 相关页面

- [Authentication](/gateway/authentication)
- [Secrets](/gateway/secrets)
- [Configuration Reference](/gateway/configuration-reference#auth-storage)

---
summary: "Canonical supported vs unsupported SecretRef credential surface"
read_when:
  - 验证 SecretRef credential 覆盖范围
  - 审计某个 credential 是否适用于 `secrets configure` 或 `secrets apply`
  - 验证某个 credential 为什么不在 supported surface 内
title: "SecretRef Credential Surface"
x-i18n:
  generated_at: "2026-06-10T12:10:03Z"
  model: codex
  provider: openai
  source_hash: c7c0abee3eec10bd328959a993a3e485b5a6c1db8866b24f725774409504dd30
  source_path: reference/secretref-credential-surface.md
  workflow: 15
---

# SecretRef credential surface

本页定义 canonical SecretRef credential surface。

Scope intent：

- In scope: 严格由用户提供、CrawClaw 不 mint 或 rotate 的 credentials。
- Out of scope: runtime-minted 或 rotating credentials、OAuth refresh material，以及 session-like artifacts。

## Supported credentials

### `crawclaw.json` targets (`secrets configure` + `secrets apply` + `secrets audit`)

[//]: # "secretref-supported-list-start"

- `models.providers.*.apiKey`
- `models.providers.*.headers.*`
- `skills.entries.*.apiKey`
- `talk.providers.*.apiKey`
- `gateway.auth.password`
- `gateway.auth.token`
- `gateway.remote.token`
- `gateway.remote.password`
- `cron.webhookToken`

### `auth-profiles.json` targets (`secrets configure` + `secrets apply` + `secrets audit`)

- `profiles.*.keyRef` (`type: "api_key"`; 当 `auth.profiles.<id>.mode = "oauth"` 时不支持)
- `profiles.*.tokenRef` (`type: "token"`; 当 `auth.profiles.<id>.mode = "oauth"` 时不支持)

[//]: # "secretref-supported-list-end"

Notes：

- Auth-profile plan targets 需要 `agentId`。
- Plan entries target `profiles.*.key` / `profiles.*.token`，并写入 sibling refs（`keyRef` / `tokenRef`）。
- Auth-profile refs 包含在 runtime resolution 和 audit coverage 中。
- OAuth policy guard: `auth.profiles.<id>.mode = "oauth"` 不能与该 profile 的 SecretRef inputs 组合使用。违反该策略时，startup/reload 和 auth-profile resolution 会 fail fast。
- 对于 SecretRef-managed model providers，generated `agents/*/agent/models.json` entries 会为 `apiKey`/header surfaces 持久化 non-secret markers，而不是 resolved secret values。
- Marker persistence 以 source 为权威：CrawClaw 从 active source config snapshot（resolution 之前）写入 markers，而不是从 resolved runtime secret values 写入。
- 对于 web search：
  - 在 explicit provider mode（设置 `tools.web.search.provider`）中，只有选中的 provider key 是 active。
  - 在 auto mode（未设置 `tools.web.search.provider`）中，只有按 precedence 解析出的第一个 provider key 是 active。
  - 在 auto mode 中，未选中的 provider refs 在被选择前会被视为 inactive。
  - Legacy `tools.web.search.*` provider paths 在 compatibility window 内仍会 resolve，但 canonical SecretRef surface 是 `plugins.entries.<plugin>.config.webSearch.*`。

## Unsupported credentials

Out-of-scope credentials 包括：

[//]: # "secretref-unsupported-list-start"

- `commands.ownerDisplaySecret`
- `hooks.token`
- `hooks.gmail.pushToken`
- `hooks.mappings[].sessionKey`
- `auth-profiles.oauth.*`

[//]: # "secretref-unsupported-list-end"

Rationale：

- 这些 credentials 属于 minted、rotated、session-bearing 或 OAuth-durable classes，不适合 read-only external SecretRef resolution。

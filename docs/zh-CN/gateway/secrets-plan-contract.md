---
summary: "`secrets apply` plans 的 contract：target validation、path matching 和 `auth-profiles.json` target scope"
read_when:
  - 生成或 review CrawClaw Desktop 或本地 Gateway API plans
  - 调试 `Invalid plan target path` errors
  - 理解 target type 和 path validation behavior
title: "Secrets Apply Plan Contract"
x-i18n:
  generated_at: "2026-06-10T12:15:35Z"
  model: codex
  provider: openai
  source_hash: f4bc91c1646274c492e2452afd0ac5e897e46c15ddbdf3a3b1600d10c8ddf290
  source_path: gateway/secrets-plan-contract.md
  workflow: 15
---

# Secrets apply plan contract

本页定义 CrawClaw Desktop 或本地 Gateway API 强制执行的严格 contract。

如果某个 target 不匹配这些 rules，apply 会在修改 configuration 之前失败。

## Plan file shape

CrawClaw Desktop 或本地 Gateway API 期望 plan targets 位于 `targets` array：

```json5
{
  version: 1,
  protocolVersion: 1,
  targets: [
    {
      type: "models.providers.apiKey",
      path: "models.providers.openai.apiKey",
      pathSegments: ["models", "providers", "openai", "apiKey"],
      providerId: "openai",
      ref: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
    },
    {
      type: "auth-profiles.api_key.key",
      path: "profiles.openai:default.key",
      pathSegments: ["profiles", "openai:default", "key"],
      agentId: "main",
      ref: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
    },
  ],
}
```

## Supported target scope

Plan targets 只接受 supported credential paths：

- [SecretRef Credential Surface](/reference/secretref-credential-surface)

## Target type behavior

General rule：

- `target.type` 必须可识别，并且必须匹配 normalized `target.path` shape。

Compatibility aliases 对现有 plans 仍被接受：

- `models.providers.apiKey`
- `skills.entries.apiKey`
- `channels.feishu.serviceAccount`

## Path validation rules

每个 target 都会用以下所有规则验证：

- `type` 必须是 recognized target type。
- `path` 必须是 non-empty dot path。
- `pathSegments` 可以省略。如果提供，必须 normalize 到与 `path` 完全相同的 path。
- Forbidden segments 会被拒绝：`__proto__`、`prototype`、`constructor`。
- Normalized path 必须匹配 target type 注册的 path shape。
- 如果设置了 `providerId` 或 `accountId`，它必须匹配 path 中编码的 id。
- `auth-profiles.json` targets 需要 `agentId`。
- 创建新的 `auth-profiles.json` mapping 时，包含 `authProfileProvider`。

## Failure behavior

如果 target validation 失败，apply 会带类似错误退出：

```text
Invalid plan target path for models.providers.apiKey: models.providers.openai.baseUrl
```

Invalid plan 不会 commit 任何 writes。

## Exec provider consent behavior

- `--dry-run` 默认跳过 exec SecretRef checks。
- 包含 exec SecretRefs/providers 的 plans 在 write mode 中会被拒绝，除非设置 `--allow-exec`。
- 验证或应用包含 exec 的 plans 时，在 dry-run 和 write commands 中都传入 `--allow-exec`。

## Runtime and audit scope notes

- Ref-only `auth-profiles.json` entries（`keyRef`/`tokenRef`）包含在 runtime resolution 和 audit coverage 中。
- `secrets apply` 会写 supported `crawclaw.json` targets、supported `auth-profiles.json` targets，以及可选 scrub targets。

## Operator checks

使用 Desktop Secret Audit 走 guided path。自动化场景中，按 CLI surface 的同一 operator flow 执行：创建或 review 一个 `secrets configure` plan，用 `secrets apply --dry-run` 验证，然后只有当 target paths 与本 contract 中的 supported shapes 匹配时才 apply。

如果 apply 因 invalid target path message 失败，请重新运行 Desktop Secret Audit 或 `secrets configure`，或把 target path 修正为上面的 supported shape。

## Related docs

- [Secrets Management](/gateway/secrets)
- [CLI `secrets`](/gateway/secrets)
- [SecretRef Credential Surface](/reference/secretref-credential-surface)
- [Configuration Reference](/gateway/configuration-reference)

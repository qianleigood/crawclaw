---
title: "Auth Credential Semantics"
summary: "auth profiles 的 canonical credential eligibility 和 resolution semantics"
read_when:
  - 你在处理 auth profile resolution 或 credential routing
  - 你在调试 model auth failures 或 profile order
x-i18n:
  generated_at: "2026-06-10T11:18:34Z"
  model: codex
  provider: openai
  source_hash: df008fbc4fe7fe2075037786da366b87cf5c67aac0fef90d977157e539991920
  source_path: auth-credential-semantics.md
  workflow: 15
---

# Auth Credential Semantics

本文定义以下 surfaces 共用的 canonical credential eligibility 和 resolution semantics：

- `resolveAuthProfileOrder`
- `resolveApiKeyForProfile`
- `models status --probe`
- `doctor-auth`

目标是让 selection-time 和 runtime behavior 保持一致。

## Stable Reason Codes

- `ok`
- `missing_credential`
- `invalid_expires`
- `expired`
- `unresolved_ref`

## Token Credentials

Token credentials（`type: "token"`）支持 inline `token` 和/或 `tokenRef`。

### Eligibility rules

1. 当 `token` 和 `tokenRef` 都缺失时，token profile 不可用。
2. `expires` 是 optional。
3. 如果存在 `expires`，它必须是大于 `0` 的 finite number。
4. 如果 `expires` 无效（`NaN`、`0`、负数、non-finite 或类型错误），profile 会以 `invalid_expires` 标记为不可用。
5. 如果 `expires` 已经过期，profile 会以 `expired` 标记为不可用。
6. `tokenRef` 不会绕过 `expires` validation。

### Resolution rules

1. Resolver semantics 与 `expires` 的 eligibility semantics 匹配。
2. 对于 eligible profiles，token material 可以从 inline value 或 `tokenRef` 解析。
3. 无法解析的 refs 会在 `models status --probe` 输出中产生 `unresolved_ref`。

## OAuth SecretRef Policy Guard

- SecretRef input 只用于 static credentials。
- 如果 profile credential 是 `type: "oauth"`，该 profile credential material 不支持 SecretRef objects。
- 如果 `auth.profiles.<id>.mode` 是 `"oauth"`，该 profile 的 SecretRef-backed `keyRef` / `tokenRef` input 会被拒绝。
- 在 startup/reload auth resolution paths 中，违规会 hard fail。

## Legacy-Compatible Messaging

为了 script compatibility，probe errors 保持第一行不变：

`Auth profile credentials are missing or expired.`

Human-friendly detail 和 stable reason codes 可以添加在后续行。

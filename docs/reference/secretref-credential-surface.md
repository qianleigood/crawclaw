---
summary: "Canonical supported vs unsupported SecretRef credential surface"
read_when:
  - Verifying SecretRef credential coverage
  - Auditing whether a credential is eligible for `secrets configure` or `secrets apply`
  - Verifying why a credential is outside the supported surface
title: "SecretRef Credential Surface"
---

# SecretRef credential surface

This page defines the canonical SecretRef credential surface.

Scope intent:

- In scope: strictly user-supplied credentials that CrawClaw does not mint or rotate.
- Out of scope: runtime-minted or rotating credentials, OAuth refresh material, and session-like artifacts.

## Supported credentials

### `crawclaw.json` targets (`secrets configure` + `secrets apply` + `secrets audit`)

[//]: # "secretref-supported-list-start"

- `models.providers.*.apiKey`
- `models.providers.*.headers.*`
- `skills.entries.*.apiKey`
- `talk.apiKey`
- `talk.providers.*.apiKey`
- `messages.tts.providers.*.apiKey`
- `gateway.auth.password`
- `gateway.auth.token`
- `gateway.remote.token`
- `gateway.remote.password`
- `cron.webhookToken`

### `auth-profiles.json` targets (`secrets configure` + `secrets apply` + `secrets audit`)

- `profiles.*.keyRef` (`type: "api_key"`; unsupported when `auth.profiles.<id>.mode = "oauth"`)
- `profiles.*.tokenRef` (`type: "token"`; unsupported when `auth.profiles.<id>.mode = "oauth"`)

[//]: # "secretref-supported-list-end"

Notes:

- Auth-profile plan targets require `agentId`.
- Plan entries target `profiles.*.key` / `profiles.*.token` and write sibling refs (`keyRef` / `tokenRef`).
- Auth-profile refs are included in runtime resolution and audit coverage.
- OAuth policy guard: `auth.profiles.<id>.mode = "oauth"` cannot be combined with SecretRef inputs for that profile. Startup/reload and auth-profile resolution fail fast when this policy is violated.
- For SecretRef-managed model providers, generated `agents/*/agent/models.json` entries persist non-secret markers (not resolved secret values) for `apiKey`/header surfaces.
- Marker persistence is source-authoritative: CrawClaw writes markers from the active source config snapshot (pre-resolution), not from resolved runtime secret values.
- For web search:
  - In explicit provider mode (`tools.web.search.provider` set), only the selected provider key is active.
  - In auto mode (`tools.web.search.provider` unset), only the first provider key that resolves by precedence is active.
  - In auto mode, non-selected provider refs are treated as inactive until selected.
  - Legacy `tools.web.search.*` provider paths still resolve during the compatibility window, but the canonical SecretRef surface is `plugins.entries.<plugin>.config.webSearch.*`.

## Unsupported credentials

Out-of-scope credentials include:

[//]: # "secretref-unsupported-list-start"

- `commands.ownerDisplaySecret`
- `hooks.token`
- `hooks.gmail.pushToken`
- `hooks.mappings[].sessionKey`
- `auth-profiles.oauth.*`

[//]: # "secretref-unsupported-list-end"

Rationale:

- These credentials are minted, rotated, session-bearing, or OAuth-durable classes that do not fit read-only external SecretRef resolution.

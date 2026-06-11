---
summary: "OAuth in CrawClaw: token exchange, storage, and multi-account patterns"
read_when:
  - You want to understand CrawClaw OAuth end-to-end
  - You hit token invalidation / logout issues
  - You want setup-token or OAuth auth flows
  - You want multiple accounts or profile routing
title: "OAuth"
---

# OAuth

CrawClaw still understands OAuth-shaped auth profiles as stored credential
records, but bundled JavaScript provider login and refresh helpers have been
removed. For Anthropic subscriptions, use the **setup-token** flow or reuse a
local **Claude CLI** login on the gateway host. Anthropic subscription use
outside Claude Code has been restricted for some users in the past, so treat it
as a user-choice risk and verify current Anthropic policy yourself. This page explains:

For Anthropic in production, API key auth is the safer recommended path over subscription setup-token auth.

- how the OAuth **token exchange** works (PKCE)
- where tokens are **stored** (and why)
- how to handle **multiple accounts** (profiles + per-session overrides)

CrawClaw provider setup now favors API keys, setup tokens, and env-backed tokens
unless a provider supplies a Rust/native auth flow.

## The token sink (why it exists)

OAuth providers commonly mint a **new refresh token** during login/refresh flows. Some providers (or OAuth clients) can invalidate older refresh tokens when a new one is issued for the same user/app.

Practical symptom:

- you log in via CrawClaw _and_ via Claude Code / Codex CLI → one of them randomly gets “logged out” later

To reduce that, CrawClaw treats `auth-profiles.json` as a **token sink**:

- the runtime reads credentials from **one place**
- we can keep multiple profiles and route them deterministically

## Storage (where tokens live)

Secrets are stored **per-agent**:

- Auth profiles (OAuth + API keys + optional value-level refs): `~/.crawclaw/agents/<agentId>/agent/auth-profiles.json`
- Legacy compatibility file: `~/.crawclaw/agents/<agentId>/agent/auth.json`
  (static `api_key` entries are scrubbed when discovered)

Legacy import-only file (still supported, but not the main store):

- `~/.crawclaw/credentials/oauth.json` (imported into `auth-profiles.json` on first use)

All of the above also respect `$CRAWCLAW_STATE_DIR` (state dir override). Full reference: [/gateway/configuration](/gateway/configuration-reference#auth-storage)

For static secret refs and runtime snapshot activation behavior, see [Secrets Management](/gateway/secrets).

## Anthropic setup-token (subscription auth)

<Warning>
Anthropic setup-token support is technical compatibility, not a policy guarantee.
Anthropic has blocked some subscription usage outside Claude Code in the past.
Decide for yourself whether to use subscription auth, and verify Anthropic's current terms.
</Warning>

Run `claude setup-token` on any machine, then paste it into CrawClaw:

Open **CrawClaw Desktop → Settings → Models and replies → Add model**, choose
**Anthropic token (paste setup-token)**, and save the token for the target
agent profile.

If you generated the token elsewhere, paste it manually:

Copy the setup-token to the Gateway host and paste it into the same Desktop
setup-token flow. For headless hosts, write the target agent's
`auth-profiles.json` and route it through `auth.profiles` / `auth.order`; do
not put live setup-tokens in `crawclaw.json`.

Verify:

Use CrawClaw Desktop's model status surface or `/model status` in chat. For
automation, call `usage.status` to confirm the provider/auth snapshot and
`models.list` to confirm the selected Anthropic model is visible.

## Auth exchange patterns

### Anthropic setup-token

Flow shape:

Setup-token path:

1. run `claude setup-token`
2. paste the token into CrawClaw
3. store as a token auth profile (no refresh)

Wizard path:

- CrawClaw Desktop or the local Gateway API → auth choice `setup-token` (Anthropic)

### Removed bundled provider OAuth flows

The previous bundled JavaScript OpenAI Codex, Google Gemini CLI, MiniMax, and
GitHub Copilot login helpers have been removed. Existing OAuth/token profiles
can still be present in auth-profile storage, but CrawClaw no longer starts
those provider-specific JS browser/device flows.

## Expiry

Profiles store an `expires` timestamp.

At runtime:

- if `expires` is in the future → use the stored access token
- if expired or invalid → treat the profile as unavailable and re-authenticate

CrawClaw Desktop no longer runs bundled JavaScript OAuth refresh code. Use a
provider's native setup path, setup-token flow, or API key path to replace stale
credentials.

## Multiple accounts (profiles) + routing

Two patterns:

### 1) Preferred: separate agents

If you want “personal” and “work” to never interact, use isolated agents (separate sessions + credentials + workspace):

Create separate `agents.list[]` entries with distinct `workspace` and
`agentDir` values, then apply them through CrawClaw Desktop settings or
`config.patch`. Verify routing with `status` and channel readiness with
`channels.status`.

Then configure auth per-agent (wizard) and route chats to the right agent.

### 2) Advanced: multiple profiles in one agent

`auth-profiles.json` supports multiple profile IDs for the same provider.

Pick which profile is used:

- globally via config ordering (`auth.order`)
- per-session via `/model ...@<profileId>`

Example (session override):

- `/model Opus@anthropic:work`

How to see what profile IDs exist:

- CrawClaw Desktop or the local Gateway API (shows `auth[]`)

Related docs:

- [/concepts/model-failover](/concepts/model-failover) (rotation + cooldown rules)
- [/tools/slash-commands](/tools/slash-commands) (command surface)

## Related

- [Authentication](/gateway/authentication) — model provider auth overview
- [Secrets](/gateway/secrets) — credential storage and SecretRef
- [Configuration Reference](/gateway/configuration-reference#auth-storage) — auth config keys

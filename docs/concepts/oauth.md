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

CrawClaw supports “subscription auth” via OAuth for providers that offer it (notably **OpenAI Codex (ChatGPT OAuth)**). For Anthropic subscriptions, you can either use the **setup-token** flow or reuse a local **Claude CLI** login on the gateway host. Anthropic subscription use outside Claude Code has been restricted for some users in the past, so treat it as a user-choice risk and verify current Anthropic policy yourself. OpenAI Codex OAuth is explicitly supported for use in external tools like CrawClaw. This page explains:

For Anthropic in production, API key auth is the safer recommended path over subscription setup-token auth.

- how the OAuth **token exchange** works (PKCE)
- where tokens are **stored** (and why)
- how to handle **multiple accounts** (profiles + per-session overrides)

CrawClaw also supports **provider plugins** that ship their own OAuth or API‑key
flows. Run them via:

```bash
crawclaw models auth login --provider <id>
```

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

```bash
crawclaw models auth setup-token --provider anthropic
```

If you generated the token elsewhere, paste it manually:

```bash
crawclaw models auth paste-token --provider anthropic
```

Verify:

```bash
crawclaw models status
```

## Anthropic Claude CLI migration

If Claude CLI is already installed and signed in on the gateway host, you can
switch Anthropic model selection over to the local CLI backend:

```bash
crawclaw models auth login --provider anthropic --method cli --set-default
```

Onboarding no longer exposes the old `anthropic-cli` auth-choice alias.

This keeps existing Anthropic auth profiles for rollback, but rewrites the main
default-model path from `anthropic/...` to `claude-cli/...`.

## OAuth exchange (how login works)

CrawClaw’s interactive login flows are implemented in `@mariozechner/pi-ai` and wired into the wizards/commands.

### Anthropic setup-token / Claude CLI

Flow shape:

Setup-token path:

1. run `claude setup-token`
2. paste the token into CrawClaw
3. store as a token auth profile (no refresh)

Claude CLI path:

1. sign in with `claude auth login` on the gateway host
2. run `crawclaw models auth login --provider anthropic --method cli --set-default`
3. store no new auth profile; switch model selection to `claude-cli/...`

Wizard path:

- `crawclaw onboard` → auth choice `setup-token` (Anthropic)

### OpenAI Codex (ChatGPT OAuth)

OpenAI Codex OAuth is explicitly supported for use outside the Codex CLI, including CrawClaw workflows.

Flow shape (PKCE):

1. generate PKCE verifier/challenge + random `state`
2. open `https://auth.openai.com/oauth/authorize?...`
3. try to capture callback on `http://127.0.0.1:1455/auth/callback`
4. if callback can’t bind (or you’re remote/headless), paste the redirect URL/code
5. exchange at `https://auth.openai.com/oauth/token`
6. extract `accountId` from the access token and store `{ access, refresh, expires, accountId }`

Wizard path is `crawclaw onboard` → auth choice `openai-codex`.

## Refresh + expiry

Profiles store an `expires` timestamp.

At runtime:

- if `expires` is in the future → use the stored access token
- if expired → refresh (under a file lock) and overwrite the stored credentials

The refresh flow is automatic; you generally don't need to manage tokens manually.

## Multiple accounts (profiles) + routing

Two patterns:

### 1) Preferred: separate agents

If you want “personal” and “work” to never interact, use isolated agents (separate sessions + credentials + workspace):

```bash
crawclaw agents add work
crawclaw agents add personal
```

Then configure auth per-agent (wizard) and route chats to the right agent.

### 2) Advanced: multiple profiles in one agent

`auth-profiles.json` supports multiple profile IDs for the same provider.

Pick which profile is used:

- globally via config ordering (`auth.order`)
- per-session via `/model ...@<profileId>`

Example (session override):

- `/model Opus@anthropic:work`

How to see what profile IDs exist:

- `crawclaw channels list --json` (shows `auth[]`)

Related docs:

- [/concepts/model-failover](/concepts/model-failover) (rotation + cooldown rules)
- [/tools/slash-commands](/tools/slash-commands) (command surface)

## Related

- [Authentication](/gateway/authentication) — model provider auth overview
- [Secrets](/gateway/secrets) — credential storage and SecretRef
- [Configuration Reference](/gateway/configuration-reference#auth-storage) — auth config keys

---
summary: "Deep troubleshooting runbook for gateway, channels, automation, and browser"
read_when:
  - The troubleshooting hub pointed you here for deeper diagnosis
  - You need stable symptom based runbook sections with exact commands
title: "Troubleshooting"
---

# Gateway troubleshooting

This page is the deep runbook.
Start at [/help/troubleshooting](/help/troubleshooting) if you want the fast triage flow first.

## Command ladder

Run these first, in this order:

Use CrawClaw Desktop's status surfaces first. For automation, call Gateway RPC
methods `health` or `status`, then `channels.status`, and use `logs.tail` when
you need recent runtime logs.

Expected healthy signals:

- CrawClaw Desktop or the local Gateway API shows `Runtime: running` and `RPC probe: ok`.
- CrawClaw Desktop or the local Gateway API reports no blocking config/service issues.
- CrawClaw Desktop or the local Gateway API shows connected/ready channels.

## Anthropic 429 extra usage required for long context

Use this when logs/errors include:
`HTTP 429: rate_limit_error: Extra usage is required for long context requests`.

Use `/model status` in chat or CrawClaw Desktop's model status surface. For
automation, call `models.list` to inspect the selected provider/model and
`usage.status` to inspect provider auth/usage windows.

Look for:

- Selected Anthropic Opus/Sonnet model has `params.context1m: true`.
- Current Anthropic credential is not eligible for long-context usage.
- Requests fail only on long sessions/model runs that need the 1M beta path.

Fix options:

1. Disable `context1m` for that model to fall back to the normal context window.
2. Use an Anthropic API key with billing, or enable Anthropic Extra Usage on the subscription account.
3. Configure fallback models so runs continue when Anthropic long-context requests are rejected.

Related:

- [/providers/anthropic](/providers/anthropic)
- [/reference/token-use](/reference/token-use)
- [/help/faq#why-am-i-seeing-http-429-ratelimiterror-from-anthropic](/help/faq#why-am-i-seeing-http-429-ratelimiterror-from-anthropic)

## No replies

If channels are up but nothing answers, check routing and policy before reconnecting anything.

Use CrawClaw Desktop's channel status and pairing views. For automation, call
`channels.status` for channel/account health, `message.policy` for policy
evaluation, and `logs.tail` for recent drops.

Look for:

- Pairing pending for DM senders.
- Group mention gating (`requireMention`, `mentionPatterns`).
- Channel/group allowlist mismatches.

Common signatures:

- `drop guild message (mention required` → group message ignored until mention.
- `pairing request` → sender needs approval.
- `blocked` / `allowlist` → sender/channel was filtered by policy.

Related:

- [/channels/troubleshooting](/channels/troubleshooting)
- [/channels/pairing](/channels/pairing)
- [/channels/groups](/channels/groups)

## Browser client connectivity

When a browser-facing client will not connect, validate URL, auth mode, and secure context assumptions.

Check the Desktop Gateway target and auth status. Automation should probe the
same URL with Gateway RPC `health` or `status`, using the token/password the
client is configured to send.

Look for:

- Correct probe URL and client URL.
- Auth mode/token mismatch between client and gateway.

Common signatures:

- `AUTH_TOKEN_MISMATCH` → shared token drift; refresh token config and retry.
- `gateway connect failed:` → wrong host/port/url target.

### Auth detail codes quick map

Use `error.details.code` from the failed `connect` response to pick the next action:

| Detail code           | Meaning                                        | Recommended action                                                                 |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `AUTH_TOKEN_MISSING`  | Client did not send a required shared token.   | Set the client token to match the Desktop Gateway auth token/password and retry.   |
| `AUTH_TOKEN_MISMATCH` | Shared token did not match gateway auth token. | Check the current Gateway auth details in this table and refresh the client token. |

Related:

- [/gateway/configuration](/gateway/configuration) (gateway auth modes)
- [/gateway/trusted-proxy-auth](/gateway/trusted-proxy-auth)
- [/gateway/remote](/gateway/remote)
- [Device pairing](/network)

## Gateway runtime not reachable

Use this when the local Gateway process does not stay up or the API is not reachable.

Start or restart the local runtime from CrawClaw Desktop. Automation can call
`health` or `status` once the Gateway is reachable; config repairs should go
through `config.patch`.

Look for:

- Port/listener conflicts.

Common signatures:

- `Gateway start blocked: set gateway.mode=local` → local gateway mode is not enabled. Fix: set `gateway.mode="local"` through CrawClaw Desktop or `config.patch`.
- `refusing to bind gateway ... without auth` → non-loopback bind without token/password.
- `another gateway instance is already listening` / `EADDRINUSE` → port conflict.

Related:

- [/gateway/background-process](/gateway/background-process)
- [/gateway/configuration](/gateway/configuration)
- [/gateway/doctor](/gateway/doctor)

## Channel connected messages not flowing

If channel state is connected but message flow is dead, focus on policy, permissions, and channel specific delivery rules.

Use the channel settings panel for interactive checks. Automation should call
`channels.status`, then `channels.setup.surface` or `channels.config.get` for
the affected channel.

Look for:

- DM policy (`pairing`, `allowlist`, `open`, `disabled`).
- Group allowlist and mention requirements.
- Missing channel API permissions/scopes.

Common signatures:

- `mention required` → message ignored by group mention policy.
- `pairing` / pending approval traces → sender is not approved.
- `missing_scope`, `not_in_channel`, `Forbidden`, `401/403` → channel auth/permissions issue.

Related:

- [/channels/troubleshooting](/channels/troubleshooting)
- [/channels/index](/channels/index)

## Cron and main-session wake delivery

If cron or a queued main-session wake did not run or did not deliver, verify
scheduler state first, then delivery target.

Use the Automation page for interactive cron state. Automation should call
`cron.status`, `cron.list`, and `cron.runs` before inspecting delivery logs.

Look for:

- Cron enabled and next wake present.
- Job run history status (`ok`, `skipped`, `error`).
- Wake skip reasons (`requests-in-flight`, `alerts-disabled`, `no-system-events`).

Common signatures:

- `cron: scheduler disabled; jobs will not run automatically` → cron disabled.
- `cron: timer tick failed` → scheduler tick failed; check file/log/runtime errors.
- `heartbeat: unknown accountId` → invalid legacy heartbeat delivery account id.
- `heartbeat skipped` with `reason=dm-blocked` → legacy heartbeat delivery resolved to a DM-style destination while `agents.defaults.heartbeat.directPolicy` (or per-agent override) is set to `block`.

Related:

- [/automation/cron-jobs#troubleshooting](/automation/cron-jobs#troubleshooting)
- [/automation/cron-jobs](/automation/cron-jobs)
- [/gateway/heartbeat](/gateway/heartbeat)

## Browser tool fails

Use this when browser tool actions fail even though the gateway itself is healthy.

Use the Desktop tool/runtime status when running interactively. Automation should
call `tools.catalog` to confirm the browser tool is exposed, then invoke the
browser tool through `/tools/invoke` or `tools.invoke`.

From the current agent or Gateway `/tools/invoke` path, check the browser tool
directly:

```json
{ "action": "status", "profile": "crawclaw" }
```

```json
{ "action": "profiles" }
```

Look for:

- Whether `tools.catalog` lists `browser` under `native-plugin`.
- Valid browser executable path.
- Managed `agent-browser` runtime health.

Common signatures:

- Agent reports browser tool missing / unavailable → native tool catalog is not exposing `browser`.
- `agent-browser runtime is not installed` → install or repair the browser runtime from CrawClaw Desktop.
- `browser.executablePath not found` → configured path is invalid.

Related:

- [/tools/browser-linux-troubleshooting](/tools/browser-linux-troubleshooting)
- [/tools/browser](/tools/browser)

## If you upgraded and something suddenly broke

Most post-upgrade breakage is config drift or stricter defaults now being enforced.

### 1) Auth and URL override behavior changed

Use Desktop settings to confirm the active Gateway target. Automation should
call `config.get` for configured mode/URL settings and probe `health` or
`status` against the exact target URL.

What to check:

- If `gateway.mode=remote`, CLI calls may be targeting remote while your local service is fine.
- Explicit `--url` calls do not fall back to stored credentials.

Common signatures:

- `gateway connect failed:` → wrong URL target.
- `unauthorized` → endpoint reachable but wrong auth.

### 2) Bind and auth guardrails are stricter

Use Desktop Gateway settings for interactive repair. Automation should inspect
`gateway.bind` and `gateway.auth.*` with `config.get`, then apply scoped fixes
with `config.patch`.

What to check:

- Non-loopback binds (`lan`, `tailnet`, `custom`) need auth configured.
- Old keys like `gateway.token` do not replace `gateway.auth.token`.

Common signatures:

- `refusing to bind gateway ... without auth` → bind+auth mismatch.
- `RPC probe: failed` while runtime is running → gateway alive but inaccessible with current auth/url.

### 3) Pairing or identity policy changed

Use Desktop pairing views for approval decisions. Automation should inspect
`channels.status` and channel config before changing policy with
`channels.config.patch`.

What to check:

- Pending DM pairing approvals after channel policy or sender identity changes.

If the service config and runtime still disagree after checks, reinstall service metadata from the same profile/state directory:

Use CrawClaw Desktop to reinstall service metadata from the same profile/state
directory, then re-check `status` and `channels.status`.

Related:

- [/channels/pairing](/channels/pairing)
- [/gateway/authentication](/gateway/authentication)
- [/gateway/background-process](/gateway/background-process)

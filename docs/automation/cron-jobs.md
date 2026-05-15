---
summary: "Scheduled jobs, webhooks, and Gmail PubSub triggers for the Gateway scheduler"
read_when:
  - Scheduling background jobs or wakeups
  - Wiring external triggers (webhooks, Gmail) into CrawClaw
  - Deciding between main-session wakeups and isolated cron jobs
title: "Scheduled Tasks"
---

# Scheduled Tasks (Cron)

Cron is the Gateway's built-in scheduler. It persists jobs, wakes the agent at the right time, and can deliver output back to a chat channel or webhook endpoint.

## Quick start

```bash
# Add a one-shot reminder
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Check your jobs
# Use CrawClaw Desktop or the local Gateway API for this operation.

# See run history
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## How cron works

- Cron runs **inside the Gateway** process (not inside the model).
- Jobs persist at `~/.crawclaw/cron/jobs.json` so restarts do not lose schedules.
- All cron executions create [background task](/automation/tasks) records.
- One-shot jobs (`--at`) auto-delete after success by default.

## Schedule types

| Kind    | CLI flag  | Description                                             |
| ------- | --------- | ------------------------------------------------------- |
| `at`    | `--at`    | One-shot timestamp (ISO 8601 or relative like `20m`)    |
| `every` | `--every` | Fixed interval                                          |
| `cron`  | `--cron`  | 5-field or 6-field cron expression with optional `--tz` |

Timestamps without a timezone are treated as UTC. Add `--tz America/New_York` for local wall-clock scheduling.

Recurring top-of-hour expressions are automatically staggered by up to 5 minutes to reduce load spikes. Use `--exact` to force precise timing or `--stagger 30s` for an explicit window.

## Execution styles

| Style           | `--session` value   | Runs in                  | Best for                        |
| --------------- | ------------------- | ------------------------ | ------------------------------- |
| Main session    | `main`              | Main-session runner      | Reminders, system events        |
| Isolated        | `isolated`          | Dedicated `cron:<jobId>` | Reports, background chores      |
| Current session | `current`           | Bound at creation time   | Context-aware recurring work    |
| Custom session  | `session:custom-id` | Persistent named session | Workflows that build on history |

**Main session** jobs enqueue a system event and wake the main-session runner (`--wake now`). **Isolated** jobs run a dedicated agent turn with a fresh session. **Custom sessions** (`session:xxx`) persist context across runs, enabling workflows like daily standups that build on previous summaries.

### Payload options for isolated jobs

- `--message`: prompt text (required for isolated)
- `--model` / `--thinking`: model and thinking level overrides
- `--light-context`: skip workspace bootstrap file injection
- `--tools exec,read`: restrict which tools the job can use

## Delivery and output

| Mode       | What happens                                             |
| ---------- | -------------------------------------------------------- |
| `announce` | Deliver summary to target channel (default for isolated) |
| `webhook`  | POST finished event payload to a URL                     |
| `none`     | Internal only, no delivery                               |

Use `--announce --channel feishu --to "-1001234567890"` for channel delivery. For Feishu forum topics, use `-1001234567890:topic:123`. DingTalk/QQBot/Feishu targets should use explicit prefixes (`channel:<id>`, `user:<id>`).

## Gateway API examples

One-shot reminder (main session):

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Recurring isolated job with delivery:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Isolated job with model and thinking override:

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## Webhooks

Gateway can expose HTTP webhook endpoints for external triggers. Enable in config:

```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
  },
}
```

### Authentication

Every request must include the hook token via header:

- `Authorization: Bearer <token>` (recommended)
- `x-crawclaw-token: <token>`

Query-string tokens are rejected.

### POST /hooks/wake

Enqueue a system event for the main session:

```bash
curl -X POST http://127.0.0.1:18789/hooks/wake \
  -H 'Authorization: Bearer SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"text":"New email received","mode":"now"}'
```

- `text` (required): event description
- `mode` (optional): `now` (default). This requests an event-driven
  main-session wake.

### POST /hooks/agent

Run an isolated agent turn:

```bash
curl -X POST http://127.0.0.1:18789/hooks/agent \
  -H 'Authorization: Bearer SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarize inbox","name":"Email","model":"openai/gpt-5.2-mini"}'
```

Fields: `message` (required), `name`, `agentId`, `wakeMode`, `deliver`, `channel`, `to`, `model`, `thinking`, `timeoutSeconds`.

### Mapped hooks (POST /hooks/\<name\>)

Custom hook names are resolved via `hooks.mappings` in config. Mappings can transform arbitrary payloads into `wake` or `agent` actions with templates or code transforms.

### Security

- Keep hook endpoints behind loopback, tailnet, or trusted reverse proxy.
- Use a dedicated hook token; do not reuse gateway auth tokens.
- Set `hooks.allowedAgentIds` to limit explicit `agentId` routing.
- Keep `hooks.allowRequestSessionKey=false` unless you require caller-selected sessions.
- Hook payloads are wrapped with safety boundaries by default.

## Gmail PubSub integration

Wire Gmail inbox triggers to CrawClaw via Google PubSub.

**Prerequisites**: `gcloud` CLI, `gog` (gogcli), CrawClaw hooks enabled, Tailscale for the public HTTPS endpoint.

### Wizard setup (recommended)

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

This writes `hooks.gmail` config, enables the Gmail preset, and uses Tailscale Funnel for the push endpoint.

### Gateway auto-start

When `hooks.enabled=true` and `hooks.gmail.account` is set, the Gateway starts `gog gmail watch serve` on boot and auto-renews the watch. Set `CRAWCLAW_SKIP_GMAIL_WATCHER=1` to opt out.

### Manual one-time setup

1. Select the GCP project that owns the OAuth client used by `gog`:

```bash
gcloud auth login
gcloud config set project <project-id>
gcloud services enable gmail.googleapis.com pubsub.googleapis.com
```

2. Create topic and grant Gmail push access:

```bash
gcloud pubsub topics create gog-gmail-watch
gcloud pubsub topics add-iam-policy-binding gog-gmail-watch \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

3. Start the watch:

```bash
gog gmail watch start \
  --account crawclaw@gmail.com \
  --label INBOX \
  --topic projects/<project-id>/topics/gog-gmail-watch
```

### Gmail model override

```json5
{
  hooks: {
    gmail: {
      model: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      thinking: "off",
    },
  },
}
```

## Managing jobs

```bash
# List all jobs
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Edit a job
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Force run a job now
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Run only if due
# Use CrawClaw Desktop or the local Gateway API for this operation.

# View run history
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Delete a job
# Use CrawClaw Desktop or the local Gateway API for this operation.

# Agent selection (multi-agent setups)
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## Configuration

```json5
{
  cron: {
    enabled: true,
    store: "~/.crawclaw/cron/jobs.json",
    maxConcurrentRuns: 1,
    retry: {
      maxAttempts: 3,
      backoffMs: [60000, 120000, 300000],
      retryOn: ["rate_limit", "overloaded", "network", "server_error"],
    },
    webhookToken: "replace-with-dedicated-webhook-token",
    sessionRetention: "24h",
    runLog: { maxBytes: "2mb", keepLines: 2000 },
  },
}
```

Disable cron: `cron.enabled: false` or `CRAWCLAW_SKIP_CRON=1`.

**One-shot retry**: transient errors (rate limit, overload, network, server error) retry up to 3 times with exponential backoff. Permanent errors disable immediately.

**Recurring retry**: exponential backoff (30s to 60m) between retries. Backoff resets after the next successful run.

### Maintenance

`cron.sessionRetention` (default `24h`) prunes isolated run-session entries.
`cron.runLog.maxBytes` / `cron.runLog.keepLines` auto-prune run-log files.

## Troubleshooting

### Command ladder

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

### Cron not firing

- Check `cron.enabled` and `CRAWCLAW_SKIP_CRON` env var.
- Confirm the Gateway is running continuously.
- For `cron` schedules, verify timezone (`--tz`) vs the host timezone.
- `reason: not-due` in run output means manual run called without `--force`.

### Cron fired but no delivery

- Delivery mode is `none` means no external message is expected.
- Delivery target missing/invalid (`channel`/`to`) means outbound was skipped.
- Channel auth errors (`unauthorized`, `Forbidden`) mean delivery was blocked by credentials.

### Timezone gotchas

- Cron without `--tz` uses the gateway host timezone.
- `at` schedules without timezone are treated as UTC.
- `activeHours` is no longer a valid heartbeat config key. Cron schedules use
  the job timezone or the gateway host timezone.

## Related

- [Automation & Tasks](/automation) — all automation mechanisms at a glance
- [Background Tasks](/automation/tasks) — task ledger for cron executions
- [Heartbeat](/gateway/heartbeat) — heartbeat migration notes
- [Timezone](/concepts/timezone) — timezone configuration

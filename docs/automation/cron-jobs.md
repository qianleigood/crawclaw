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

For operators, use **CrawClaw Desktop** → **Automation** → **Cron** to inspect jobs, current runs, history, and run logs. Cron is built into the Gateway scheduler, so there is no separate runtime to install.

For automation, call the local Gateway RPC endpoint with the `cron.*` methods documented below.

## How cron works

- Cron runs **inside the Gateway** process (not inside the model).
- Jobs persist at `~/.crawclaw/cron/jobs.json` so restarts do not lose schedules.
- All cron executions create [background task](/automation/tasks) records.
- One-shot jobs (`--at`) auto-delete after success by default.

## Schedule types

| Kind    | `schedule` shape                        | Description                        |
| ------- | --------------------------------------- | ---------------------------------- |
| `at`    | `{ "kind": "at", "at": "..." }`         | One-shot timestamp (ISO 8601)      |
| `every` | `{ "kind": "every", "everyMs": 60000 }` | Fixed interval in milliseconds     |
| `cron`  | `{ "kind": "cron", "expr": "..." }`     | 5-field or 6-field cron expression |

Timestamps without a timezone are treated as UTC. Add `tz` to a `cron` schedule for local wall-clock scheduling, for example `"tz": "America/New_York"`.

Recurring top-of-hour expressions are automatically staggered by up to 5 minutes to reduce load spikes. Set `staggerMs` explicitly for a custom window, or set it to `0` when exact timing matters.

## Execution styles

| Style           | `--session` value   | Runs in                  | Best for                        |
| --------------- | ------------------- | ------------------------ | ------------------------------- |
| Main session    | `main`              | Main-session runner      | Reminders, system events        |
| Isolated        | `isolated`          | Dedicated `cron:<jobId>` | Reports, background chores      |
| Current session | `current`           | Bound at creation time   | Context-aware recurring work    |
| Custom session  | `session:custom-id` | Persistent named session | Workflows that build on history |

**Main session** jobs enqueue a system event and wake the main-session runner (`--wake now`). **Isolated** jobs run a dedicated agent turn with a fresh session. **Custom sessions** (`session:xxx`) persist context across runs, enabling workflows like daily standups that build on previous summaries.

### Payload options for isolated jobs

- `payload.kind: "agentTurn"` and `payload.message`: prompt text (required for non-main targets)
- `payload.model` / `payload.thinking`: model and thinking level overrides
- `payload.lightContext`: skip workspace bootstrap file injection
- `payload.toolsAllow`: restrict which tools the job can use

## Delivery and output

| Mode       | What happens                                             |
| ---------- | -------------------------------------------------------- |
| `announce` | Deliver summary to target channel (default for isolated) |
| `webhook`  | POST finished event payload to a URL                     |
| `none`     | Internal only, no delivery                               |

Set `delivery` on `cron.add` or `cron.update`, for example `{ "mode": "announce", "channel": "feishu", "to": "-1001234567890" }`. For Feishu forum topics, use `-1001234567890:topic:123`. DingTalk/QQBot/Feishu targets should use explicit prefixes (`channel:<id>`, `user:<id>`).

## Gateway RPC examples

The RPC endpoint is `POST /api/gateway/rpc` on the same local Gateway port. It uses the same Gateway bearer auth as the rest of the local API.

One-shot reminder (main session):

```bash
curl -sS http://127.0.0.1:18789/api/gateway/rpc \
  -H 'Authorization: Bearer <gateway-token-or-password>' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "cron-add-reminder",
    "method": "cron.add",
    "params": {
      "name": "Stand up",
      "schedule": { "kind": "at", "at": "2999-01-01T09:00:00Z" },
      "sessionTarget": "main",
      "wakeMode": "now",
      "payload": { "kind": "systemEvent", "text": "Stand up reminder" }
    }
  }'
```

Recurring isolated job with delivery:

```bash
curl -sS http://127.0.0.1:18789/api/gateway/rpc \
  -H 'Authorization: Bearer <gateway-token-or-password>' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "cron-add-report",
    "method": "cron.add",
    "params": {
      "name": "Daily report",
      "schedule": { "kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai" },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": { "kind": "agentTurn", "message": "Summarize the previous workday" },
      "delivery": { "mode": "announce", "channel": "last" }
    }
  }'
```

Isolated job with model and thinking override:

```bash
curl -sS http://127.0.0.1:18789/api/gateway/rpc \
  -H 'Authorization: Bearer <gateway-token-or-password>' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "cron-add-model-report",
    "method": "cron.add",
    "params": {
      "name": "Lightweight health report",
      "schedule": { "kind": "every", "everyMs": 3600000 },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "Check health and report only blockers",
        "model": "openai/gpt-5.2-mini",
        "thinking": "low",
        "lightContext": true,
        "toolsAllow": ["read", "grep"]
      },
      "delivery": { "mode": "none" }
    }
  }'
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

### Configuration setup

Configure `hooks.gmail` with the account, topic, subscription, push token, and hook URL for the mailbox automation. Use Tailscale Serve/Funnel only when the Gmail callback URL must be reachable from outside the gateway host.

### Serve push callbacks

CrawClaw receives Gmail PubSub callbacks through the normal `/hooks/gmail`
mapping path. Run and renew `gog gmail watch serve` from your own service
manager, then point its push URL at the configured CrawClaw hook URL.

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

Use the Desktop Cron tab for manual inspection and these Gateway RPC methods for automation:

| Method        | Purpose                                      |
| ------------- | -------------------------------------------- |
| `cron.status` | Scheduler status and runtime summary         |
| `cron.list`   | List jobs with filters and pagination        |
| `cron.add`    | Create a job                                 |
| `cron.update` | Patch schedule, payload, delivery, or state  |
| `cron.remove` | Delete a job                                 |
| `cron.run`    | Manually run a job (`mode: "due"`/`"force"`) |
| `cron.runs`   | Read run-log entries for one job or all jobs |

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

1. Check scheduler health with `cron.status`.
2. Confirm the job exists and is enabled with `cron.list`.
3. Inspect recent attempts with `cron.runs`.
4. Reproduce manually with `cron.run` and `mode: "force"` when you need to bypass the due-time check.

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

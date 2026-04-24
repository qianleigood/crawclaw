---
summary: "Logging overview: file logs, console output, and CLI tailing"
read_when:
  - You need a beginner-friendly overview of logging
  - You want to configure log levels or formats
  - You are troubleshooting and need to find logs quickly
title: "Logging Overview"
---

# Logging

CrawClaw logs in two places:

- **File logs** (JSON lines) written by the Gateway.
- **Console output** shown in terminals.

This page explains where logs live, how to read them, and how to configure log
levels and formats.

## Where logs live

By default, the Gateway writes a rolling log file under:

`/tmp/crawclaw/crawclaw-YYYY-MM-DD.log`

The date uses the gateway host's local timezone.

You can override this in `~/.crawclaw/crawclaw.json`:

```json
{
  "logging": {
    "file": "/path/to/crawclaw.log"
  }
}
```

## How to read logs

### CLI: live tail (recommended)

Use the CLI to tail the gateway log file via RPC:

```bash
crawclaw logs --follow
```

Output modes:

- **TTY sessions**: pretty, colorized, structured log lines.
- **Non-TTY sessions**: plain text.
- `--json`: line-delimited JSON (one log event per line).
- `--plain`: force plain text in TTY sessions.
- `--no-color`: disable ANSI colors.

In JSON mode, the CLI emits `type`-tagged objects:

- `meta`: stream metadata (file, cursor, size)
- `log`: parsed log entry
- `notice`: truncation / rotation hints
- `raw`: unparsed log line

If the Gateway is unreachable, the CLI prints a short hint to run:

```bash
crawclaw doctor
```

### Channel-only logs

To filter channel activity (WhatsApp/Telegram/etc), use:

```bash
crawclaw channels logs --channel whatsapp
```

## Log formats

### File logs (JSONL)

Each line in the log file is a JSON object. The CLI parses these entries to
render structured output (time, level, subsystem, message).

### Console output

Console logs are **TTY-aware** and formatted for readability:

- Subsystem prefixes (e.g. `gateway/channels/whatsapp`)
- Level coloring (info/warn/error)
- Optional compact or JSON mode

Console formatting is controlled by `logging.consoleStyle`.

## Configuring logging

All logging configuration lives under `logging` in `~/.crawclaw/crawclaw.json`.

```json
{
  "logging": {
    "level": "info",
    "file": "/tmp/crawclaw/crawclaw-YYYY-MM-DD.log",
    "consoleLevel": "info",
    "consoleStyle": "pretty",
    "redactSensitive": "tools",
    "redactPatterns": ["sk-.*"]
  }
}
```

### Log levels

- `logging.level`: **file logs** (JSONL) level.
- `logging.consoleLevel`: **console** verbosity level.

You can override both via the **`CRAWCLAW_LOG_LEVEL`** environment variable (e.g. `CRAWCLAW_LOG_LEVEL=debug`). The env var takes precedence over the config file, so you can raise verbosity for a single run without editing `crawclaw.json`. You can also pass the global CLI option **`--log-level <level>`** (for example, `crawclaw --log-level debug gateway run`), which overrides the environment variable for that command.

`--verbose` only affects console output; it does not change file log levels.

### Console styles

`logging.consoleStyle`:

- `pretty`: human-friendly, colored, with timestamps.
- `compact`: tighter output (best for long sessions).
- `json`: JSON per line (for log processors).

### Redaction

Tool summaries can redact sensitive tokens before they hit the console:

- `logging.redactSensitive`: `off` | `tools` (default: `tools`)
- `logging.redactPatterns`: list of regex strings to override the default set

Redaction affects **console output only** and does not alter file logs.

## Diagnostics + OpenTelemetry

Diagnostics are structured, machine-readable events for model runs **and**
message-flow telemetry (webhooks, queueing, session state). They do **not**
replace logs; they exist to feed metrics, traces, and other exporters.

Diagnostics events are emitted in-process, but exporters only attach when
diagnostics + the exporter plugin are enabled.

### OpenTelemetry vs OTLP

- **OpenTelemetry (OTel)**: the data model + SDKs for traces, metrics, and logs.
- **OTLP**: the wire protocol used to export OTel data to a collector/backend.
- CrawClaw exports via **OTLP/HTTP (protobuf)** today.

### Signals exported

- **Metrics**: counters + histograms (token usage, message flow, queueing).
- **Traces**: spans for run lifecycle, model usage, webhook/message processing,
  and channel streaming decisions.
- **Logs**: exported over OTLP when `diagnostics.otel.logs` is enabled. Log
  volume can be high; keep `logging.level` and exporter filters in mind.

### Observation context

CrawClaw now uses `ObservationContext` as the single tracing and correlation
contract. Modules should pass observation context instead of hand-building
`traceId`, `spanId`, or `parentSpanId` fields.

An observation contains:

- `trace.traceId`: defaults to `run-loop:${runId ?? sessionKey ?? sessionId}`.
- `trace.spanId`: the current operation span.
- `trace.parentSpanId`: the parent span or `null` for the run root.
- `trace.traceparent` and `trace.tracestate`: optional W3C propagation values at
  process or channel boundaries.
- `runtime.runId`, `runtime.sessionId`, `runtime.sessionKey`, `runtime.agentId`,
  `runtime.taskId`, and workflow ids: runtime correlation ids.
- `phase` and `decisionCode`: lifecycle semantics owned by the run-loop spine.
- `refs`: small business references such as `requestId`, `messageId`,
  `toolCallId`, or `correlationId`.

The run-loop lifecycle bus is the owner of runtime lifecycle semantics.
Diagnostic events, cache trace JSONL, Action Feed, Context Archive, task
trajectory, logs, and OTel export are projections or sinks. They read
`ObservationContext`; they do not create a second lifecycle model.

Subsystem logs automatically attach the current observation scope to console and
file metadata. `withContext` is still useful for business fields, but tracing
identity should come from observation context.

Metrics exported to OTel intentionally avoid high-cardinality observation ids
such as `traceId`, `spanId`, `runId`, `sessionId`, and `sessionKey`. Spans and
logs keep those ids so a debugging session can connect timeline records, logs,
diagnostic events, cache trace entries, and OTel attributes.

### Diagnostic event catalog

Model usage:

- `model.usage`: tokens, cost, duration, context, provider/model/channel, session ids.

Message flow:

- `webhook.received`: webhook ingress per channel.
- `webhook.processed`: webhook handled + duration.
- `webhook.error`: webhook handler errors.
- `message.queued`: message enqueued for processing.
- `message.processed`: outcome + duration + optional error.

Queue + session:

- `queue.lane.enqueue`: command queue lane enqueue + depth.
- `queue.lane.dequeue`: command queue lane dequeue + wait time.
- `session.state`: session state transition + reason.
- `session.stuck`: session stuck warning + age.
- `run.attempt`: run retry/attempt metadata.
- `run.lifecycle`: run-loop lifecycle phase, observation context, decision,
  metrics, and refs.
- `diagnostic.heartbeat`: aggregate counters (webhooks/queue/session).
- `channel.streaming.decision`: per-channel streaming enable/disable decision
  with `surface` and `reason` metadata.

### Enable diagnostics (no exporter)

Use this if you want diagnostics events available to plugins or custom sinks:

```json
{
  "diagnostics": {
    "enabled": true
  }
}
```

### Diagnostics flags (targeted logs)

Use flags to turn on extra, targeted debug logs without raising `logging.level`.
Flags are case-insensitive and support wildcards (e.g. `telegram.*` or `*`).

```json
{
  "diagnostics": {
    "flags": ["telegram.http"]
  }
}
```

Env override (one-off):

```
CRAWCLAW_DIAGNOSTICS=telegram.http,telegram.payload
```

Notes:

- Flag logs go to the standard log file (same as `logging.file`).
- Output is still redacted according to `logging.redactSensitive`.
- Full guide: [/diagnostics/flags](/diagnostics/flags).

### Export to OpenTelemetry

Diagnostics can be exported via the `diagnostics-otel` plugin (OTLP/HTTP). This
works with any OpenTelemetry collector/backend that accepts OTLP/HTTP.

```json
{
  "plugins": {
    "allow": ["diagnostics-otel"],
    "entries": {
      "diagnostics-otel": {
        "enabled": true
      }
    }
  },
  "diagnostics": {
    "enabled": true,
    "otel": {
      "enabled": true,
      "endpoint": "http://otel-collector:4318",
      "protocol": "http/protobuf",
      "serviceName": "crawclaw-gateway",
      "traces": true,
      "metrics": true,
      "logs": true,
      "sampleRate": 0.2,
      "flushIntervalMs": 60000
    }
  }
}
```

Notes:

- You can also enable the plugin with `crawclaw plugins enable diagnostics-otel`.
- `protocol` currently supports `http/protobuf` only. `grpc` is ignored.
- Metrics include token usage, cost, context size, run duration, and message-flow
  counters/histograms (webhooks, queueing, session state, queue depth/wait).
- Traces/metrics can be toggled with `traces` / `metrics` (default: on). Traces
  include `crawclaw.run.lifecycle.<phase>` spans, model usage spans, and
  webhook/message processing spans when enabled.
- Events with a `trace` envelope export the shared attributes
  `crawclaw.traceId`, `crawclaw.spanId`, `crawclaw.parentSpanId`,
  `crawclaw.runId`, `crawclaw.sessionId`, `crawclaw.sessionKey`,
  `crawclaw.agentId`, `crawclaw.lifecycle.phase`, and
  `crawclaw.decisionCode` when those fields are present.
- Channel streaming decisions are exported as the metric
  `crawclaw.channel.streaming.decision` with attributes such as
  `crawclaw.channel`, `crawclaw.streaming.surface`,
  `crawclaw.streaming.reason`, and `crawclaw.streaming.enabled`.
- When traces are enabled, CrawClaw also exports
  `crawclaw.channel.streaming.decision` spans so channel delivery behavior can
  be correlated with the rest of the message-flow trace.
- Set `headers` when your collector requires auth.
- Environment variables supported: `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_PROTOCOL`.

### Exported metrics (names + types)

Model usage:

- `crawclaw.tokens` (counter, attrs: `crawclaw.token`, `crawclaw.channel`,
  `crawclaw.provider`, `crawclaw.model`)
- `crawclaw.cost.usd` (counter, attrs: `crawclaw.channel`, `crawclaw.provider`,
  `crawclaw.model`)
- `crawclaw.run.duration_ms` (histogram, attrs: `crawclaw.channel`,
  `crawclaw.provider`, `crawclaw.model`)
- `crawclaw.context.tokens` (histogram, attrs: `crawclaw.context`,
  `crawclaw.channel`, `crawclaw.provider`, `crawclaw.model`)

Message flow:

- `crawclaw.webhook.received` (counter, attrs: `crawclaw.channel`,
  `crawclaw.webhook`)
- `crawclaw.webhook.error` (counter, attrs: `crawclaw.channel`,
  `crawclaw.webhook`)
- `crawclaw.webhook.duration_ms` (histogram, attrs: `crawclaw.channel`,
  `crawclaw.webhook`)
- `crawclaw.message.queued` (counter, attrs: `crawclaw.channel`,
  `crawclaw.source`)
- `crawclaw.message.processed` (counter, attrs: `crawclaw.channel`,
  `crawclaw.outcome`)
- `crawclaw.message.duration_ms` (histogram, attrs: `crawclaw.channel`,
  `crawclaw.outcome`)

Queues + sessions:

- `crawclaw.queue.lane.enqueue` (counter, attrs: `crawclaw.lane`)
- `crawclaw.queue.lane.dequeue` (counter, attrs: `crawclaw.lane`)
- `crawclaw.queue.depth` (histogram, attrs: `crawclaw.lane` or
  `crawclaw.channel=heartbeat`)
- `crawclaw.queue.wait_ms` (histogram, attrs: `crawclaw.lane`)
- `crawclaw.session.state` (counter, attrs: `crawclaw.state`, `crawclaw.reason`)
- `crawclaw.session.stuck` (counter, attrs: `crawclaw.state`)
- `crawclaw.session.stuck_age_ms` (histogram, attrs: `crawclaw.state`)
- `crawclaw.run.attempt` (counter, attrs: `crawclaw.attempt`)
- `crawclaw.channel.streaming.decision` (counter, attrs: `crawclaw.channel`,
  `crawclaw.streaming.surface`, `crawclaw.streaming.reason`,
  `crawclaw.streaming.enabled`)

When a diagnostic event carries the internal trace envelope, the exporter also
adds the shared `crawclaw.traceId` / `crawclaw.spanId` correlation attributes to
the emitted metric attributes.

### Exported spans (names + key attributes)

- `crawclaw.run.lifecycle.<phase>`
  - `crawclaw.lifecycle.phase`, `crawclaw.decisionCode`
  - shared trace attributes when present
  - `crawclaw.metrics.*` and `crawclaw.refs.*` for small lifecycle metrics and
    references
- `crawclaw.model.usage`
  - `crawclaw.channel`, `crawclaw.provider`, `crawclaw.model`
  - `crawclaw.sessionKey`, `crawclaw.sessionId`
  - `crawclaw.tokens.*` (input/output/cache_read/cache_write/total)
- `crawclaw.webhook.processed`
  - `crawclaw.channel`, `crawclaw.webhook`, `crawclaw.chatId`
- `crawclaw.webhook.error`
  - `crawclaw.channel`, `crawclaw.webhook`, `crawclaw.chatId`,
    `crawclaw.error`
- `crawclaw.message.processed`
  - `crawclaw.channel`, `crawclaw.outcome`, `crawclaw.chatId`,
    `crawclaw.messageId`, `crawclaw.sessionKey`, `crawclaw.sessionId`,
    `crawclaw.reason`
- `crawclaw.session.stuck`
  - `crawclaw.state`, `crawclaw.ageMs`, `crawclaw.queueDepth`,
    `crawclaw.sessionKey`, `crawclaw.sessionId`
- `crawclaw.channel.streaming.decision`
  - `crawclaw.channel`, `crawclaw.streaming.surface`,
    `crawclaw.streaming.reason`, `crawclaw.streaming.enabled`
  - optional: `crawclaw.accountId`, `crawclaw.sessionKey`,
    `crawclaw.sessionId`, `crawclaw.chatId`

### Sampling + flushing

- Trace sampling: `diagnostics.otel.sampleRate` (0.0–1.0, root spans only).
- Metric export interval: `diagnostics.otel.flushIntervalMs` (min 1000ms).

### Protocol notes

- OTLP/HTTP endpoints can be set via `diagnostics.otel.endpoint` or
  `OTEL_EXPORTER_OTLP_ENDPOINT`.
- If the endpoint already contains `/v1/traces` or `/v1/metrics`, it is used as-is.
- If the endpoint already contains `/v1/logs`, it is used as-is for logs.
- `diagnostics.otel.logs` enables OTLP log export for the main logger output.

### Log export behavior

- OTLP logs use the same structured records written to `logging.file`.
- Respect `logging.level` (file log level). Console redaction does **not** apply
  to OTLP logs.
- High-volume installs should prefer OTLP collector sampling/filtering.

## Troubleshooting tips

- **Gateway not reachable?** Run `crawclaw doctor` first.
- **Logs empty?** Check that the Gateway is running and writing to the file path
  in `logging.file`.
- **Need more detail?** Set `logging.level` to `debug` or `trace` and retry.

## Related

- [Gateway Logging Internals](/gateway/logging) — WS log styles, subsystem prefixes, and console capture
- [Diagnostics](/gateway/configuration-reference#diagnostics) — OpenTelemetry export and cache trace config

---
summary: "Gateway health monitoring through CrawClaw Desktop and the Gateway API"
read_when:
  - Diagnosing channel connectivity or gateway health
  - Understanding desktop health checks and Gateway API probes
title: "Health Checks"
---

# Health Checks

Use CrawClaw Desktop for the normal health view. Use the Gateway API for
automation or external monitoring.

## Quick checks

- **Desktop status** — local Gateway reachability, runtime status, linked auth,
  sessions, and recent activity.
- **Desktop diagnostics** — paste-safe troubleshooting data and log access.
- **Gateway health API** — machine-readable health snapshots for automation.
- **Channel probes** — live checks for supported channels when deeper diagnosis
  is needed.

## Deep diagnostics

- Creds on disk: `~/.crawclaw/credentials/<channel>/<accountId>/`.
- Session store: `~/.crawclaw/agents/<agentId>/sessions/`.
- Logs: use CrawClaw Desktop logs or host log collection for the Gateway process.
- Relink flow: use the channel settings panel when auth status codes or
  `loggedOut` appear in logs.

## Health monitor config

- `gateway.channelHealthCheckMinutes`: how often the Gateway checks channel health.
- `gateway.channelStaleEventThresholdMinutes`: how long a connected channel can stay idle before restart.
- `gateway.channelMaxRestartsPerHour`: rolling one-hour restart cap per channel/account.
- `channels.<provider>.healthMonitor.enabled`: per-channel override.
- `channels.<provider>.accounts.<accountId>.healthMonitor.enabled`: per-account override.

## When something fails

- **Gateway unreachable** — restart from CrawClaw Desktop and verify the embedded
  Rust runtime is ready.
- **Channel logged out** — relink the account from desktop channel settings.
- **No inbound messages** — confirm sender allowlists and group mention rules.

For API-level details, see [Gateway protocol](/gateway/protocol) and
[Gateway troubleshooting](/gateway/troubleshooting).

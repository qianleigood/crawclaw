---
summary: "Legacy agent heartbeat status, compatibility surfaces, and replacements"
read_when:
  - Migrating old heartbeat configuration
  - Deciding how to replace periodic main-session checks
  - Distinguishing agent heartbeat from keepalive mechanisms
title: "Heartbeat"
---

# Heartbeat

Legacy agent heartbeat was the old periodic main-session model poll. It asked
the agent to inspect `HEARTBEAT.md`, reply with `HEARTBEAT_OK` when idle, and
optionally deliver alerts to a chat target.

That periodic agent poll is no longer configured by default. Do not use legacy
heartbeat config for new automation. Use [Scheduled Tasks](/automation/cron-jobs)
for time-based checks and [system events](/cli/system) for event-driven
main-session wakes.

## What changed

- The Gateway no longer installs a default periodic heartbeat cadence.
- `agents.defaults.heartbeat.every`, per-agent `heartbeat.every`, and
  `activeHours` are no longer accepted as config keys.
- Runtime `system heartbeat enable` and `system heartbeat disable` controls were
  removed.
- `HEARTBEAT.md` is no longer required for automatic periodic checks. Existing
  files can stay in a workspace as normal notes, but new automation should live
  in cron jobs, hooks, or standing orders.
- `HEARTBEAT_OK` should not be used as an automation contract for new flows.
- `crawclaw system heartbeat last` remains as a compatibility inspection command
  for the most recent wake/heartbeat diagnostic event.

## Use these instead

| Need                                                | Use                                            |
| --------------------------------------------------- | ---------------------------------------------- |
| Run a check every N minutes or at a wall-clock time | [Scheduled Tasks](/automation/cron-jobs)       |
| Run in the main session after a system event        | [`crawclaw system event`](/cli/system)         |
| React to lifecycle, hooks, or external events       | [Hooks](/automation/hooks)                     |
| Keep always-on instructions in context              | [Standing Orders](/automation/standing-orders) |
| Track detached work and completion state            | [Background Tasks](/automation/tasks)          |

For context-aware periodic checks, create a cron job that targets the main
session. For precise or isolated work, create a normal cron job with its own
task record.

## Compatibility notes

Some diagnostic RPC names still contain `heartbeat` for older clients. Treat
those names as read-only diagnostics, not as an automation model.

- `crawclaw system heartbeat last` reads the last diagnostic event. It does not
  enable scheduling.
- `last-heartbeat` and `system.heartbeat.last` RPC methods are read-only
  compatibility aliases.
- `next-heartbeat` is no longer accepted as a wake-mode value. Use `now` for
  event-driven main-session wakes.

## Not removed

Do not delete or disable every feature named heartbeat. These mechanisms are not
legacy agent heartbeat:

- WhatsApp Web `web.heartbeatSeconds` keeps the Web channel connection observable.
- NotebookLM auth heartbeat checks authentication health.
- WebSocket, gateway, and provider heartbeat or ping frames keep protocol
  connections alive.

Those keepalive and auth paths continue to use their existing names and config
for compatibility.

## Migration checklist

1. Remove `agents.defaults.heartbeat.every`, per-agent heartbeat cadence
   settings, and `activeHours` from configs.
2. Move scheduled checks to [Scheduled Tasks](/automation/cron-jobs).
3. Move event-driven follow-ups to [`crawclaw system event`](/cli/system) or
   hooks.
4. Keep channel keepalive settings such as `web.heartbeatSeconds` unchanged.
5. Use `crawclaw system heartbeat last --json` only for diagnostics while older
   event names are still present.

## Related

- [Automation & Tasks](/automation)
- [Scheduled Tasks](/automation/cron-jobs)
- [Background Tasks](/automation/tasks)
- [System CLI](/cli/system)
- [WhatsApp](/channels/whatsapp)

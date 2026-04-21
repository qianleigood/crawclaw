---
summary: "CLI reference for `crawclaw system` (system events, heartbeat diagnostics, presence)"
read_when:
  - You want to enqueue a system event without creating a cron job
  - You want to inspect the latest wake or heartbeat diagnostic event
  - You want to inspect system presence entries
title: "system"
---

# `crawclaw system`

System-level helpers for the Gateway: enqueue system events, inspect legacy
heartbeat diagnostics, and view presence.

## Common commands

```bash
crawclaw system event --text "Check for urgent follow-ups" --mode now
crawclaw system heartbeat last
crawclaw system presence
```

## `system event`

Enqueue a system event on the **main** session. The next main-session run will
inject it as a `System:` line in the prompt. Use `--mode now` to trigger the
main-session wake immediately. `now` is the default. `next-heartbeat` is a
legacy-compatible mode name that requests the same event-driven wake; it no
longer waits for a periodic heartbeat tick.

Flags:

- `--text <text>`: required system event text.
- `--mode <mode>`: `now` (default) or `next-heartbeat`.
- `--json`: machine-readable output.

## `system heartbeat last`

Heartbeat diagnostic inspection:

- `last`: show the latest heartbeat or main-session wake diagnostic event.

Flags:

- `--json`: machine-readable output.

## `system presence`

List the current system presence entries the Gateway knows about (nodes,
instances, and similar status lines).

Flags:

- `--json`: machine-readable output.

## Notes

- Requires a running Gateway reachable by your current config (local or remote).
- System events are ephemeral and not persisted across restarts.
- Legacy periodic agent heartbeat cannot be enabled from this command group.
  Use [Scheduled Tasks](/automation/cron-jobs) for new scheduled checks.

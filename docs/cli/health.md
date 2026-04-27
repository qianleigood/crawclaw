---
summary: "CLI reference for `crawclaw health` (gateway health endpoint via RPC)"
read_when:
  - You want to quickly check the running Gateway’s health
title: "health"
---

# `crawclaw health`

Run the normal live Gateway health check. This is the user-facing health entry:
it formats the Gateway health RPC output, includes session/agent context, and
can probe channel accounts with `--verbose`.

```bash
crawclaw health
crawclaw health --json
crawclaw health --verbose
```

Notes:

- `crawclaw gateway health` is the lower-level Gateway namespace command for
  directly calling the health RPC. Prefer `crawclaw health` for day-to-day
  checks.
- `--verbose` runs live probes and prints per-account timings when multiple accounts are configured.
- Output includes per-agent session stores when multiple agents are configured.

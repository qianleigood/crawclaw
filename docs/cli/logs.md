---
summary: "CLI reference for `crawclaw logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `crawclaw logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
crawclaw logs
crawclaw logs --follow
crawclaw logs --json
crawclaw logs --limit 500
crawclaw logs --local-time
crawclaw logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.

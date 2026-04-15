---
summary: "CLI reference for `crawclaw uninstall` (remove gateway service + local data)"
read_when:
  - You want to remove the gateway service and/or local state
  - You want a dry-run first
title: "uninstall"
---

# `crawclaw uninstall`

Uninstall the gateway service + local data (CLI remains).

```bash
crawclaw backup create
crawclaw uninstall
crawclaw uninstall --all --yes
crawclaw uninstall --dry-run
```

Run `crawclaw backup create` first if you want a restorable snapshot before removing state or workspaces.

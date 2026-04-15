---
summary: "Redirect: flow commands live under `crawclaw tasks flow`"
read_when:
  - You encounter crawclaw flows in older docs or release notes
title: "flows (redirect)"
---

# `crawclaw tasks flow`

Flow commands are subcommands of `crawclaw tasks`, not a standalone `flows` command.

```bash
crawclaw tasks flow list [--json]
crawclaw tasks flow show <lookup>
crawclaw tasks flow cancel <lookup>
```

For full documentation see [Task Flow](/automation/taskflow) and the [tasks CLI reference](/cli/index#tasks).

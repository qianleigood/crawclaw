---
summary: "CLI reference for `crawclaw setup` (initialize config + workspace)"
read_when:
  - You’re doing first-run setup without full CLI onboarding
  - You want to set the default workspace path
title: "setup"
---

# `crawclaw setup`

Initialize `~/.crawclaw/crawclaw.json` and the agent workspace.

Related:

- Getting started: [Getting started](/start/getting-started)
- CLI onboarding: [Onboarding (CLI)](/start/wizard)

## Examples

```bash
crawclaw setup
crawclaw setup --workspace ~/.crawclaw/workspace
```

To run onboarding via setup:

```bash
crawclaw setup --wizard
```

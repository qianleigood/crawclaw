---
summary: "CLI reference for `crawclaw approvals` (exec approvals for local and gateway hosts)"
read_when:
  - You want to edit exec approvals from the CLI
  - You need to manage allowlists on local or gateway hosts
title: "approvals"
---

# `crawclaw approvals`

Manage exec approvals for the **local host** or **gateway host**.
By default, commands target the local approvals file on disk. Use `--gateway` to target the gateway.

Related:

- Exec approvals: [Exec approvals](/tools/exec-approvals)

## Common commands

```bash
crawclaw approvals get
crawclaw approvals get --gateway
```

`crawclaw approvals get` shows the effective exec policy for local and gateway targets:

- requested `tools.exec` policy
- host approvals-file policy
- effective result after precedence rules are applied

Precedence is intentional:

- the host approvals file is the enforceable source of truth
- requested `tools.exec` policy can narrow or broaden intent, but the effective result is still derived from the host rules

## Replace approvals from a file

```bash
crawclaw approvals set --file ./exec-approvals.json
crawclaw approvals set --gateway --file ./exec-approvals.json
```

## "Never prompt" / YOLO example

For a host that should never stop on exec approvals, set the host approvals defaults to `full` + `off`:

```bash
crawclaw approvals set --stdin <<'EOF'
{
  version: 1,
  defaults: {
    security: "full",
    ask: "off",
    askFallback: "full"
  }
}
EOF
```

This changes the **host approvals file** only. To keep the requested CrawClaw policy aligned, also set:

```bash
crawclaw config set tools.exec.host gateway
crawclaw config set tools.exec.security full
crawclaw config set tools.exec.ask off
```

Why `tools.exec.host=gateway` in this example:

- YOLO is about approvals, not routing.

This matches the current host-default YOLO behavior. Tighten it if you want approvals.

## Allowlist helpers

```bash
crawclaw approvals allowlist add "~/Projects/**/bin/rg"
crawclaw approvals allowlist add --agent "*" "/usr/bin/uname"

crawclaw approvals allowlist remove "~/Projects/**/bin/rg"
```

## Notes

- `--agent` defaults to `"*"`, which applies to all agents.
- Approvals files are stored per host at `~/.crawclaw/exec-approvals.json`.

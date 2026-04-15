---
summary: "CLI reference for `crawclaw agents` (list/status/add/delete/bindings/bind/unbind/set identity/harness)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `crawclaw agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
crawclaw agents list
crawclaw agents status
crawclaw agents add work --workspace ~/.crawclaw/workspace-work
crawclaw agents bindings
crawclaw agents bind --agent work --bind telegram:ops
crawclaw agents unbind --agent work --bind telegram:ops
crawclaw agents set-identity --workspace ~/.crawclaw/workspace --from-identity
crawclaw agents set-identity --agent main --avatar avatars/crawclaw.png
crawclaw agents harness report --json
crawclaw agents harness promote-check --baseline baseline.json --candidate candidate.json
crawclaw agents delete work
```

## `agents status`

`crawclaw agents status` builds an ops-oriented summary across configured agents.

It combines:

- local session/store activity
- runtime/task counts
- stale runtime counts
- recent guard blockers
- completion blockers
- loop warning buckets / progress warnings

Examples:

```bash
crawclaw agents status
crawclaw agents status --json
```

## `agents harness`

Use the offline harness commands to evaluate loop/completion policy changes before promotion.

Generate a builtin scenario report:

```bash
crawclaw agents harness report
crawclaw agents harness report --scenario fix-complete --json
```

Compare a candidate report against a baseline:

```bash
crawclaw agents harness promote-check --baseline baseline.json --candidate candidate.json
crawclaw agents harness promote-check --baseline baseline.json --candidate candidate.json --json
```

`promote-check` does not change live policy. It only emits an offline verdict:
`promote`, `shadow`, or `reject`.

## Routing bindings

Use routing bindings to pin inbound channel traffic to a specific agent.

List bindings:

```bash
crawclaw agents bindings
crawclaw agents bindings --agent work
crawclaw agents bindings --json
```

Add bindings:

```bash
crawclaw agents bind --agent work --bind telegram:ops --bind discord:guild-a
```

If you omit `accountId` (`--bind <channel>`), CrawClaw resolves it from channel defaults and plugin setup hooks when available.

### Binding scope behavior

- A binding without `accountId` matches the channel default account only.
- `accountId: "*"` is the channel-wide fallback (all accounts) and is less specific than an explicit account binding.
- If the same agent already has a matching channel binding without `accountId`, and you later bind with an explicit or resolved `accountId`, CrawClaw upgrades that existing binding in place instead of adding a duplicate.

Example:

```bash
# initial channel-only binding
crawclaw agents bind --agent work --bind telegram

# later upgrade to account-scoped binding
crawclaw agents bind --agent work --bind telegram:ops
```

After the upgrade, routing for that binding is scoped to `telegram:ops`. If you also want default-account routing, add it explicitly (for example `--bind telegram:default`).

Remove bindings:

```bash
crawclaw agents unbind --agent work --bind telegram:ops
crawclaw agents unbind --agent work --all
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.crawclaw/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
crawclaw agents set-identity --workspace ~/.crawclaw/workspace --from-identity
crawclaw agents set-identity --identity-file ~/.crawclaw/workspace/IDENTITY.md --agent main
```

Override fields explicitly:

```bash
crawclaw agents set-identity --agent main --name "CrawClaw" --emoji "🦞" --avatar avatars/crawclaw.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "CrawClaw",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/crawclaw.png",
        },
      },
    ],
  },
}
```

---
name: coding-agent
description: Use when a coding task should be delegated to Codex, Claude Code, OpenCode, or Pi in a separate workdir, temp review workspace, background run, or focused implementation agent.
metadata:
  {
    "crawclaw":
      {
        "emoji": "🧩",
        "requires": { "anyBins": ["claude", "codex", "opencode", "pi"] },
        "install":
          [
            {
              "id": "node-claude",
              "kind": "node",
              "package": "@anthropic-ai/claude-code",
              "bins": ["claude"],
              "label": "Install Claude Code CLI (npm)",
            },
            {
              "id": "node-codex",
              "kind": "node",
              "package": "@openai/codex",
              "bins": ["codex"],
              "label": "Install Codex CLI (npm)",
            },
          ],
      },
  }
---

# Coding Agent

Use `bash` to delegate coding work to Codex, Claude Code, OpenCode, or Pi.

## Rules

- Use `pty:true` for `codex`, `pi`, and `opencode`.
- Do not use PTY for `claude`; use `claude --permission-mode bypassPermissions --print`.
- Set `workdir` to the project you want the agent to see.
- For Codex scratch work, create a temp git repo first.
- For PR review, use a temp clone or git worktree, not the live checkout.
- For long jobs, use `background:true` and monitor with `process`.

## Good defaults

```bash
# Codex
bash pty:true workdir:~/project command:"codex exec --full-auto 'Implement the fix'"

# Claude Code
bash workdir:~/project command:"claude --permission-mode bypassPermissions --print 'Review this module'"

# Background run
bash pty:true workdir:~/project background:true command:"codex exec --full-auto 'Refactor auth flow'"
process action:log sessionId:<id>
```

## Process actions

- `list`
- `poll`
- `log`
- `write`
- `submit`
- `kill`

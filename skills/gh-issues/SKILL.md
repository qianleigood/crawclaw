---
name: gh-issues
description: Use when a repository has GitHub issues, review requests, labels, milestones, or watch-mode triage that should be selected and handled with GitHub CLI access.
user-invocable: true
metadata:
  {
    "crawclaw":
      {
        "requires": { "bins": ["curl", "git", "gh"] },
        "primaryEnv": "GH_TOKEN",
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "gh",
              "bins": ["gh"],
              "label": "Install GitHub CLI (brew)",
            },
          ],
      },
  }
---

# gh-issues

Use this skill to fetch GitHub issues, decide which ones to act on, and spawn background agents to implement fixes or address review comments.

## Workflow

1. Parse flags and resolve `SOURCE_REPO`. If it is omitted, infer it from `git remote get-url origin`.
2. Resolve `GH_TOKEN` from env first, then from CrawClaw config.
3. Fetch issues with curl and GitHub REST API.
4. Filter out pull requests.
5. Show a compact issue table.
6. Stop on `--dry-run`; otherwise confirm selection unless `--yes` or `--cron`.
7. Run pre-flight checks:
   - `git status --porcelain`
   - `git rev-parse --abbrev-ref HEAD`
   - `git ls-remote --exit-code ...`
8. Spawn the worker agents or review handlers.
9. If `--watch` is set, poll again and process only new work.

## Flags

- `--label`
- `--limit`
- `--milestone`
- `--assignee`
- `--state`
- `--fork`
- `--watch`
- `--interval`
- `--dry-run`
- `--yes`
- `--reviews-only`
- `--cron`
- `--model`
- `--notify-channel`

## Rules

- Use curl plus GitHub REST API for reads.
- In fork mode, push branches to the fork and target the source repo with PRs.
- In cron mode, skip interactive confirmation and exit after dispatching work.
- If auth fails, stop with a clear config hint instead of guessing.

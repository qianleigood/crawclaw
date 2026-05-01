---
name: github
description: Use when inspecting or changing GitHub repository data with gh or gh api, including PRs, issues, comments, checks, workflow runs, releases, or repo metadata.
metadata:
  {
    "crawclaw":
      {
        "emoji": "🐙",
        "requires": { "bins": ["gh"] },
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

# GitHub Skill

Use the `gh` CLI to interact with GitHub repositories, issues, PRs, and workflow runs.

## Use it for

- checking PR status, reviews, or merge readiness
- viewing workflow runs and logs
- creating or commenting on issues and PRs
- running `gh api` queries for repository data

## Do not use it for

- local git operations
- non-GitHub remotes
- cloning repos
- code review itself; use a coding skill for that

## Common commands

```bash
# Pull requests
gh pr list --repo owner/repo
gh pr view 55 --repo owner/repo
gh pr checks 55 --repo owner/repo
gh pr create --title "feat: add feature" --body "Description"
gh pr merge 55 --squash --repo owner/repo

# Issues
gh issue list --repo owner/repo --state open
gh issue create --title "Bug: something broken" --body "Details..."
gh issue close 42 --repo owner/repo

# Workflow runs
gh run list --repo owner/repo --limit 10
gh run view <run-id> --repo owner/repo
gh run view <run-id> --repo owner/repo --log-failed
gh run rerun <run-id> --failed --repo owner/repo

# API
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## Notes

- Always specify `--repo owner/repo` when not in a git directory.
- You can pass a full PR URL directly to many `gh pr` commands.
- Prefer `--json` plus `--jq` when you need structured output.

---
summary: "CLI reference for `crawclaw improve` proposal inbox, review, apply, verify, rollback, and metrics"
read_when:
  - You want to review or apply CrawClaw improvement proposals
  - You need to inspect skill or workflow promotion evidence
  - You want to rollback an applied improvement proposal
title: "improve"
---

# `crawclaw improve`

Review and apply governed improvement proposals produced by CrawClaw's
experience-to-skill and experience-to-workflow promotion loop.

Related:

- Learning loop: [Learning loop](/concepts/learning-loop)
- Skills and workflows: [Skill vs workflow](/concepts/skill-vs-workflow)
- Memory: [Memory](/concepts/memory)

## Examples

```bash
crawclaw improve run
crawclaw improve inbox
crawclaw improve inbox --status pending_review,approved --kind skill --json
crawclaw improve show proposal-123
crawclaw improve review proposal-123 --approve --reviewer maintainer
crawclaw improve review proposal-123 --reject --comments "Needs more evidence"
crawclaw improve apply proposal-123
crawclaw improve verify proposal-123
crawclaw improve rollback proposal-123
crawclaw improve metrics --json
```

## Options

`improve run`:

- `--json`: print machine-readable run output.

`improve inbox`:

- `--status <csv>`: filter by proposal status, such as `pending_review` or
  `applied`.
- `--kind <csv>`: filter by proposal kind: `skill`, `workflow`, or `code`.
- `--limit <n>`: cap the proposal count. Defaults to `50`.
- `--json`: print machine-readable proposal list output.

`improve show <id>`:

- `--json`: print the full proposal detail, evidence refs, policy blockers,
  and available actions.

`improve review <id>`:

- `--approve`: approve the proposal.
- `--reject`: reject the proposal.
- `--reviewer <name>`: record the reviewer name.
- `--comments <text>`: record review comments.
- `--json`: print the updated proposal.

`improve apply <id>`, `improve verify <id>`, `improve rollback <id>`, and
`improve metrics`:

- `--json`: print machine-readable output.

## Behavior

- Proposals are stored under the workspace-local `.crawclaw/improvements`
  directory.
- `improve run` scans existing experience signals and can create a new proposal.
- `improve inbox` is the proposal queue for reviewable skill and workflow
  promotions.
- `improve show` displays the evidence refs, risk, policy blockers, and patch
  preview before you approve anything.
- `improve apply` requires an approved review and a passing policy gate.
- `improve rollback` uses the recorded application artifact. Generated skills
  are deleted or restored from their previous markdown; workflow updates use
  workflow version rollback when a previous version exists.
- Code improvement proposals are visible in the inbox, but they cannot be
  applied or rolled back automatically. They must go through a manual isolated
  worktree and review flow.

## TUI

The terminal UI also exposes the same review surface:

```text
/improve
/improve <proposal-id>
/improve run
```

Use the detail overlay to approve, reject, apply, verify, or rollback a proposal
without leaving `crawclaw tui`.

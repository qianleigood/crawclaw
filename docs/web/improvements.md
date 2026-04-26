---
summary: "Local browser UI for reviewing CrawClaw self-improvement proposals"
read_when:
  - You want to review Improvement Center proposals without using the CLI
  - You need a beginner-readable view of skills, workflows, risk, evidence, and rollback
title: "Improvement Center"
---

# Improvement Center

Improvement Center is a local browser page for reviewing CrawClaw self-improvement proposals.
Open it on the Gateway HTTP port:

```text
http://127.0.0.1:18789/improvements
```

The page uses the same proposal store and safety rules as `crawclaw improve` and TUI
`/improve`. It does not create a second state machine.

## What You Can Do

- Run a scan for repeated, validated work.
- Read an inbox of proposals by status, type, risk, confidence, and update time.
- Open one proposal and read a plain-language summary before technical details.
- Review evidence, policy result, verification plan, rollback plan, and patch preview.
- Approve, reject, apply, verify, or rollback a proposal when that action is allowed.

Code proposals are display-only. They cannot be applied, verified, or rolled back from the
browser page because code changes still require an isolated worktree and normal review.

## Safety Model

The browser page talks to authenticated Gateway WebSocket RPC methods:

- `improvement.list`
- `improvement.get`
- `improvement.metrics`
- `improvement.run`
- `improvement.review`
- `improvement.apply`
- `improvement.verify`
- `improvement.rollback`

Read-only methods require `operator.read`. Mutating methods require `operator.write` and use
the same control-plane write rate limit as other Gateway write operations.

The page delegates all proposal state changes to `src/improvement/center.ts`. It does not read
or write `.crawclaw/improvements` directly.

## Review Flow

1. Open `/improvements`.
2. Select a proposal from the inbox.
3. Read the summary, reason, safety check, and change summary first.
4. Inspect evidence, verification plan, rollback plan, and patch preview.
5. Approve or reject the proposal.
6. Apply approved Skill or Workflow proposals.
7. Verify the applied proposal.
8. Roll back only from the recorded application artifact when needed.

## Authentication

The HTTP page uses normal Gateway HTTP auth. The browser client then connects to the Gateway
WebSocket and sends operator scopes for read and write actions.

If your Gateway requires a token, paste the token into the page when prompted. The page stores
that token in browser local storage for the local Gateway origin.

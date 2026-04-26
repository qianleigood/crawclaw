# Improvement Center UI v2.1 Design

## Summary

Add a local, beginner-readable UI for Improvement Center proposals. The UI is
not a new execution engine. It is a product surface over the existing
Improvement Center API, so CLI, TUI, and UI keep the same proposal state,
policy gates, apply behavior, verification, and rollback semantics.

The first UI should use an `Inbox + Detail` structure:

- the inbox helps users find proposals by status, kind, risk, and recency
- the detail page explains one proposal in plain language before exposing
  evidence, policy, and patch preview
- actions stay explicit: approve, reject, apply, verify, rollback

The design intentionally optimizes for users who do not already understand
skills, workflows, verdicts, policy gates, or rollback artifacts.

## Goals

- Make self-improvement proposals understandable to a first-time CrawClaw user.
- Keep the UI local-first and workspace-scoped.
- Reuse `src/improvement/center.ts` as the only product API for proposal state
  changes.
- Preserve the v1 and v2 safety model: no automatic code modification, no apply
  without review, and no bypass around policy gates.
- Show enough context for a user to answer three questions:
  - What did CrawClaw notice?
  - What will change if I approve this?
  - Is it safe and reversible?
- Keep CLI and TUI behavior unchanged.

## Non-Goals

- Do not add a hosted or team review service.
- Do not add login, multi-user approval, comments, or notifications.
- Do not make code proposals auto-applyable.
- Do not create a second proposal store or a UI-only state machine.
- Do not replace the existing `crawclaw improve` CLI or `/improve` TUI path.
- Do not expose raw proposal JSON as the primary reading experience.

## Product Direction

Use `Inbox + Detail` as the main structure.

The inbox is the working queue. It should look less like developer output and
more like a review queue:

- title in plain language
- proposal kind: skill, workflow, or code
- status: pending review, approved, applied, failed, rolled back, and so on
- risk: low, medium, high
- confidence: low, medium, high
- last updated time
- one-line reason why CrawClaw created it

The detail page should use a beginner-first explanation order:

1. Plain-language summary
2. Why CrawClaw thinks this is reusable
3. Safety and risk explanation
4. What will change
5. Evidence and validation
6. Available actions
7. Technical details for advanced users

This keeps the first read approachable while still giving maintainers the
evidence and patch preview they need before approving anything.

## User Experience

### Empty State

When there is no `.crawclaw/improvements` store or no proposals, the UI should
not show an error. It should explain:

- there are no improvement proposals yet
- the user can run a scan
- scans look for repeated, validated work that may be promoted into skills or
  workflows

Primary action: `Run scan`.

### Inbox

The inbox should default to reviewable work first:

1. `pending_review`
2. `approved`
3. `policy_blocked`
4. `failed`
5. `applied`
6. `rolled_back`
7. lower-priority historical states

Filters:

- status
- kind
- risk
- confidence

Each row should avoid internal jargon where possible. For example:

- Good: `Suggested Skill: release checklist`
- Avoid as the main label: `proposal-abc123 propose_skill high confidence`

Proposal IDs remain visible, but they should be secondary metadata.

### Detail Page

The detail page should start with a readable decision block:

- `CrawClaw suggests creating a Skill`
- `Reason: this pattern appeared 4 times and had validation evidence`
- `Risk: low, because it only writes to workspace .agents/skills`
- `Rollback: delete the generated Skill file`

Then show the full information in expandable or clearly separated sections.

Sections:

- `Summary`
- `Why this was suggested`
- `Safety check`
- `What will change`
- `Evidence`
- `Verification plan`
- `Rollback plan`
- `Technical details`

### Patch Preview

Patch preview must be readable before it is complete.

For skill proposals:

- show target path
- show generated `SKILL.md` preview
- show whether this creates a new skill or overwrites an existing skill
- if overwriting, show that previous markdown will be restored on rollback

For workflow proposals:

- show workflow target
- show whether it creates or updates a workflow
- show `requiresApproval=true`
- show `safeForAutoRun=false`
- show the registry version or snapshot behavior

For code proposals:

- show summary and recommended worktree flow
- disable apply, verify, and rollback actions
- explain that code proposals require manual isolated implementation and review

### Actions

Actions should be visible only when valid for the current proposal state.

Every destructive or irreversible-looking action should show a confirmation
dialog with plain-language consequences:

- `Approve`: records human approval, does not apply yet
- `Reject`: closes the proposal without changing files
- `Apply`: writes the approved skill or workflow change
- `Verify`: runs the proposal verification checks
- `Rollback`: restores the recorded application artifact

The UI should use disabled states with an explanation rather than hiding all
unavailable actions. Example:

`Apply disabled: this proposal still needs approval.`

## Information Design For Beginners

The UI must translate internal terms into user-facing language.

Preferred labels:

- `Suggested Skill` instead of only `propose_skill`
- `Suggested Workflow` instead of only `propose_workflow`
- `Needs review` instead of only `pending_review`
- `Blocked by policy` instead of only `policy_blocked`
- `Can be undone` instead of only `rollbackPlan`

Advanced terms can still appear in technical detail sections:

- candidate ID
- verdict decision
- policy result
- proposal status
- source refs
- patch plan

The first screen should not require understanding those terms.

## Architecture

The UI should be a frontend over the existing product API:

```text
UI route
  -> local control-plane method or local UI bridge
  -> src/improvement/center.ts
  -> src/improvement/store.ts
  -> src/improvement/runner.ts
```

The UI must not read `.crawclaw/improvements` directly. It should consume
structured responses from `center.ts` or a thin gateway/control-plane adapter
that delegates to `center.ts`.

The adapter should expose only product operations:

- list proposals
- get proposal detail
- run scan
- review proposal
- apply proposal
- verify proposal
- rollback proposal
- summarize metrics

This keeps CLI, TUI, and UI behavior aligned.

## API Shape

The UI can start from the existing `ImprovementProposalDetail` shape, but it
should not force the frontend to render raw proposal objects directly. Add a
view-model adapter if needed.

Recommended view model:

- `id`
- `title`
- `plainSummary`
- `kindLabel`
- `statusLabel`
- `riskLabel`
- `confidenceLabel`
- `canUndo`
- `primaryReason`
- `safetySummary`
- `changeSummary`
- `evidenceItems`
- `patchPreview`
- `availableActions`
- `disabledActions`
- `technicalDetails`

This view model can live near the UI adapter or in the improvement center layer
if CLI and TUI also benefit from the same readable labels.

## Error Handling

Known `ImprovementCenterError` codes should map to clear user messages:

- `not_found`: proposal no longer exists
- `policy_blocked`: policy does not allow applying this proposal
- `review_required`: approval is required before applying
- `apply_not_supported`: this proposal type cannot be applied automatically
- `rollback_not_supported`: this proposal has no supported rollback path
- `verification_failed`: verification ran and failed

Unexpected errors should show:

- short message
- proposal ID when available
- suggested next action, such as retry, inspect CLI output, or open technical
  details

The UI must not show stack traces by default.

## Visual Design Constraints

- Use dense but readable operational layout, not a marketing page.
- Prefer tables/lists for inbox scanning and structured panels for details.
- Use badges for status, risk, confidence, and kind.
- Keep copy short and plain.
- Do not place cards inside cards.
- Do not use decorative gradients or large hero sections.
- Make action consequences visible near buttons.
- Ensure mobile or narrow-window layout stacks into a readable single column.

## Testing Plan

Unit tests:

- view-model mapping for skill, workflow, and code proposals
- action availability and disabled reasons
- error-code to user-message mapping
- empty store and empty inbox behavior

Integration tests:

- list proposals through the UI adapter
- open proposal detail through the UI adapter
- approve, apply, verify, and rollback through `center.ts`
- confirm code proposals cannot apply

UI tests:

- empty state is readable
- inbox sorts reviewable proposals first
- detail page shows beginner summary before technical details
- invalid actions are disabled with an explanation
- rollback confirmation explains what will be restored or removed

Regression tests:

- CLI `crawclaw improve` commands still work
- TUI `/improve` still works
- promotion judge special-agent guardrails remain unchanged

## Rollout Plan

Phase 1:

- add the UI adapter or control-plane method
- add read-only inbox and detail page
- add empty state and scan action

Phase 2:

- add approve and reject
- add apply, verify, and rollback with confirmations
- add readable error mapping

Phase 3:

- add metrics/history view
- improve patch preview formatting
- consider guided onboarding copy once real usage reveals confusing points

## Implementation Defaults

- Host surface: integrate this as a local Control UI page. Do not create a
  standalone web app for v2.1. If implementation inspection proves the current
  Control UI shell cannot host the page cleanly, stop and return with the
  smallest viable bridge proposal before writing product code.
- Component style: follow the active Control UI component system at
  implementation time. Do not introduce a new UI kit only for Improvement
  Center.
- Metrics depth: keep metrics secondary unless existing proposal data supports
  them without adding new persistence fields.

## Success Criteria

- A new user can tell what a proposal does without reading JSON.
- A maintainer can verify evidence, risk, and patch preview before approval.
- No UI action bypasses `center.ts`, policy gates, review requirements, or
  rollback recording.
- Code proposals remain display-only.
- CLI and TUI behavior continue to pass existing tests.

# Grok Video Web Extend Rules

## Extend vs redo

Treat **extend video** as distinct from **redo video**.

- `redo` re-renders or regenerates from an existing result lineage
- `extend` derives a **new longer video** from an already finished source result video

Do not model extend as “redo first, then extend”.

## Source / derived lineage

For extend attempts, keep lineage explicit:

- `sourcePostId` / `sourceResultUrl` point at the finished source result page
- `newPostId` / `newResultUrl` remain empty until the extend flow actually produces a new result page
- `extendDuration` records the selected or intended `+6s` / `+10s`
- `timelineMode` records whether timeline UI was detected, adjusted, or stopped at manual handoff

Even if the run stops before final submit, preserve source-side lineage and the current handoff state.

## Timeline probing and targeting

Current timeline behavior should remain conservative.

Expected timeline probe fields include:

- `timelineMode`: `not_detected` / `timeline_detected` / `manual_handoff`
- counts for container, track, selection, handle, trim, slider, and range inputs
- condensed probe signals
- unresolved parts in `unknowns`
- best-effort `currentSelection` with start/end percentages when safely available

Interpretation rules:

- if only container/track/trim-style hints exist, keep `timelineMode = timeline_detected`
- if handles / sliders / range inputs / selection region become visible, upgrade to `timelineMode = manual_handoff`
- if selection start/end cannot be resolved, record that honestly instead of inventing coordinates
- when a stable page-local range label exists (for example a visible `0:06 → 0:12` button), treat that label as the strongest validation source for pre/post-drag range confirmation

## Timeline request fields

When timeline targeting is requested, the runner may persist fields such as:

- `timeline_start_pct`
- `timeline_end_pct`
- `timeline_tolerance_pct`

These values are targets, not proof of successful adjustment.

## Validation rule

If timeline drag or target confirmation cannot be validated safely:

- do **not** claim it succeeded
- stop at probe / state / handoff
- preserve lineage and handoff instructions honestly

For fixed-window or constrained timeline UI, reject impossible target requests instead of faking completion.
For fixed-window trims that expose only one safe drag handle, accept success when the visible range label changes in the expected direction and keeps the same practical window length, even if raw percentage math drifts because the UI re-normalizes the container.

## Manual handoff rule

If final extend submit or timeline correction still needs a person:

- keep the same job
- keep the same profile
- prefer the same page or same active result-flow context
- preserve explicit resume hints and current observed state

Do not spawn a fresh unrelated run if the existing handoff state is still valid.

## Derived result capture trust rule

A new result-like URL should only be treated as a trusted derived result when capture conditions are credible.

Prefer capture patterns such as:

- primary page navigates to a new result after auto-submit
- a new tab/context page opens to a new `/imagine/post/<id>` during the same watched extend flow
- the newly observed post id differs from the source post id

Do not trust a candidate derived URL blindly if it appears without a credible navigation shape.

## Output expectations for extend

Return or persist:

- `sourcePostId`
- `sourceResultUrl`
- `newPostId`
- `newResultUrl`
- `extendDuration`
- `timelineMode`
- timeline request/evaluation fields when available
- whether manual handoff is still required

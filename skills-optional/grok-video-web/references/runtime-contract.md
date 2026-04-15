# Grok Video Web Runtime Contract

## Job workspace layout

Runtime artifacts should live under a job-scoped workspace:

```text
runtime/browser-jobs/grok-video-web/<job-id>/
  uploads/
  downloads/
  exports/
  state/
```

Use one job directory per logical workflow.

## Core state files

Common state files under `state/` include:

- `job.json` — manifest and long-lived job metadata
- `request.json` — requested prompt, parameters, references, and action intent
- `status.json` — current workflow status snapshot
- `checkpoints.json` — ordered workflow checkpoints
- `block-reason.json` — current blocker summary when the workflow is blocked
- `result-url.txt` — resolved result URL when known
- `events.jsonl` — structured runtime log stream

Action-specific files may also appear, for example:

- `runtime-state.json`
- `login-state.json`
- `run-handoff.json`
- `submit.json`
- `submit-handoff.json`
- `wait-status.json`
- `download-status.json`
- `reference-upload.json`
- `extend.json`
- `extend-handoff.json`
- `redo.json`
- `lineage.json`

These are runtime artifacts, not skill-packaged reference material.

## Common status concepts

Typical external status values include:

- `queued`
- `generating`
- `completed`
- `blocked`

Typical internal workflow phases may distinguish:

- prepare/login-check
- submit-ready
- submitted
- waiting-for-completion
- download-completed
- extend handoff / extend result recorded

Use persisted state to describe what is known. Do not collapse blocked, queued, generating, and completed into one vague success state.

## Login contract

Persist login state explicitly as one of:

- `logged_in`
- `not_logged_in`
- `uncertain`

If the action is account-gated and login is not confirmed, the workflow should stop with a blocker rather than guessing.

## Result URL contract

Capture and persist Grok result URLs as early as possible.

Preferred pattern:

- `/imagine/post/<id>`

Use post-id consistency checks when reopening, waiting, downloading, or recording derived results.

## Lineage contract

For derivative actions such as extend or redo, preserve lineage fields explicitly:

- `sourcePostId`
- `sourceResultUrl`
- `newPostId`
- `newResultUrl`
- `extendDuration`
- `timelineMode`

Source-side lineage should survive even when the workflow pauses before final derived capture.

## Artifact contract

Expected artifact areas:

- `uploads/` — staged local inputs for the job
- `downloads/` — raw browser-downloaded files or browser-history-recovered files for the job
- `exports/` — promoted final artifacts for delivery

Prefer final export names derived from the Grok post id, such as `grok-video-<post-id>.mp4`.

## Delivery rule

A workflow should normally be considered fully finished only when:

1. generation or derivative action completed
2. the result URL was recorded
3. the video was downloaded successfully
4. the final export was created
5. the artifact was delivered on the active channel when possible
6. the local file path was included in the user-facing delivery text

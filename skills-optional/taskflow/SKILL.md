---
name: taskflow
description: Use when work should span one or more detached tasks but still behave like one job with one owner session, one return context, and durable flow state.
metadata: { "crawclaw": { "emoji": "🪝", "workflow": { "portability": "non_portable", "notes": "Runtime orchestration primitive. Keep it inside CrawClaw; do not compile it into n8n steps." } } }
---

# TaskFlow

Use TaskFlow when a job needs to outlive one prompt or one detached run, but still needs one owner session and one place to inspect or resume the work.

## Use it for

- multi-step background work with one owner
- jobs that wait on detached ACP or subagent tasks
- durable flow state between steps
- child-task linkage with revision-checked mutations

## Do not use it for

- branching business logic
- routing policy
- domain-specific orchestration decisions

Keep those in the caller.

## Canonical entrypoints

- `api.runtime.tasks.flow`
- `api.runtime.tasks.flow.fromToolContext(ctx)`
- `api.runtime.tasks.flow.bindSession({ sessionKey, requesterOrigin })`

## Lifecycle

1. `createManaged(...)`
2. `runTask(...)`
3. `setWaiting(...)` when blocked on a person or external system
4. `resume(...)`
5. `finish(...)` or `fail(...)`
6. `requestCancel(...)` or `cancel(...)`

## Rules

- Use managed TaskFlows when your code owns orchestration.
- Treat `stateJson` as the persisted state bag.
- Every mutating method after creation is revision-checked; always carry forward the latest revision.
- Use `runTask(...)` instead of creating detached child tasks manually when you want parent orchestration.
- Store only the minimum state needed to resume.

# Workflows

`src/workflows/**` owns workflow runtime behavior.

It covers:

- workflow registry and compilation
- execution records and step transitions
- channel controls and interactive actions
- workflow action-feed projection
- workflow status and persistence

## Start Here

- `registry.ts`
- `executions.ts`
- `operations.ts`
- `channel-forwarder.ts`
- `interactive.ts`
- `types.ts`

## Boundary Rules

- Keep workflow execution state and transitions in this tree, not scattered across command or channel code.
- Channel-specific workflow rendering should stay behind projectors and controls, not inline in unrelated transports.
- If a workflow flow needs background agent work, use the special-agent substrate or a normal deterministic task, not a private ad hoc runner.
- Reuse shared execution visibility and action-feed semantics instead of inventing workflow-only event text.

## Review Notes

- Changes here usually affect action feed, inspect, channels, and command surfaces together.
- Add integration coverage for execution records and channel projection when touching workflow state transitions.

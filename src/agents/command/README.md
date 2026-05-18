# Agent Command

This subdomain owns the TypeScript command-style client entrypoints into the
Rust agent runtime.

It should contain:

- session resolution for agent runs
- run preparation and ingress validation
- command-facing session store updates
- runtime request preparation for the Gateway API

It should not contain:

- generic tool definitions
- subagent orchestration or runtime execution
- channel-specific transport logic

Start here:

- `prepare.ts`
- `session.ts`
- `attempt-execution.ts`
- `delivery.ts`

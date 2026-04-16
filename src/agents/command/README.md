# Agent Command

This subdomain owns the trusted command-style entrypoints into the agent kernel.

It should contain:

- session resolution for agent runs
- run preparation and ingress validation
- attempt execution and delivery
- command-facing session store updates

It should not contain:

- generic tool definitions
- subagent orchestration
- channel-specific transport logic

Start here:

- `prepare.ts`
- `session.ts`
- `attempt-execution.ts`
- `delivery.ts`

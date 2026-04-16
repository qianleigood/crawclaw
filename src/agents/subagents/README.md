# Subagents

This subdomain owns subagent spawn, control, registry, and announcement helpers.

It should contain:

- spawn contracts and spawn runtime helpers
- registry state and cleanup
- announcement delivery/output helpers
- subagent lifecycle glue

It should not contain:

- general session reset logic
- unrelated tool registration
- channel runtime policy unrelated to subagent lifecycle

Start here:

- `spawn-types.ts`
- `spawn-runtime.ts`
- `../subagent-spawn.ts`
- `../subagent-registry.ts`

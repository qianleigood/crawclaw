# Agents

The old TypeScript agent support surface has been removed.

Current ownership:

- Agent runtime, tools, memory, skills, subagents, and special-agent execution:
  `crates/crawclaw-runtime`
- Gateway RPC entrypoints and protocol exposure: `crates/crawclaw-gateway`
- Native plugin tool descriptors: `crates/crawclaw-native-plugins`

This directory is retained for non-executable metadata and migration notes only.

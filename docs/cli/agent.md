---
summary: "CLI reference for `crawclaw agent` (send one agent turn via the Gateway)"
read_when:
  - You want to run one agent turn from scripts (optionally deliver reply)
title: "agent"
---

# `crawclaw agent`

Run an agent turn via the Gateway (use `--local` for embedded).
Use `--agent <id>` to target a configured agent directly.

Related:

- Agent send tool: [Agent send](/tools/agent-send)

## Examples

```bash
crawclaw agent --to +15555550123 --message "status update" --deliver
crawclaw agent --agent ops --message "Summarize logs"
crawclaw agent --session-id 1234 --message "Summarize inbox" --thinking medium
crawclaw agent --agent ops --message "Generate report" --deliver --reply-channel slack --reply-to "#reports"
crawclaw agent inspect --run-id 778a918a-2a03-469f-9428-021272e341ee
crawclaw agent inspect --task-id 65b3fbc5-1827-4e99-b6f5-a9b964bcaa1d --json
crawclaw agent export-context --task-id 65b3fbc5-1827-4e99-b6f5-a9b964bcaa1d --json
```

## `agent inspect`

Inspect a task-backed agent run by `runId` or `taskId`.

This works for foreground runs, detached sub-agent runs, and ACP-backed child
runs as long as the runtime/task metadata has been persisted.

- Use `--run-id` when you already have a runtime identifier from logs or a transcript.
- Use `--task-id` when you want the task/task-backed runtime view.
- Use `--json` to emit the full inspection snapshot for scripts.

The inspection payload includes:

- runtime state
- task record
- runtime metadata + capability snapshot refs
- trajectory + completion summary
- guard context
- recent loop summary
- archive-backed query context diagnostics
- run timeline entries reconstructed from `run.lifecycle.*` archive events

When archive data is available, `agent inspect` now also surfaces:

- a compact lifecycle timeline for provider/tool/subagent/compaction/stop events
- decision codes and span metadata for each timeline entry
- the latest query-context snapshot, including section token usage and provider request shape

`agent inspect` is read-only. It does not resume, cancel, or mutate the run.

Examples:

```bash
crawclaw agent inspect --run-id 778a918a-2a03-469f-9428-021272e341ee
crawclaw agent inspect --task-id 65b3fbc5-1827-4e99-b6f5-a9b964bcaa1d --json
```

## `agent export-context`

Export Context Archive records for a task-backed run.

This is the replay/debug-facing export surface. It does not mutate the run.

- Use `--run-id` when you already have a runtime identifier.
- Use `--task-id` when you want the task-backed view.
- Use `--session-id` or `--agent-id` when you want a broader archive slice.
- Use `--out <path>` to write the export bundle to disk.
- Use `--json` to print the export payload for scripts.

Examples:

```bash
crawclaw agent export-context --run-id 778a918a-2a03-469f-9428-021272e341ee --json
crawclaw agent export-context --task-id 65b3fbc5-1827-4e99-b6f5-a9b964bcaa1d --out /tmp/context-archive.json
```

## Notes

- When this command triggers `models.json` regeneration, SecretRef-managed provider credentials are persisted as non-secret markers (for example env var names, `secretref-env:ENV_VAR_NAME`, or `secretref-managed`), not resolved secret plaintext.
- Marker writes are source-authoritative: CrawClaw persists markers from the active source config snapshot, not from resolved runtime secret values.

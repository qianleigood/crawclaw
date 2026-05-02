---
summary: "CLI reference for `crawclaw memory` (status/login/refresh/dream/session-summary/prompt-journal-summary)"
read_when:
  - You want to inspect experience memory availability
  - You need to log in, refresh, or debug experience access
  - You want a nightly summary of memory prompt journal data
title: "memory"
---

# `crawclaw memory`

Inspect and manage experience memory access, optional NotebookLM provider
integration, durable-memory maintenance, and session-summary maintenance.

Related:

- Memory concept: [Memory](/concepts/memory)
- Plugins: [Plugins](/tools/plugin)

## Examples

```bash
crawclaw memory status
crawclaw memory refresh
crawclaw memory login
crawclaw memory dream status --json
crawclaw memory dream history --json
crawclaw memory dream run --agent main --channel telegram --user alice --force
crawclaw memory dream run --agent main --channel telegram --user alice --dry-run --session-limit 6 --signal-limit 6
crawclaw memory session-summary status --agent main --session-id sess-1 --json
crawclaw memory session-summary refresh --agent main --session-id sess-1 --session-key agent:main:sess-1 --force
crawclaw memory status --json
crawclaw memory prompt-journal-summary --json --days 1
```

## Options

`memory status`:

- `--json`: print JSON output.
- `--verbose`: emit detailed logs during provider probes.

`memory refresh` and `memory login`:

- `--json`: print JSON output.
- `--verbose`: emit detailed logs during refresh/login.

`memory prompt-journal-summary`:

- `--json`: print machine-readable summary output.
- `--file <path>`: summarize one specific journal JSONL file.
- `--dir <path>`: read journal files from a specific directory.
- `--date <YYYY-MM-DD>`: summarize one specific daily bucket.
- `--days <n>`: summarize the most recent `n` daily journal files.
- `--verbose`: emit detailed logs while reading journal files.

`memory dream status`:

- `--json`: print machine-readable file watermark and lock state.
- `--agent <id>` / `--channel <id>` / `--user <id>`: resolve one durable scope.
- `--scope-key <key>`: inspect one explicit durable scope.
- `--verbose`: emit detailed logs.

`memory dream run`:

- `--json`: print machine-readable run result.
- `--agent <id>` / `--channel <id>` / `--user <id>`: resolve one durable scope.
- `--scope-key <key>`: run one explicit durable scope.
- `--force`: bypass the min-hours and min-sessions gates for the manual run.
- `--dry-run`: preview the dream window without taking the file lock or writing durable memory.
- `--session-limit <n>`: cap how many recent sessions feed the manual run or preview.
- `--signal-limit <n>`: cap how many structured signals feed the manual run or preview.
- `--verbose`: emit detailed logs.

`memory dream history`:

- `--json`: print machine-readable history availability.
- `--agent <id>` / `--channel <id>` / `--user <id>`: resolve one durable scope.
- `--scope-key <key>`: filter one explicit durable scope.
- `--verbose`: emit detailed logs.

`memory session-summary status`:

- `--json`: print machine-readable summary output.
- `--agent <id>`: agent id that owns the session summary file. Defaults to `main`.
- `--session-id <id>`: inspect one concrete session.
- `--verbose`: emit detailed logs.

`memory session-summary refresh`:

- `--json`: print machine-readable run output.
- `--agent <id>`: agent id that owns the session summary file. Defaults to `main`.
- `--session-id <id>`: refresh one concrete session.
- `--session-key <key>`: session key used to run the background summary agent.
- `--force`: bypass summary gate checks for the manual refresh.
- `--verbose`: emit detailed logs.

Notes:

- `memory status` reports the current NotebookLM provider state, including lifecycle, reason, and recommended action.
- `memory refresh` rebuilds the local NotebookLM profile from the configured cookie fallback.
- `memory login` runs the interactive NotebookLM login flow and validates the rebuilt profile.
- `memory sync` flushes local pending experience notes into NotebookLM and updates the managed `CrawClaw Memory Index` source when configured.
- `memory prompt-journal-summary` aggregates the nightly memory prompt journal into counts for prompt assembly, after-turn decisions, durable extraction, experience extraction, and experience writes.
- auto-dream is enabled by default, but it still respects minimum-session,
  minimum-hour, scan-throttle, and file-lock gates before starting a background
  dream pass.
- `memory dream status` reports the per-scope `.consolidate-lock` file
  watermark, lock path, and active/stale lock state.
- `memory dream status` explicitly reports whether the dream closed loop is
  active for the inspected scope. `closedLoopActive=false` with
  `closedLoopReason=disabled` means config disabled it; `scope_unresolved`
  means status could not resolve the durable scope being inspected.
- `memory dream run` triggers one manual durable-memory dream pass for a scope.
- `memory dream run --dry-run` previews the same gating/input collection path without spawning the dream agent.
- `memory dream history` no longer reads runtime DB run history; Dream uses the
  scope `.consolidate-lock` file `mtime` as its persistent watermark.
- `memory session-summary status` shows the current `summary.md` path, file state, and runtime summary boundary for one session.
- `memory session-summary status` also reports the inferred summary profile and
  the current `Open Loops` section when present.
- `memory session-summary refresh` forces one `session_summary` background update against a specific session.
- `memory session-summary refresh` uses the same light-to-full scheduler path as
  automatic session-summary maintenance.
- Durable `MEMORY.md` indexes are now validated as bounded recall indexes: no frontmatter, one short pointer per line, and roughly capped at 200 lines / 25KB.
- Durable recall observability now records whether a selected note won on
  `index`, `header`, `body_index`, and/or `body_rerank` signals; inspect those
  details with `crawclaw agent inspect`.
- NotebookLM-only experience recall happens during prompt assembly for live
  agent turns; `crawclaw memory` does not trigger recall.
- `crawclaw agent inspect` reports experience recall in NotebookLM provider
  order. It does not expose a local experience ranking score because CrawClaw no
  longer reranks NotebookLM results locally.
- The Experience Agent runs after eligible top-level turns and records `experience_extract` diagnostics when prompt journaling is enabled.
- `write_experience_note` is the only experience write path in the current runtime.
- Prompt journal is debug-only and intentionally lossy/truncated. Use Context
  Archive, `crawclaw agent inspect`, or `crawclaw agent export-context` when
  you need replay/export-grade records instead of prompt-tuning diagnostics.

## Prompt Journal

CrawClaw can record nightly memory prompt diagnostics into JSONL files under:

```text
~/.crawclaw/logs/memory-prompt-journal/YYYY-MM-DD.jsonl
```

Enable it with:

```bash
CRAWCLAW_MEMORY_PROMPT_JOURNAL=1
```

Optional hygiene:

```bash
CRAWCLAW_MEMORY_PROMPT_JOURNAL_RETENTION_DAYS=14
```

The journal is intended for prompt tuning and behavior audits. It captures:

- memory prompt assembly context
- after-turn durable extraction decisions
- durable extraction prompts and outcomes
- background experience extraction decisions and outcomes
- experience write outcomes, including local-index writes and optional NotebookLM sync

The summary command also surfaces durable-extraction save rate and top extraction reasons so prompt regressions are easier to spot.

If you need replay/export-grade run history instead of nightly diagnostics, use
Context Archive via:

```bash
crawclaw agent export-context --task-id <task-id> --json
```

It is not the canonical replay/export layer:

- prompt journal is optional and environment-gated
- payloads are truncated/sanitized
- Context Archive is the run-level truth layer for model-visible context, tool decisions, and post-turn state

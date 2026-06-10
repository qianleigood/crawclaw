---
summary: "Logging surfaces, file logs, WebSocket protocol logs, and console formatting"
read_when:
  - Changing logging output or formats
  - Debugging desktop, Gateway, or automation output
title: "Gateway Logging"
---

# Logging

For a user-facing overview (Desktop + Gateway clients + config), see [/logging](/logging).

CrawClaw has two log “surfaces”:

- **Console output** (what you see in the terminal / Debug UI).
- **File logs** (JSON lines) written by the gateway logger.

## File-based logger

- Default rolling log file is under `/tmp/crawclaw/` (one file per day): `crawclaw-YYYY-MM-DD.log`
  - Date uses the gateway host's local timezone.
- The log file path and level can be configured via `~/.crawclaw/crawclaw.json`:
  - `logging.file`
  - `logging.level`

The file format is one JSON object per line.

Gateway clients can tail this file via the gateway (`logs.tail`).
Desktop diagnostics use the same Gateway log stream.

**Verbose vs. log levels**

- **File logs** are controlled exclusively by `logging.level`.
- Per-run verbosity only affects **console verbosity**; it does **not**
  raise the file log level.
- To capture verbose-only details in file logs, set `logging.level` to `debug` or
  `trace`.

## Console capture

Gateway runtime captures `console.log/info/warn/error/debug/trace` and writes them to file logs,
while still printing to its process stdout/stderr.

You can tune console verbosity independently via:

- `logging.consoleLevel` (default `info`)
- `logging.consoleStyle` (`pretty` | `compact` | `json`)

## Tool summary redaction

Verbose tool summaries (e.g. `🛠️ Exec: ...`) can mask sensitive tokens before they hit the
console stream. This is **tools-only** and does not alter file logs.

- `logging.redactSensitive`: `off` | `tools` (default: `tools`)
- `logging.redactPatterns`: array of regex strings (overrides defaults)
  - Use raw regex strings (auto `gi`), or `/pattern/flags` if you need custom flags.
  - Matches are masked by keeping the first 6 + last 4 chars (length >= 18), otherwise `***`.
  - Defaults cover common key assignments, CLI flags, JSON fields, bearer headers, PEM blocks, and popular token prefixes.

## Gateway WebSocket logs

The gateway prints WebSocket protocol logs through the same console/file logging pipeline:

- Normal console level: only interesting RPC results are printed:
  - errors (`ok=false`)
  - slow calls (default threshold: `>= 50ms`)
  - parse errors
- Debug or trace console level: prints more protocol detail.

The Rust gateway binary currently exposes `--bind`, `--port`, and `--runtime-root` startup flags. Tune logging with config instead:

```json5
{
  logging: {
    level: "debug",
    consoleLevel: "debug",
    consoleStyle: "compact",
  },
}
```

Use `logs.tail` or Desktop diagnostics to inspect the file log stream.

## Console formatting (subsystem logging)

The console formatter is **TTY-aware** and prints consistent, prefixed lines.
Subsystem loggers keep output grouped and scannable.

Behavior:

- **Subsystem prefixes** on every line (e.g. `[gateway]`, `[canvas]`, `[tailscale]`)
- **Subsystem colors** (stable per subsystem) plus level coloring
- **Color when output is a TTY or the environment looks like a rich terminal** (`TERM`/`COLORTERM`/`TERM_PROGRAM`), respects `NO_COLOR`
- **Shortened subsystem prefixes**: drops leading `gateway/` + `channels/`, keeps last 2 segments (e.g. `weixin/outbound`)
- **Sub-loggers by subsystem** (auto prefix + structured field `{ subsystem }`)
- **`logRaw()`** for QR/UX output (no prefix, no formatting)
- **Console styles** (`pretty | compact | json`)
- **Console log level** separate from file log level (file keeps full detail when `logging.level` is set to `debug`/`trace`)
- **Weixin message bodies** are logged at `debug` (raise `logging.consoleLevel` or inspect file logs to see them)

This keeps existing file logs stable while making interactive output scannable.

---
summary: "CLI reference for `crawclaw runtimes` (install, inspect, and repair bundled plugin runtimes)"
read_when:
  - You want to verify install-time plugin runtimes
  - You need to repair bundled sidecar/runtime dependencies after install
title: "runtimes"
---

# `crawclaw runtimes`

Inspect and repair the shared bundled plugin runtimes that CrawClaw prepares during install/postinstall.

Related:

- Plugins: [Plugins](/cli/plugins)
- Doctor: [Doctor](/cli/doctor)
- Plugin system: [Plugins](/tools/plugin)

## Commands

```bash
crawclaw runtimes list
crawclaw runtimes doctor
crawclaw runtimes install
crawclaw runtimes repair
```

## What this manages

CrawClaw installs shared bundled plugin runtimes under `~/.crawclaw/runtimes`.

Current bundled shared runtimes include:

- `open-websearch` — installed under `~/.crawclaw/runtimes/open-websearch`
- `scrapling-fetch` — installed under `~/.crawclaw/runtimes/scrapling-fetch/venv`

The install process also writes a manifest at:

```bash
~/.crawclaw/runtimes/manifest.json
```

Startup now prefers these install-time runtimes and no longer relies on first-run bootstrap of those plugin dependencies.

## Examples

```bash
crawclaw runtimes list
crawclaw runtimes doctor
crawclaw runtimes install
crawclaw runtimes repair --json
```

## Notes

- `runtimes list` reads the shared runtime manifest and prints the current recorded state.
- `runtimes doctor` gives a human-readable health summary of the install-time runtimes.
- `runtimes install` re-runs the bundled runtime provisioner and refreshes the manifest.
- `runtimes repair` currently reuses the same installation + verification path as `install`.
- If a bundled plugin runtime is missing, CrawClaw startup now reports a clear error and points you to `crawclaw runtimes install` instead of trying to bootstrap those dependencies inside the plugin start path.

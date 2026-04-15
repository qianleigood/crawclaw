---
summary: "Migrate legacy CrawClaw local state into CrawClaw."
read_when:
  - You already used CrawClaw and are switching to CrawClaw
  - You still have `~/.crawclaw` state on disk
title: "CrawClaw to CrawClaw Migration"
---

# CrawClaw to CrawClaw Migration

Use this guide if you already have local CrawClaw state under `~/.crawclaw` and
want to move it into CrawClaw's default runtime paths.

## What changes

CrawClaw now prefers:

- state directory: `~/.crawclaw`
- config file: `~/.crawclaw/crawclaw.json`
- primary CLI: `crawclaw`

Legacy compatibility still exists in parts of the runtime, but the intended
steady state is:

- run `crawclaw ...`
- store state under `~/.crawclaw`
- use `crawclaw.json`

## Recommended path

Run the built-in migration command once:

```bash
crawclaw migrate-crawclaw
```

Dry-run first if you want to preview changes:

```bash
crawclaw migrate-crawclaw --dry-run
```

## What the migration does

The command moves legacy local runtime state into the new default location when
possible.

It covers:

- legacy state dir: `~/.crawclaw`
- legacy config file names:
  - `crawclaw.json`
  - `clawdbot.json`

After a successful migration, CrawClaw will use:

- `~/.crawclaw`
- `~/.crawclaw/crawclaw.json`

## Before you run it

1. Stop any running Gateway process or managed service.
2. Make sure you are not forcing custom runtime paths.
3. Run the migration once from a normal shell.

The migration command will refuse to run if any of these overrides are set:

- `CRAWCLAW_STATE_DIR`
- `CRAWCLAW_STATE_DIR`
- `CRAWCLAW_CONFIG_PATH`
- `CRAWCLAW_CONFIG_PATH`
- `CRAWCLAW_OAUTH_DIR`
- `CRAWCLAW_OAUTH_DIR`

That is intentional. Migration only works safely against the default runtime
paths.

## After migration

Verify the new install:

```bash
crawclaw doctor
crawclaw gateway status
```

If you used a global install before, also confirm the new CLI entry:

```bash
crawclaw --version
```

## What does not change automatically

This migration does not rewrite every historical string in your local config or
custom scripts. In particular:

- old shell aliases that call `crawclaw`
- custom service wrappers
- external automation that exports `CRAWCLAW_*`
- custom git checkout paths

Those should be updated manually after the state migration succeeds.

## Legacy compatibility

Today, some low-level compatibility env vars and update internals still accept
legacy `CRAWCLAW_*` names. That is expected during the rename transition.

For normal usage, prefer:

- `crawclaw`
- `~/.crawclaw`
- `CRAWCLAW_*` where supported

## If migration fails

Start with:

```bash
crawclaw migrate-crawclaw --dry-run
crawclaw doctor
```

Then inspect whether you still have custom path overrides in your shell or
service environment.

---
summary: "Debugging tools: runtime overrides, dev mode, and local log workflow"
read_when:
  - You want to run the Gateway in watch mode while iterating
  - You need a repeatable debugging workflow
title: "Debugging"
---

# Debugging

This page covers runtime overrides, dev-mode startup, and the local debugging
workflow for the Rust-owned Gateway path.

## Runtime debug overrides

Use `/debug` in chat to set **runtime-only** config overrides (memory, not disk).
`/debug` is disabled by default; enable with `commands.debug: true`.
This is handy when you need to toggle obscure settings without editing `crawclaw.json`.

Examples:

```
/debug show
/debug set messages.responsePrefix="[crawclaw]"
/debug unset messages.responsePrefix
/debug reset
```

`/debug reset` clears all overrides and returns to the on-disk config.

## Gateway watch mode

For fast iteration, use CrawClaw Desktop dev mode or the embedded Gateway API target:

```bash
CRAWCLAW_STATE_DIR="$HOME/.crawclaw-dev" cargo run -q -p crawclaw-gateway -- --bind loopback --port 19001
```

The old standalone Node watcher has been removed. Desktop development should go
through the app-owned Gateway path so it exercises the same runtime boundary as
the packaged desktop product.

## Dev state directory + local gateway

Use a separate state directory and port to isolate local gateway debugging from
your normal CrawClaw Desktop state.

Recommended flow:

```bash
CRAWCLAW_STATE_DIR="$HOME/.crawclaw-dev" \
  cargo run -q -p crawclaw-gateway -- --bind loopback --port 19001
```

Desktop users do not need a global `crawclaw` command. Use CrawClaw Desktop dev mode for local debugging.

What this does:

1. **State isolation**
   - `CRAWCLAW_STATE_DIR=~/.crawclaw-dev`
   - Runtime root defaults to `~/.crawclaw-dev/runtime/crawclaw`
   - Gateway port is explicit (`19001`) so it does not collide with the default `18789`

Reset flow (fresh start):

```bash
mv "$HOME/.crawclaw-dev" "$HOME/.crawclaw-dev.$(date +%Y%m%d%H%M%S).bak"
```

Tip: if a non‑dev gateway is already running (launchd/systemd), stop it first:

Use CrawClaw Desktop to stop the app-owned gateway, or stop the process that is
listening on the port you are about to use.

## Safety notes

- Gateway and provider logs can include prompts, tool output, or user data.
- Keep logs local and delete temporary logs after debugging.
- If you share logs, scrub secrets and PII first.

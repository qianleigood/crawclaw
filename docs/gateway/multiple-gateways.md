---
summary: "Run multiple CrawClaw Gateways on one host (isolation, ports, and profiles)"
read_when:
  - Running more than one Gateway on the same machine
  - You need isolated config/state/ports per Gateway
title: "Multiple Gateways"
---

# Multiple Gateways (same host)

Most setups should use one Gateway because a single Gateway can handle multiple messaging connections and agents. If you need stronger isolation or redundancy (e.g., a rescue bot), run separate Gateways with isolated profiles/ports.

## Isolation checklist (required)

- `CRAWCLAW_CONFIG_PATH` — per-instance config file
- `CRAWCLAW_STATE_DIR` — per-instance sessions, creds, caches
- `agents.defaults.workspace` — per-instance workspace root
- `gateway.port` (or `--port`) — unique per instance
- Derived ports (browser/canvas) must not overlap

If these are shared, you will hit config races and port conflicts.

## Recommended: profiles (`--profile`)

Profiles auto-scope `CRAWCLAW_STATE_DIR` + `CRAWCLAW_CONFIG_PATH` and suffix service names.

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

Per-profile services:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

## Rescue-bot guide

Run a second Gateway on the same host with its own:

- profile/config
- state dir
- workspace
- base port (plus derived ports)

This keeps the rescue bot isolated from the main bot so it can debug or apply config changes if the primary bot is down.

Port spacing: leave at least 20 ports between base ports so the derived browser/canvas/CDP ports never collide.

### How to install (rescue bot)

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

## Port mapping (derived)

Base port = `gateway.port` (or `CRAWCLAW_GATEWAY_PORT` / `--port`).

- browser control service port = base + 2 (loopback only)
- Browser profile CDP ports auto-allocate from `browser.controlPort + 9 .. + 108`

If you override any of these in config or env, you must keep them unique per instance.

## Browser/CDP notes (common footgun)

- Do **not** pin `browser.cdpUrl` to the same values on multiple instances.
- Each instance needs its own browser control port and CDP range (derived from its gateway port).
- If you need explicit CDP ports, set `browser.profiles.<name>.cdpPort` per instance.
- Remote Chrome: use `browser.profiles.<name>.cdpUrl` (per profile, per instance).

## Manual env example

```bash
CRAWCLAW_CONFIG_PATH=~/.crawclaw/main.json \
CRAWCLAW_STATE_DIR=~/.crawclaw-main \
cargo run -q -p crawclaw-gateway -- --bind loopback --port 18789

CRAWCLAW_CONFIG_PATH=~/.crawclaw/rescue.json \
CRAWCLAW_STATE_DIR=~/.crawclaw-rescue \
cargo run -q -p crawclaw-gateway -- --bind loopback --port 18790
```

## Quick checks

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

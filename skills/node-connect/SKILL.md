---
name: node-connect
description: Diagnose CrawClaw node connection and pairing failures for Android, iOS, and macOS companion apps. Use when QR, setup code, or manual connect fails, especially around LAN, tailnet, public URL, pairing, or bootstrap token errors.
---

# Node Connect

Find the one real route from node to gateway, verify CrawClaw is advertising that route, then fix pairing or auth.

## Topology first

Decide which case applies before proposing fixes:

- same machine or emulator
- same LAN
- same Tailscale tailnet
- public URL or reverse proxy

Do not mix routes.

## Canonical checks

```bash
crawclaw config get gateway.mode
crawclaw config get gateway.bind
crawclaw config get gateway.tailscale.mode
crawclaw config get gateway.remote.url
crawclaw config get gateway.auth.mode
crawclaw config get gateway.auth.allowTailscale
crawclaw config get plugins.entries.device-pair.config.publicUrl
crawclaw qr --json
crawclaw devices list
crawclaw nodes status
```

If remote mode is involved:

```bash
crawclaw qr --remote --json
```

If Tailscale is involved:

```bash
tailscale status --json
```

## Read the result, not guesses

`crawclaw qr --json` tells you:

- `gatewayUrl`: the endpoint the app should use
- `urlSource`: which config path produced that URL

## Root-cause map

- `Gateway is only bound to loopback`: remote nodes cannot connect yet.
- `gateway.bind=tailnet set, but no tailnet IP was found`: the gateway host is not actually on Tailscale.
- `qr --remote requires gateway.remote.url`: remote-mode config is incomplete.
- `pairing required`: network route worked; approve the pending device.
- `bootstrap token invalid or expired`: generate a fresh setup code and retry.
- `unauthorized`: wrong token/password or wrong Tailscale auth expectation.

## Fix style

Reply with one concrete diagnosis and one route. If the setup is still unclear, ask for the intended route and the exact app error text instead of guessing.

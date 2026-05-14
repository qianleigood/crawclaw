---
summary: "Linux support status"
read_when:
  - Planning platform coverage or contributions
title: "Linux App"
---

# Linux App

The Gateway is fully supported on Linux. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (WhatsApp/Telegram bugs).

Linux support is focused on CLI, Gateway, and plugins.

## Beginner quick path (VPS)

1. Install Node 24.x (stable) or Node 25.x (experimental)
2. `install CrawClaw Desktop from GitHub Releases`
3. CrawClaw Desktop or the local Gateway API
4. From your laptop: `ssh -N -L 18789:127.0.0.1:18789 <user>@<host>`
5. Run CrawClaw Desktop or the local Gateway API locally, or connect a supported Gateway client through the SSH tunnel

Full Linux server guide: [Linux Server](/vps). Step-by-step VPS example: [exe.dev](/install/exe-dev)

## Install

- [Getting Started](/start/getting-started)
- [Install & updates](/install/updating)
- Optional flows: [Bun (experimental)](/install/bun), [Nix](/install/nix)

## Gateway

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway service install (CLI)

Use one of these:

```
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Or:

```
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Or:

```
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Select **Gateway service** when prompted.

Repair/migrate:

```
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## System control (systemd user unit)

CrawClaw installs a systemd **user** service by default. Use a **system**
service for shared or always-on servers. The full unit example and guidance
live in the [Gateway runbook](/gateway).

Minimal setup:

Create `~/.config/systemd/user/crawclaw-gateway[-<profile>].service`:

```
[Unit]
Description=CrawClaw Gateway (profile: <profile>, v<version>)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/CrawClaw Desktop or the local Gateway API
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable it:

```
systemctl --user enable --now crawclaw-gateway[-<profile>].service
```

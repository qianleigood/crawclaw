---
summary: "Linux support status"
read_when:
  - Planning platform coverage or contributions
title: "Linux App"
---

# Linux App

The Gateway is fully supported on Linux. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (WhatsApp/Telegram bugs).

Linux support is focused on CLI, Gateway, plugins, and node host operation.

## Beginner quick path (VPS)

1. Install Node 24 (recommended; Node 22 LTS, currently `22.14+`, still works for compatibility)
2. `npm i -g crawclaw@latest`
3. `crawclaw onboard --install-daemon`
4. From your laptop: `ssh -N -L 18789:127.0.0.1:18789 <user>@<host>`
5. Run `crawclaw tui` locally, or connect a supported Gateway client through the SSH tunnel

Full Linux server guide: [Linux Server](/vps). Step-by-step VPS example: [exe.dev](/install/exe-dev)

## Install

- [Getting Started](/start/getting-started)
- [Install & updates](/install/updating)
- Optional flows: [Bun (experimental)](/install/bun), [Nix](/install/nix), [Docker](/install/docker)

## Gateway

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway service install (CLI)

Use one of these:

```
crawclaw onboard --install-daemon
```

Or:

```
crawclaw gateway install
```

Or:

```
crawclaw configure
```

Select **Gateway service** when prompted.

Repair/migrate:

```
crawclaw doctor
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
ExecStart=/usr/local/bin/crawclaw gateway --port 18789
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable it:

```
systemctl --user enable --now crawclaw-gateway[-<profile>].service
```

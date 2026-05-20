---
summary: "Linux support status"
read_when:
  - Planning platform coverage or contributions
title: "Linux App"
---

# Linux App

The local Rust Gateway is supported on Linux. TypeScript and JavaScript remain
only for the desktop renderer, not for the default product runtime path.

Linux support is focused on the local Gateway, native plugins, and Gateway API
clients.

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

## Gateway runtime

Use CrawClaw Desktop or the local Gateway API as the supported runtime owner.
The old CLI-managed Linux supervisor flow has been retired from the default
desktop product path.

---
summary: "Platform support overview for Gateway hosts and supported runtimes"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
title: "Platforms"
---

# Platforms

CrawClaw core is written in TypeScript. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (WhatsApp/Telegram bugs).

CrawClaw focuses on the Gateway, CLI, web surfaces, and node integrations. Windows and
Linux are supported Gateway host targets today, with WSL2 recommended on Windows.

## Choose your OS

- Windows: [Windows](/platforms/windows)
- Linux: [Linux](/platforms/linux)

## VPS & hosting

- VPS hub: [VPS hosting](/vps)
- Fly.io: [Fly.io](/install/fly)
- Hetzner (Docker): [Hetzner](/install/hetzner)
- GCP (Compute Engine): [GCP](/install/gcp)
- Azure (Linux VM): [Azure](/install/azure)
- exe.dev (VM + HTTPS proxy): [exe.dev](/install/exe-dev)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `crawclaw gateway status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `crawclaw onboard --install-daemon`
- Direct: `crawclaw gateway install`
- Configure flow: `crawclaw configure` → select **Gateway service**
- Repair/migrate: `crawclaw doctor` (offers to install or fix the service)

The service target depends on OS:

- macOS: LaunchAgent (`ai.crawclaw.gateway` or `ai.crawclaw.<profile>`; legacy `com.crawclaw.*`)
- Linux/WSL2: systemd user service (`crawclaw-gateway[-<profile>].service`)

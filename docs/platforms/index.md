---
summary: "Platform support overview for Gateway hosts and supported runtimes"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
title: "Platforms"
---

# Platforms

CrawClaw core is written in TypeScript. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (Weixin/Feishu bugs).

CrawClaw focuses on the Gateway, CLI, plugins, and node integrations.
Linux, macOS, and Windows are supported Gateway host targets today.

## Choose your OS

- Linux: [Linux](/platforms/linux)
- macOS: [macOS](/platforms/macos)
- Windows: [Windows](/platforms/windows)

## VPS & hosting

- VPS hub: [VPS hosting](/vps)

- Azure (Linux VM): [Azure](/install/azure)
- exe.dev (VM + HTTPS proxy): [exe.dev](/install/exe-dev)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Runtime status: CrawClaw Desktop or the local Gateway API

## Gateway runtime

Use CrawClaw Desktop or the local Gateway API as the default runtime owner. The
old CLI-managed OS startup path is no longer part of the desktop product path.

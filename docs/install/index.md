---
summary: "Install CrawClaw Desktop and understand the local Gateway runtime"
read_when:
  - You want the supported local desktop entrypoint for CrawClaw
  - You need to know what is bundled with the desktop app
  - You are setting up a contributor checkout

title: "Install"
---

# Install

## Recommended: CrawClaw Desktop

Install CrawClaw Desktop from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases). On Apple platforms, CrawClaw is a desktop-first product: the app owns user setup, status, logs, runtime management, Agent chat, plugin configuration, model settings, and diagnostics.

See [Desktop](/install/desktop) for the bundle layout, runtime model, and platform support.

## Automation boundary

Desktop starts and supervises the local Rust Gateway. Automation and advanced integrations should call the local Gateway API instead of shelling out to retired local command wrappers. Public terminal installers and tutorials are retired.

## Contributor setup

For local development from source:

```bash
git clone https://github.com/qianleigood/crawclaw.git
cd crawclaw
pnpm install
pnpm build
```

To run the desktop app in development, use the desktop Tauri scripts from the repository checkout:

```bash
pnpm desktop:tauri:stage-runtime
pnpm desktop:tauri:dev
```

## Runtime prerequisites

- **Desktop users:** use the packaged app; the desktop bundle includes the CrawClaw Gateway/runtime/native-plugin binaries.
- **Contributors:** use Node 24.x or 25.x for repository tooling and Rust for the Gateway/runtime crates.
- **Automation clients:** target the local Gateway API exposed by the desktop-managed Gateway.

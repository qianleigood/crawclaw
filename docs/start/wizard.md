---
summary: "Desktop onboarding: setup for Gateway, workspace, channels, models, and skills"
read_when:
  - Running or configuring desktop onboarding
  - Setting up a new machine
title: "Desktop Onboarding"
sidebarTitle: "Desktop Onboarding"
---

# Desktop Onboarding

CrawClaw Desktop is the supported Apple-platform setup surface. Use the app to
configure auth, local Gateway state, workspace defaults, channels, plugins,
skills, logs, and diagnostics.

The public `crawclaw` command is retired. Automation should call the local
Gateway API directly.

## QuickStart vs Advanced

Onboarding starts with **QuickStart** for safe local defaults and **Advanced**
for explicit control.

<Tabs>
  <Tab title="QuickStart">
    - Local Gateway on loopback
    - Desktop-managed random port
    - Desktop-managed token auth
    - Workspace under `~/.crawclaw`
    - Bundled Rust runtime and native plugins
  </Tab>
  <Tab title="Advanced">
    - Explicit workspace, model, channel, plugin, and memory settings
    - Gateway API automation for repeatable setup
    - Direct config review before applying sensitive changes
  </Tab>
</Tabs>

## What onboarding configures

1. **Model/Auth** — choose a supported provider/auth flow and default model.
2. **Workspace** — choose where agent files and bootstrap state live.
3. **Gateway** — start and monitor the embedded Rust Gateway.
4. **Channels** — connect supported messaging surfaces.
5. **Output and presentation** — set reply visibility and streaming defaults.
6. **Memory / Experience** — enable local capture, recall, and maintenance flows.
7. **Skills and plugins** — enable bundled skills and desktop-supported plugins.
8. **Health check** — verify the local Gateway and runtime are ready.

## Reconfigure later

Use CrawClaw Desktop settings for normal changes. Use the Gateway API for
automation, config patching, status, health, sessions, and plugin operations.

## Related docs

- [Onboarding overview](/start/onboarding-overview)
- [Desktop install](/install/desktop)
- [Gateway protocol](/gateway/protocol)
- [Gateway troubleshooting](/gateway/troubleshooting)

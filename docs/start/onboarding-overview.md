---
summary: "Overview of CrawClaw Desktop onboarding and Gateway API setup"
read_when:
  - Choosing the supported setup path
  - Setting up a new environment
title: "Onboarding Overview"
sidebarTitle: "Onboarding Overview"
---

# Onboarding Overview

CrawClaw onboarding now starts in **CrawClaw Desktop** on Apple platforms. The
desktop app owns model auth, workspace defaults, Gateway lifecycle, plugins,
channels, diagnostics, and local runtime state.

Automation and headless integrations should use the local Gateway API instead
of a public `crawclaw` command.

## Which path should I use?

| Path             | Best for                                          |
| ---------------- | ------------------------------------------------- |
| CrawClaw Desktop | Normal setup, settings, model auth, plugins, logs |
| Gateway API      | Local automation and integration control planes   |
| Config files     | Reviewable advanced changes under `~/.crawclaw`   |

## What onboarding configures

Desktop setup configures:

1. **Model provider and auth** — API key, OAuth, or setup token for your chosen provider.
2. **Workspace** — directory for agent files, bootstrap templates, and memory.
3. **Gateway** — loopback bind, auth mode, local runtime state, and health.
4. **Channels** — supported message channels exposed by the desktop Gateway.
5. **Plugins and tools** — bundled Rust-native plugins plus managed native tool runtimes.
6. **Memory and experience** — local capture, recall, and maintenance settings.

## Automation

Use the Gateway API for scripted setup, config patching, status, health,
session, and plugin operations. Desktop and automation share the same local
Gateway control plane so behavior stays consistent.

Related docs:

- [Desktop install](/install/desktop)
- [Gateway protocol](/gateway/protocol)
- [Gateway troubleshooting](/gateway/troubleshooting)

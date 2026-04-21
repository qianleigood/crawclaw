---
summary: "Overview of CrawClaw onboarding options and flows"
read_when:
  - Choosing an onboarding path
  - Setting up a new environment
title: "Onboarding Overview"
sidebarTitle: "Onboarding Overview"
---

# Onboarding Overview

CrawClaw uses CLI onboarding to configure auth, the Gateway, and optional
channels across supported hosts.

## Which path should I use?

|                | CLI onboarding                  |
| -------------- | ------------------------------- |
| **Platforms**  | macOS, Linux, Windows (WSL2)    |
| **Interface**  | Terminal wizard                 |
| **Best for**   | Servers, headless, full control |
| **Automation** | `--non-interactive` for scripts |
| **Command**    | `crawclaw onboard`              |

Most users should start with **CLI onboarding**. It works everywhere and gives
you the most control.

## What onboarding configures

Regardless of which path you choose, onboarding sets up:

1. **Model provider and auth** — API key, OAuth, or setup token for your chosen provider
2. **Workspace** — directory for agent files, bootstrap templates, and memory
3. **Gateway** — port, bind address, auth mode
4. **Channels** (optional) — WhatsApp, Telegram, Discord, and more
5. **Output and presentation** — default reply visibility and streaming preset
6. **Memory / Experience** (optional) — NotebookLM-backed experience recall enablement
7. **Daemon** (optional) — background service so the Gateway starts automatically

## CLI onboarding

Run in any terminal:

```bash
crawclaw onboard
```

Add `--install-daemon` to also install the background service in one step.

Full reference: [Onboarding (CLI)](/start/wizard)
CLI command docs: [`crawclaw onboard`](/cli/onboard)

## Custom or unlisted providers

If your provider is not listed in onboarding, choose **Custom Provider** and
enter:

- API compatibility mode (OpenAI-compatible, Anthropic-compatible, or auto-detect)
- Base URL and API key
- Model ID and optional alias

Multiple custom endpoints can coexist — each gets its own endpoint ID.

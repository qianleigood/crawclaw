---
summary: "Install CrawClaw Desktop and start your local Gateway."
read_when:
  - First time setup from zero
  - You want the fastest path to a working desktop chat
title: "Getting Started"
---

# Getting Started

Install CrawClaw Desktop and finish setup in the desktop UI. By the end you will
have a local Rust Gateway, configured model auth, and a working desktop chat
session.

## What you need

- **macOS** for the supported Apple-platform desktop app
- **A model provider account or API key** from Anthropic, OpenAI, Google, or another supported provider

## Quick setup

<Steps>
  <Step title="Install CrawClaw Desktop">
    Download the latest desktop asset from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases).
  </Step>
  <Step title="Open the desktop app">
    CrawClaw Desktop prepares `~/.crawclaw`, stages the embedded Rust runtime,
    starts the local Gateway, and opens the setup UI.
  </Step>
  <Step title="Configure models and plugins">
    Use desktop Settings for model providers, plugin enablement, local runtime
    status, logs, and diagnostics.
  </Step>
  <Step title="Send your first message">
    Use the Agent page in CrawClaw Desktop. Automation clients can connect
    through the local Gateway API.
  </Step>
</Steps>

## What to do next

<Columns>
  <Card title="Desktop install" href="/install/desktop" icon="monitor">
    What the app bundles, starts, and stores locally.
  </Card>
  <Card title="Connect a channel" href="/channels" icon="message-square">
    Weixin, Feishu, QQ Bot, DingTalk, and ESP32.
  </Card>
  <Card title="Pairing and safety" href="/channels/pairing" icon="shield">
    Control who can message your agent.
  </Card>
  <Card title="Gateway API" href="/gateway/protocol" icon="waypoints">
    Local control-plane protocol for automation and integrations.
  </Card>
</Columns>

<Accordion title="Advanced: environment variables">
  If you run CrawClaw as a service account or want custom paths:

- `CRAWCLAW_HOME` — home directory for internal path resolution
- `CRAWCLAW_STATE_DIR` — override the state directory
- `CRAWCLAW_CONFIG_PATH` — override the config file path

Full reference: [Environment variables](/help/environment).
</Accordion>

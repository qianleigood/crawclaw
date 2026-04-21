---
summary: "Get CrawClaw installed and run your first chat in minutes."
read_when:
  - First time setup from zero
  - You want the fastest path to a working chat
title: "Getting Started"
---

# Getting Started

Install CrawClaw, run onboarding, and chat with your AI assistant — all in
about 5 minutes. By the end you will have a running Gateway, configured auth,
and a working chat session.

## What you need

- **Node.js** — Node 24 recommended (Node 22.14+ also supported)
- **An API key** from a model provider (Anthropic, OpenAI, Google, etc.) — onboarding will prompt you

<Tip>
Check your Node version with `node --version`.
**Windows users:** both native Windows and WSL2 are supported. WSL2 is more
stable and recommended for the full experience. See [Windows](/platforms/windows).
Need to install Node? See [Node setup](/install/node).
</Tip>

## Quick setup

<Steps>
  <Step title="Install CrawClaw">
    <Tabs>
      <Tab title="macOS / Linux">
        ```bash
        curl -fsSL https://crawclaw.ai/install.sh | bash
        ```
        <img
  src="/assets/install-script.svg"
  alt="Install Script Process"
  className="rounded-lg"
/>
      </Tab>
      <Tab title="Windows (PowerShell)">
        ```powershell
        iwr -useb https://crawclaw.ai/install.ps1 | iex
        ```
      </Tab>
    </Tabs>

    <Note>
    Other install methods (Docker, Nix, npm): [Install](/install).
    </Note>

  </Step>
  <Step title="Run onboarding">
    ```bash
    crawclaw onboard --install-daemon
    ```

    The wizard walks you through choosing a model provider, setting an API key,
    and configuring the Gateway. It takes about 2 minutes.

    See [Onboarding (CLI)](/start/wizard) for the full reference.

  </Step>
  <Step title="Verify the Gateway is running">
    ```bash
    crawclaw gateway status
    ```

    You should see the Gateway listening on port 18789.

  </Step>
  <Step title="Send your first message">
    Use a connected channel or run the terminal interface:

    ```bash
    crawclaw tui
    ```

    Want to chat from your phone instead? The fastest channel to set up is
    [Telegram](/channels/telegram) (just a bot token). See [Channels](/channels)
    for all options.

  </Step>
</Steps>

## What to do next

<Columns>
  <Card title="Connect a channel" href="/channels" icon="message-square">
    WhatsApp, Telegram, Discord, iMessage, and more.
  </Card>
  <Card title="Pairing and safety" href="/channels/pairing" icon="shield">
    Control who can message your agent.
  </Card>
  <Card title="Configure the Gateway" href="/gateway/configuration" icon="settings">
    Models, tools, sandbox, and advanced settings.
  </Card>
  <Card title="Browse tools" href="/tools" icon="wrench">
    Browser, exec, web search, skills, and plugins.
  </Card>
</Columns>

<Accordion title="Advanced: environment variables">
  If you run CrawClaw as a service account or want custom paths:

- `CRAWCLAW_HOME` — home directory for internal path resolution
- `CRAWCLAW_STATE_DIR` — override the state directory
- `CRAWCLAW_CONFIG_PATH` — override the config file path

Legacy `CRAWCLAW_*` aliases are still accepted while older installs migrate.

Full reference: [Environment variables](/help/environment).
</Accordion>

<Note>
If you already have legacy CrawClaw state under `~/.crawclaw`, migrate it once with
`crawclaw migrate-crawclaw`. See [CrawClaw to CrawClaw migration](/reference/crawclaw-migration).
</Note>

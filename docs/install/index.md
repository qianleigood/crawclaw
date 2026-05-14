---
summary: "Install CrawClaw — desktop app, installer script, npm/pnpm, from source, and more"
read_when:
  - You need an install method other than the Getting Started quickstart
  - You want to deploy to a cloud platform
  - You need to update, migrate, or uninstall
title: "Install"
---

# Install

## Recommended: CrawClaw Desktop

For a local desktop client, install CrawClaw Desktop from [GitHub Releases](https://github.com/qianleigood/crawclaw/releases). It bundles the CrawClaw runtime, initializes local Gateway configuration under `~/.crawclaw`, and manages the local Gateway service without requiring a global command install.

See [Desktop](/install/desktop).

## CLI and server install: installer script

Use this path for terminal, server, headless, or advanced deployments. The installer detects your OS, installs Node if needed, installs CrawClaw, and launches onboarding.

<Tabs>
  <Tab title="macOS / Linux">
    ```bash
    curl -fsSL https://crawclaw.ai/install.sh | bash
    ```
  </Tab>
  <Tab title="Windows (PowerShell)">
    ```powershell
    iwr -useb https://crawclaw.ai/install.ps1 | iex
    ```
  </Tab>
</Tabs>

To install without running onboarding:

<Tabs>
  <Tab title="macOS / Linux">
    ```bash
    curl -fsSL https://crawclaw.ai/install.sh | bash -s -- --no-onboard
    ```
  </Tab>
  <Tab title="Windows (PowerShell)">
    ```powershell
    & ([scriptblock]::Create((iwr -useb https://crawclaw.ai/install.ps1))) -NoOnboard
    ```
  </Tab>
</Tabs>

For all flags and CI/automation options, see [Installer internals](/install/installer).

## System requirements

- **Node 24.x** (stable) or **Node 25.x** (experimental) — the installer script handles this automatically
- **macOS, Linux, or Windows** — Windows uses the native PowerShell installer. See [Windows](/platforms/windows).
- `pnpm` is only needed if you build from source

## Alternative install methods

### npm or pnpm

If you already manage Node yourself:

<Tabs>
  <Tab title="npm">
    ```bash
# Install CrawClaw Desktop from GitHub Releases.
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```
  </Tab>
  <Tab title="pnpm">
    ```bash
# Install CrawClaw Desktop from GitHub Releases.
    pnpm approve-builds -g
    # Use CrawClaw Desktop or the local Gateway API for this operation.
    ```

    <Note>
    pnpm requires explicit approval for packages with build scripts. Run `pnpm approve-builds -g` after the first install.
    </Note>

  </Tab>
</Tabs>

<Accordion title="Troubleshooting: sharp build errors (npm)">
  If `sharp` fails due to a globally installed libvips:

```bash
# Install CrawClaw Desktop from GitHub Releases.
```

</Accordion>

### From source

For contributors or anyone who wants to run from a local checkout:

```bash
git clone https://github.com/qianleigood/crawclaw.git
cd crawclaw
pnpm install && pnpm build
pnpm link --global
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

Or skip the link and use CrawClaw Desktop dev mode from inside the repo. See [Setup](/start/setup) for full development workflows.

### Install from GitHub main

```bash
npm install -g github:crawclaw/crawclaw#main
```

### Package managers and alternate runtimes

<CardGroup cols={2}>
  <Card title="Nix" href="/install/nix" icon="snowflake">
    Declarative install via Nix flake.
  </Card>
  <Card title="Ansible" href="/install/ansible" icon="server">
    Automated fleet provisioning.
  </Card>
  <Card title="Bun" href="/install/bun" icon="zap">
    Gateway API usage via the Bun runtime.
  </Card>
</CardGroup>

## Verify the install

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

## Hosting and deployment

Deploy CrawClaw on a cloud server or VPS:

<CardGroup cols={3}>
  <Card title="VPS" href="/vps">Any Linux VPS</Card>
  <Card title="Azure" href="/install/azure">Azure</Card>
  <Card title="Railway" href="/install/railway">Railway</Card>
  <Card title="Northflank" href="/install/northflank">Northflank</Card>
</CardGroup>

## Update, migrate, or uninstall

<CardGroup cols={3}>
  <Card title="Updating" href="/install/updating" icon="refresh-cw">
    Keep CrawClaw up to date.
  </Card>
  <Card title="Migrating" href="/install/migrating" icon="arrow-right">
    Move to a new machine.
  </Card>
  <Card title="Uninstall" href="/install/uninstall" icon="trash-2">
    Remove CrawClaw completely.
  </Card>
</CardGroup>

## Troubleshooting: `crawclaw` not found

If the install succeeded but `crawclaw` is not found in your terminal:

```bash
node -v           # Node installed?
npm prefix -g     # Where are global packages?
echo "$PATH"      # Is the global bin dir in PATH?
```

If `$(npm prefix -g)/bin` is not in your `$PATH`, add it to your shell startup file (`~/.zshrc` or `~/.bashrc`):

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
```

Then open a new terminal. See [Node setup](/install/node) for more details.

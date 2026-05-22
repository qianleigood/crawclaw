---
title: "Node.js"
summary: "Node.js requirements for CrawClaw repository development"
read_when:
  - "You are working from a CrawClaw source checkout"
  - "You need to run repository tests or build scripts"
---

# Node.js

Desktop users do not need a global `crawclaw` command or a manually configured
Node install. CrawClaw Desktop bundles the Rust runtime and managed native
runtime resources it needs.

Repository development still uses **Node 24.x or 25.x** for the desktop
renderer, hosted docs tooling, and npm pack/publish boundaries. Those calls are
centralized behind `crawclaw-repo-tools` Node/npm adapters so the Rust runtime
and repo-tools profiles remain the architectural control plane.

## Check your version

```bash
node -v
```

Use Node 24.x or 25.x before running repository commands that install
dependencies, build the desktop renderer, run hosted docs checks, or validate
npm package contents.

## Install Node for development

<Tabs>
  <Tab title="macOS">
    ```bash
    brew install node
    ```
  </Tab>
  <Tab title="Linux">
    ```bash
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ```
  </Tab>
  <Tab title="Windows">
    ```powershell
    winget install OpenJS.NodeJS.LTS
    ```
  </Tab>
</Tabs>

## Package manager

Use pnpm from the repository root:

```bash
corepack enable
pnpm install
```

The common pnpm commands are compatibility aliases:

```bash
pnpm check         # repo-tools check --profile local
pnpm build         # repo-tools build --profile package
pnpm release:check # repo-tools release-check
```

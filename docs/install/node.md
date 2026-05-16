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

Repository development still uses **Node 24.x or newer** for TypeScript tooling,
tests, docs checks, and packaging scripts. Node 24 is the stable baseline.

## Check your version

```bash
node -v
```

Use Node 24+ before running repository commands such as `pnpm install`, `pnpm build`, or desktop staging scripts.

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

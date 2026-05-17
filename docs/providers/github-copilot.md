---
summary: "Use GitHub Copilot in CrawClaw with an existing GitHub token"
read_when:
  - You want to use GitHub Copilot as a model provider
  - You already have a GitHub token available in the environment
title: "GitHub Copilot"
---

# GitHub Copilot

## What is GitHub Copilot?

GitHub Copilot is GitHub's AI coding assistant. It provides access to Copilot
models for your GitHub account and plan. CrawClaw can use Copilot as a model
provider in two different ways.

## Two ways to use Copilot in CrawClaw

### 1) Built-in GitHub Copilot provider (`github-copilot`)

Provide a GitHub token through `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or
`GITHUB_TOKEN`. CrawClaw exchanges that token for Copilot API tokens when it
runs. CrawClaw no longer ships a bundled JavaScript device-login helper.

### 2) Copilot Proxy plugin (`copilot-proxy`)

Use the **Copilot Proxy** VS Code extension as a local bridge. CrawClaw talks to
the proxy’s `/v1` endpoint and uses the model list you configure there. Choose
this when you already run Copilot Proxy in VS Code or need to route through it.
You must enable the plugin and keep the VS Code extension running.

Use GitHub Copilot as a model provider (`github-copilot`) by setting one of the
supported token environment variables before starting the desktop app or gateway.

## Set a default model

```bash
# Use CrawClaw Desktop or the local Gateway API for this operation.
```

### Config snippet

```json5
{
  agents: { defaults: { model: { primary: "github-copilot/gpt-4o" } } },
}
```

## Notes

- Copilot model availability depends on your plan; if a model is rejected, try
  another ID (for example `github-copilot/gpt-4.1`).
- CrawClaw exchanges the configured GitHub token for a Copilot API token when it runs.

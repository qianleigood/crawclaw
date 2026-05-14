---
summary: "Model selection, defaults, aliases, fallbacks, and provider status"
read_when:
  - Changing model fallback behavior or selection UX
  - Updating model provider setup or scan probes
title: "Models"
---

# Models

Use CrawClaw Desktop to add providers, authenticate accounts, choose defaults,
and inspect available models. Use the Gateway API for automation.

See [/concepts/model-failover](/concepts/model-failover) for auth profile
rotation, cooldowns, and fallback behavior.
Quick provider overview + examples: [/concepts/model-providers](/concepts/model-providers).

## How model selection works

CrawClaw selects models in this order:

1. **Primary** model (`agents.defaults.model.primary` or `agents.defaults.model`).
2. **Fallbacks** in `agents.defaults.model.fallbacks` (in order).
3. **Provider auth failover** happens inside a provider before moving to the next model.

Related:

- `agents.defaults.models` is the allowlist/catalog of models CrawClaw can use.
- `agents.defaults.imageModel` is used only when the primary model cannot accept images.
- Per-agent defaults can override `agents.defaults.model` via `agents.list[].model`.

## Quick model policy

- Set your primary to the strongest latest-generation model available to you.
- Use fallbacks for cost/latency-sensitive tasks and lower-stakes chat.
- For tool-enabled agents or untrusted inputs, avoid older/weaker model tiers.

## Setup

Configure providers from CrawClaw Desktop settings. Advanced automation can patch
provider config through the Gateway API and then refresh the desktop state.

## Config keys

- `agents.defaults.model.primary` and `agents.defaults.model.fallbacks`
- `agents.defaults.imageModel.primary` and `agents.defaults.imageModel.fallbacks`
- `agents.defaults.models` for allowlist, catalog, and aliases
- `models.providers` for custom providers written into `models.json`

Model refs are normalized to lowercase. Provider aliases like `z.ai/*` normalize
to `zai/*`.

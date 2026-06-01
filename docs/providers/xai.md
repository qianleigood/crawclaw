---
summary: "Use xAI Grok models in CrawClaw"
read_when:
  - You want to use Grok models in CrawClaw
  - You are configuring xAI auth or model ids
title: "xAI"
---

# xAI

CrawClaw ships a bundled `xai` provider plugin for Grok models.

## Setup

1. Create an API key in the xAI console.
2. Set `XAI_API_KEY`, or run:

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

3. Pick a model such as:

```json5
{
  agents: { defaults: { model: { primary: "xai/grok-4" } } },
}
```

CrawClaw now uses the xAI Responses API as the bundled xAI transport.

## Current bundled model catalog

CrawClaw now includes these xAI model families out of the box:

- `grok-4`, `grok-4-0709`
- `grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`
- `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`
- `grok-4.20-reasoning`, `grok-4.20-non-reasoning`
- `grok-code-fast-1`

The plugin also forward-resolves newer `grok-4*` and `grok-code-fast*` ids when
they follow the same API shape.

## Known limits

- Auth is API-key only today. There is no xAI OAuth/device-code flow in CrawClaw yet.
- `grok-4.20-multi-agent-experimental-beta-0304` is not supported on the normal xAI provider path because it requires a different upstream API surface than the standard CrawClaw xAI transport.

## Notes

- CrawClaw applies xAI-specific tool-schema and tool-call compatibility fixes automatically on the shared runner path.
- xAI is a model provider only. CrawClaw no longer exposes xAI-owned web search or remote code-execution add-ons as agent tools.
- For the broader provider overview, see [Model providers](/providers/index).

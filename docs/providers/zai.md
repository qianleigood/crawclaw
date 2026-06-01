---
summary: "Use Z.AI (GLM models) with CrawClaw"
read_when:
  - You want Z.AI / GLM models in CrawClaw
  - You need a simple ZAI_API_KEY setup
title: "Z.AI"
---

# Z.AI

Z.AI is the API platform for **GLM** models. It provides REST APIs for GLM and uses API keys
for authentication. Create your API key in the Z.AI console. CrawClaw uses the `zai` provider
with a Z.AI API key.

## Desktop setup

Use CrawClaw Desktop for interactive setup, or call the local Gateway API for automation.

## Config snippet

```json5
{
  env: { ZAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "zai/glm-5" } } },
}
```

## Notes

- GLM models are available as `zai/<model>` (example: `zai/glm-5`).
- `tool_stream` is enabled by default for Z.AI tool-call streaming. Set
  `agents.defaults.models["zai/<model>"].params.tool_stream` to `false` to disable it.
- See [/providers/glm](/providers/glm) for the model family overview.
- Z.AI uses Bearer auth with your API key.

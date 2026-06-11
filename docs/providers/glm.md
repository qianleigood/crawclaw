---
summary: "GLM model family overview + how to use it in CrawClaw"
read_when:
  - You want GLM models in CrawClaw
  - You need the model naming convention and setup
title: "GLM Models"
---

# GLM models

GLM is a **model family** (not a company) available through the Z.AI platform. In CrawClaw, GLM
models are accessed via the `zai` provider and model IDs like `zai/glm-5`.

## Desktop setup

Use the Z.AI provider setup in CrawClaw Desktop: open **Settings → Models and
replies → Add model**, choose Z.AI, paste the API key, and save the desired
`zai/glm-*` model profile. Desktop stores the key as a local file SecretRef
after the connection probe succeeds.

For headless hosts, set `ZAI_API_KEY` in the Gateway environment or patch
`models.providers.zai.apiKey` to an `env`, `file`, or `exec` SecretRef with
`config.patch`.

## Config snippet

```json5
{
  env: { ZAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "zai/glm-5" } } },
}
```

## Notes

- GLM versions and availability can change; check Z.AI's docs for the latest.
- Example model IDs include `glm-5.1`, `glm-5`, `glm-5v-turbo`, `glm-4.7`, and `glm-4.6`.
- For provider details, see [/providers/zai](/providers/zai).

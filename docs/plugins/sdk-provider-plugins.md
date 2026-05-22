---
title: "Provider Configuration"
sidebarTitle: "Providers"
summary: "How model providers are configured now that provider plugins have moved to Rust"
read_when:
  - You need to add or configure an LLM provider
  - You are migrating away from the old TypeScript provider plugin API
  - You need to understand models.providers
---

# Provider Configuration

CrawClaw no longer supports TypeScript model provider plugins. The old
TypeScript provider registration entrypoint, provider catalog hooks, and
provider runtime hooks have been replaced by the Rust plugin SDK, manifest
metadata, and native registry.

Provider metadata, auth choices, model catalogs, config schema, and native
transport behavior are owned by the Rust provider registry. The Gateway builds
`models.list`, `runtime.status`, `config.schema`, and `config.schema.lookup`
from that Rust registry.

## Add a provider

Use `models.providers` in config for custom providers:

```json
{
  "models": {
    "providers": {
      "acme-ai": {
        "baseUrl": "https://api.acme-ai.example/v1",
        "apiKey": { "source": "env", "id": "ACME_AI_API_KEY" },
        "api": "openai-completions",
        "models": [
          {
            "id": "acme-large",
            "name": "Acme Large",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
            "contextWindow": 200000,
            "maxTokens": 32768
          }
        ]
      }
    }
  }
}
```

The Rust schema validates the provider entry shape, SecretRef handling,
transport adapter enum, and model entry fields.

## Plugin boundary

TypeScript plugins no longer register production tools, commands, services,
channels, speech providers, media-understanding providers, web fetch providers,
web search providers, LLM providers, or typed lifecycle hooks.

If a provider needs to become built-in, add it to the Rust provider registry or
the appropriate Rust native plugin registry. Keep package metadata declarative
and non-executing.

## Related

- [Model Providers](/concepts/model-providers)
- [Configuration Reference](/gateway/configuration-reference)
- [SDK Overview](/plugins/sdk-overview)

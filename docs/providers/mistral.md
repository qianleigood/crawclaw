---
summary: "Use Mistral models and Voxtral transcription with CrawClaw"
read_when:
  - You want to use Mistral models in CrawClaw
  - You need Mistral API key onboarding and model refs
title: "Mistral"
---

# Mistral

CrawClaw supports Mistral for both text/image model routing (`mistral/...`) and
audio transcription via Voxtral in media understanding.

## Desktop setup

Open **Settings → Models and replies → Add model** in CrawClaw Desktop, choose
Mistral, paste your Mistral API key, and save a `mistral/<model>` profile.
Desktop stores the key as a local file SecretRef after the connection probe
succeeds.

For headless hosts, set `MISTRAL_API_KEY` in the Gateway environment or patch
`models.providers.mistral.apiKey` to an `env`, `file`, or `exec` SecretRef with
`config.patch`.

## Config snippet (LLM provider)

```json5
{
  env: { MISTRAL_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "mistral/mistral-large-latest" } } },
}
```

## Config snippet (audio transcription with Voxtral)

```json5
{
  tools: {
    media: {
      audio: {
        enabled: true,
        models: [{ provider: "mistral", model: "voxtral-mini-latest" }],
      },
    },
  },
}
```

## Notes

- Mistral auth uses `MISTRAL_API_KEY`.
- Provider base URL defaults to `https://api.mistral.ai/v1`.
- Onboarding default model is `mistral/mistral-large-latest`.
- Media-understanding default audio model for Mistral is `voxtral-mini-latest`.
- Media transcription path uses `/v1/audio/transcriptions`.

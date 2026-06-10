---
summary: "Audit what can spend money, which keys are used, and how to view usage"
read_when:
  - You want to understand which features may call paid APIs
  - You need to audit keys, costs, and usage visibility
  - You’re explaining /status or /usage cost reporting
title: "API Usage and Costs"
---

# API usage & costs

This doc lists **features that can invoke API keys** and where their costs show up. It focuses on
CrawClaw features that can generate provider usage or paid API calls.

## Where costs show up (chat + CLI)

**Per-session cost snapshot**

- `/status` shows the current session model, context usage, and last response tokens.
- If the model uses **API-key auth**, `/status` also shows **estimated cost** for the last reply.

**Per-message cost footer**

- `/usage full` appends a usage footer to every reply, including **estimated cost** (API-key only).
- `/usage tokens` shows tokens only; OAuth flows hide dollar cost.

**Provider usage windows**

- CrawClaw Desktop and the local Gateway API show provider **usage windows**
  (quota snapshots, not per-message costs).

See [Token use & costs](/reference/token-use) for details and examples.

## How keys are discovered

CrawClaw can pick up credentials from:

- **Auth profiles** (per-agent, stored in `auth-profiles.json`).
- **Environment variables** (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
- **Config** (`models.providers.*.apiKey`, `plugins.entries.*.config.*`,
  `talk.providers.*.apiKey`).
- **Skills** (`skills.entries.<name>.apiKey`) which may export keys to the skill process env.

## Features that can spend keys

### 1) Core model responses (chat + tools)

Every reply or tool call uses the **current model provider** (OpenAI, Anthropic, etc). This is the
primary source of usage and cost.

See [Models](/providers/models) for pricing config and [Token use & costs](/reference/token-use) for display.

### 2) Media understanding (audio/image/video)

Inbound media can be summarized/transcribed before the reply runs. This uses model/provider APIs.

- Audio: OpenAI / Groq / Deepgram (now **auto-enabled** when keys exist).
- Image: OpenAI / Anthropic / Google.
- Video: Google.

See [Media in and out](/start/crawclaw#media-in-and-out).

### 3) Memory

The built-in memory runtime can call the configured LLM roles for durable
extraction, experience extraction, dream consolidation, and session summaries.
Hindsight integration can also invoke your configured Hindsight HTTP endpoint
when enabled.

See [Memory](/concepts/memory).

### 4) Web search tool

`web_search` uses the bundled managed SearXNG path by default and does not need
a provider API key. Native provider web search can still consume model-provider
quota when you explicitly enable the provider-native Codex web search mode.

See [Web Search](/tools/web).

### 5) Web fetch tool

`web_fetch` uses the active fetch provider or falls back to direct fetch + readability when no
provider is configured.

See [Web tools](/tools/web).

### 6) Provider usage snapshots (status/health)

Some status commands call **provider usage endpoints** to display quota windows or auth health.
These are typically low-volume calls but still hit provider APIs:

- `usage.status` reports provider quota/auth windows through CrawClaw Desktop
  or the local Gateway API.
- `usage.cost` aggregates local session transcript usage for cost summaries.

See [Models](/concepts/models).

### 7) Compaction safeguard summarization

The compaction safeguard can summarize session history using the **current model**, which
invokes provider APIs when it runs.

See [Session management + compaction](/reference/session-management-compaction).

### 8) Model scan / probe

CrawClaw Desktop or the local Gateway API can probe OpenRouter models and uses `OPENROUTER_API_KEY` when
probing is enabled.

See [Models](/concepts/models).

### 9) Talk (speech)

Talk mode uses the bundled Rust native `qwen3-tts` provider by default. It does
not call ElevenLabs, Microsoft, or OpenAI speech APIs from the product runtime.

See [TTS](/tools/tts).

### 10) Skills (third-party APIs)

Skills can store `apiKey` in `skills.entries.<name>.apiKey`. If a skill uses that key for external
APIs, it can incur costs according to the skill’s provider.

See [Skills](/tools/skills).

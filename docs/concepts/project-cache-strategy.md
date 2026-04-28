---
read_when:
  - You are reviewing prompt cache, memory cache, web fetch cache, or routing cache behavior
  - You need to identify cache owners, cache keys, invalidation rules, or cache tests
summary: CrawClaw's layered cache model, current ownership boundaries, and governance rules
title: Project Cache Strategy
---

# Project Cache Strategy

CrawClaw does not have one central cache service. It uses domain-owned caches across the agent kernel, web tools, memory, plugins, routing, gateway control plane, media, and UI.

The important review question is not “where is the Map.” It is:

- who owns this cache
- what identity forms the cache key
- how the cache expires or invalidates
- how tests prove the cache cannot cross user, session, provider, or config boundaries

## Cache Governance Registry

The code-level inventory starts at `src/cache/governance.ts`.

Each critical cache should have a `CacheGovernanceDescriptor` with:

- `owner`
- `key`
- `lifecycle`
- `invalidation`
- `observability`

`src/cache/governance.test.ts` keeps descriptor IDs unique and requires coverage for critical mutable caches such as `config.sessions.store` and `agents.web-fetch.response`.

## Query And Prompt Identity

Primary code:

- `src/agents/query-context/cache-contract.ts`

This layer defines the query-layer cache envelope and hashes:

- `queryContextHash`
- `forkContextMessagesHash`
- `envelopeHash`

Tool inventory, thinking config, system prompt text, and fork context are part of the identity. User prompt content is not a hidden input to these hashes; callers must treat this as a prompt-prefix identity contract, not as a generic response cache.

## Runtime Acceleration Caches

Primary code:

- `src/config/cache-utils.ts`
- `src/agents/context-cache.ts`
- `src/agents/bootstrap-cache.ts`
- `src/agents/pi-embedded-runner/session-manager-cache.ts`
- `src/agents/pi-embedded-runner/cache-ttl.ts`

These caches reduce repeated runtime work. They are usually short-lived, process-local, and scoped by TTL, session, or workspace.

`src/config/cache-utils.ts` should stay a small primitive layer. Domain-specific invalidation belongs with the domain cache that owns the data.

## Session Store Cache

Primary code:

- `src/config/sessions/store-cache.ts`
- `src/config/sessions/store.ts`

The session store cache has two parts:

- an object cache keyed by store path plus file `mtimeMs` and size
- a serialized write-through cache keyed by the same file fingerprint

The serialized cache must not skip writes after an external process changes the session file. The regression coverage lives in `src/config/sessions.cache.test.ts`.

## Web Fetch Response Cache

Primary code:

- `src/agents/tools/web-fetch.ts`
- `src/agents/tools/web-fetch-runtime-helpers.ts`
- `src/agents/tools/web-shared.ts`

`web_fetch` caches provider-backed and local fetch responses in process memory. Its cache key includes the requested URL, output shape, fetch settings, provider ID, sticky `sessionId`, and provider wait hints.

This is a security-sensitive cache. A provider-backed response for one sticky browser session must never be reused for another session. Regression coverage lives in `src/agents/tools/web-fetch.provider-fallback.test.ts`.

## Routing And Control Plane Caches

Primary code:

- `src/routing/resolve-route.ts`
- `src/plugins/loader.ts`
- `src/plugins/discovery.ts`
- `src/plugins/manifest-registry.ts`
- `src/gateway/model-pricing-cache.ts`
- `src/acp/control-plane/runtime-cache.ts`
- `src/infra/outbound/directory-cache.ts`

Routing caches are keyed by config object plus content signatures for mutable config sections such as `bindings`, `agents`, and `session`. This lets routing stay fast for stable config while still detecting in-place mutations during tests or reload flows.

Plugin discovery and manifest caches use short TTL windows to collapse bursty startup reloads. Loader registry caches use bounded entries and explicit clear functions.

## Memory And File Caches

Primary code:

- `src/memory/session-summary/store.ts`
- `src/memory/engine/built-in-memory-runtime.ts`
- `src/memory/durable/body-index.ts`
- `src/media-understanding/attachments.cache.ts`

These caches are domain-owned. File caches commonly use `mtimeMs + size` fingerprints, which are suitable for best-effort read acceleration but should not be treated as cryptographic content identity.

## Extension Caches

Examples:

- `extensions/slack/src/sent-thread-cache.ts`
- `extensions/msteams/src/sent-message-cache.ts`
- `extensions/telegram/src/sent-message-cache.ts`
- `extensions/telegram/src/sticker-cache.ts`
- `extensions/qqbot/src/utils/upload-cache.ts`

Extension caches should include the channel account, conversation, recipient, provider, or file scope needed to avoid cross-account reuse. Long-lived or persistent extension caches also need a bounded size, TTL, or explicit cleanup path.

Account ID alone is not enough when credentials or account config can change the result. In those cases, include a non-secret credential fingerprint or a narrow config signature in the cache key.

## Maintenance Rules

When adding or changing a cache:

1. Put ownership and invalidation in the domain module, not in a generic shared cache layer.
2. Add or update the governance descriptor for critical caches.
3. Add a regression test for cross-session, cross-account, cross-provider, external-file-write, or config-mutation boundaries.
4. Use explicit structured keys for security-sensitive caches.
5. Keep provider prompt cache, response cache, runtime TTL cache, client-side cache, and file cache as separate concepts.

## Related Docs

- [Context](/concepts/context)
- [Memory](/concepts/memory)
- [Session](/concepts/session)
- [Plugins Architecture](/plugins/architecture)

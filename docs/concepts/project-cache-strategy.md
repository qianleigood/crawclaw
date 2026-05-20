---
read_when:
  - You are reviewing prompt cache, memory cache, web fetch cache, or routing cache behavior
  - You need to identify cache owners, cache keys, invalidation rules, or validation gates
summary: CrawClaw's layered cache model, current ownership boundaries, and governance rules
title: Project Cache Strategy
---

# Project Cache Strategy

CrawClaw does not have one central cache service. It uses domain-owned caches
across the Rust agent runtime, native plugins, routing, Gateway control plane,
media, and the desktop UI.

The important review question is not “where is the Map.” It is:

- who owns this cache
- what identity forms the cache key
- how the cache expires or invalidates
- how the relevant Rust/native gate proves the cache cannot cross user, session, provider, or config boundaries

## Cache Governance

The old TypeScript cache governance registry has been removed. Each critical
cache should now be documented and tested with its Rust/native owner, covering:

- `owner`
- `key`
- `lifecycle`
- `invalidation`
- `observability`

Keep identifiers stable in test names and docs when a cache crosses session,
provider, account, or config boundaries.

## Query And Prompt Identity

This layer defines the query-layer cache envelope and hashes:

- `queryContextHash`
- `forkContextMessagesHash`
- `envelopeHash`

Tool inventory, thinking config, system prompt text, and fork context are part of the identity. User prompt content is not a hidden input to these hashes; callers must treat this as a prompt-prefix identity contract, not as a generic response cache.

## Runtime Acceleration Caches

Rust AgentRuntime session and context caches reduce repeated runtime work. They
are usually short-lived, process-local, and scoped by TTL, session, or
workspace. Domain-specific invalidation belongs with the Rust/native owner of
the data.

## Session Store Cache

The session store cache has two parts:

- an object cache keyed by store path plus file `mtimeMs` and size
- a serialized write-through cache keyed by the same file fingerprint

The serialized cache must not skip writes after an external process changes the
session file. Validate this behavior through the Rust/native session
persistence gate before changing the cache semantics.

## Web Fetch Response Cache

Primary code:

- `crates/crawclaw-native-plugins/src/web.rs`

`web_fetch` caches Rust native fetch responses in process memory. Its cache key includes the requested URL, output shape, fetch settings, provider ID, sticky `sessionId`, and provider wait hints.

This is a security-sensitive cache. A rendered response for one sticky browser session must never be reused for another session. Regression coverage lives in the Rust native web fetch tests.

## Routing And Control Plane Caches

Primary code:

- `crates/crawclaw-runtime/src/native_plugin_registry.rs`
- `crates/crawclaw-gateway/src/lib.rs`
- `crates/crawclaw-providers/src/lib.rs`

Routing caches are keyed by config object plus content signatures for mutable
config sections such as `bindings`, `agents`, and `session`. This lets routing
stay fast for stable config while still detecting in-place mutations during
tests or reload flows.

Native plugin discovery is owned by the Rust runtime registry. Loader registry
caches use bounded entries and explicit clear functions.

## Memory And File Caches

These caches are domain-owned. File caches commonly use `mtimeMs + size` fingerprints, which are suitable for best-effort read acceleration but should not be treated as cryptographic content identity.

## Extension Caches

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

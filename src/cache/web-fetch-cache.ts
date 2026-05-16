import type { CacheGovernanceDescriptor } from "./governance-types.js";

export const WEB_FETCH_RESPONSE_CACHE_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "agents.web-fetch.response",
  module: "crates/crawclaw-runtime/src/core_tools.rs",
  category: "runtime_ttl",
  owner: "crawclaw-runtime/web_fetch",
  key: "structured web_fetch runtime params including URL, output shape, provider id, sticky session, wait hints, and fetch config",
  lifecycle:
    "Per-process response cache retained until TTL expiry, max-entry eviction, cache identity changes, or process restart.",
  invalidation: [
    "tools.web.fetch.cacheTtlMinutes expiry or zero TTL",
    "Provider/session/wait/output/fetch configuration changes produce a different cache key",
    "Rust-native max-entry eviction removes the oldest entry",
  ],
  observability: [
    "Returned web_fetch payloads include cached=true on cache hits",
    "Rust native web_fetch tests cover provider dispatch and response shaping",
  ],
};

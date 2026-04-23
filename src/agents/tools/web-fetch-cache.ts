import type { CacheGovernanceDescriptor } from "../../cache/governance-types.js";

export const WEB_FETCH_RESPONSE_CACHE_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "agents.web-fetch.response",
  module: "src/agents/tools/web-fetch.ts",
  category: "runtime_ttl",
  owner: "agents/tools/web-fetch",
  key: "structured web_fetch runtime params including URL, output shape, provider id, sticky session, wait hints, and fetch config",
  lifecycle:
    "Per-process response cache retained until TTL expiry, max-entry eviction, cache identity changes, or process restart.",
  invalidation: [
    "tools.web.fetch.cacheTtlMinutes expiry or zero TTL",
    "Provider/session/wait/output/fetch configuration changes produce a different cache key",
    "web-shared max-entry eviction removes the oldest entry",
  ],
  observability: [
    "Returned web_fetch payloads include cached=true on cache hits",
    "src/agents/tools/web-fetch.provider-fallback.test.ts covers provider-backed session isolation",
  ],
};

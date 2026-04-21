export const CACHE_GOVERNANCE_CATEGORIES = [
  "query_prompt_identity",
  "runtime_ttl",
  "plugin_routing_control_plane",
  "file_ui",
] as const;

export type CacheGovernanceCategory = (typeof CACHE_GOVERNANCE_CATEGORIES)[number];

export type CacheGovernanceDescriptor = {
  id: string;
  module: string;
  category: CacheGovernanceCategory;
  owner: string;
  key: string;
  lifecycle: string;
  invalidation: string[];
  observability: string[];
};

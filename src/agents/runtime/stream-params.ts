export type AgentStreamParams = {
  temperature?: number;
  maxTokens?: number;
  toolChoice?: unknown;
  cacheRetention?: "none" | "short" | "long";
  skipCacheWrite?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: string;
  fastMode?: boolean;
};

import { normalizeModelRef } from "../agents/model-selection.js";
import { normalizeProviderId } from "../agents/provider-id.js";
import { OPENROUTER_WRAPPER_PROVIDERS as OPENROUTER_WRAPPER_PROVIDER_VALUES } from "../providers/runtime-constants.js";

export type CachedModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

let cachedPricing = new Map<string, CachedModelPricing>();
let cachedAt = 0;

const WRAPPER_PROVIDERS = new Set<string>(OPENROUTER_WRAPPER_PROVIDER_VALUES);

function modelPricingCacheKey(provider: string, model: string): string {
  const providerId = normalizeProviderId(provider);
  const modelId = model.trim();
  if (!providerId || !modelId) {
    return "";
  }
  return modelId.toLowerCase().startsWith(`${providerId.toLowerCase()}/`)
    ? modelId
    : `${providerId}/${modelId}`;
}

function shouldNormalizeCachedPricingLookup(provider: string): boolean {
  const normalized = normalizeProviderId(provider);
  return (
    normalized === "anthropic" ||
    normalized === "openrouter" ||
    normalized === "xai" ||
    WRAPPER_PROVIDERS.has(normalized)
  );
}

export function replaceGatewayModelPricingCache(
  nextPricing: Map<string, CachedModelPricing>,
  nextCachedAt = Date.now(),
): void {
  cachedPricing = nextPricing;
  cachedAt = nextCachedAt;
}

export function getCachedGatewayModelPricing(params: {
  provider?: string;
  model?: string;
}): CachedModelPricing | undefined {
  const provider = params.provider?.trim();
  const model = params.model?.trim();
  if (!provider || !model) {
    return undefined;
  }
  const key = modelPricingCacheKey(provider, model);
  const direct = key ? cachedPricing.get(key) : undefined;
  if (direct) {
    return direct;
  }
  if (!shouldNormalizeCachedPricingLookup(provider)) {
    return undefined;
  }
  const normalized = normalizeModelRef(provider, model);
  const normalizedKey = modelPricingCacheKey(normalized.provider, normalized.model);
  return normalizedKey ? cachedPricing.get(normalizedKey) : undefined;
}

export function getGatewayModelPricingCacheMeta(): {
  cachedAt: number;
  ttlMs: number;
  size: number;
} {
  return {
    cachedAt,
    ttlMs: 0,
    size: cachedPricing.size,
  };
}

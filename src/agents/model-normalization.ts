import PROVIDER_MODEL_NORMALIZATION_JSON from "../generated/providers/model-normalization.generated.json" with { type: "json" };

type ModelAlias = { readonly from: string; readonly to: string };

type ProviderModelNormalizationPayload = {
  anthropicModelAliases: ModelAlias[];
  googleModelAliases: ModelAlias[];
  antigravityLowSuffixIds: string[];
  xaiModelAliases: ModelAlias[];
};

const PROVIDER_MODEL_NORMALIZATION =
  PROVIDER_MODEL_NORMALIZATION_JSON as ProviderModelNormalizationPayload;

const ANTIGRAVITY_LOW_SUFFIX_IDS = new Set<string>(
  PROVIDER_MODEL_NORMALIZATION.antigravityLowSuffixIds,
);

function normalizeByAlias(id: string, aliases: readonly ModelAlias[]): string {
  return aliases.find((alias) => alias.from === id)?.to ?? id;
}

function normalizeByTrimmedLowerAlias(id: string, aliases: readonly ModelAlias[]): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return trimmed;
  }
  return aliases.find((alias) => alias.from === trimmed.toLowerCase())?.to ?? trimmed;
}

export function normalizeAnthropicModelId(id: string): string {
  return normalizeByTrimmedLowerAlias(id, PROVIDER_MODEL_NORMALIZATION.anthropicModelAliases);
}

export function normalizeGoogleModelId(id: string): string {
  return normalizeByAlias(id, PROVIDER_MODEL_NORMALIZATION.googleModelAliases);
}

export function normalizeAntigravityModelId(id: string): string {
  if (ANTIGRAVITY_LOW_SUFFIX_IDS.has(id)) {
    return `${id}-low`;
  }
  return id;
}

export function normalizeXaiModelId(id: string): string {
  return normalizeByAlias(id, PROVIDER_MODEL_NORMALIZATION.xaiModelAliases);
}

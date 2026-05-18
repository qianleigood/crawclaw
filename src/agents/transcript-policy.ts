import type { CrawClawConfig } from "../config/config.js";
import {
  OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_APIS,
  OPENAI_COMPATIBLE_TURN_VALIDATION_API,
  TRANSCRIPT_ANTHROPIC_MODEL_APIS,
  TRANSCRIPT_OPENAI_MODEL_APIS,
} from "../generated/providers/runtime-constants.generated.js";
import { normalizeProviderId } from "./model-selection.js";
import {
  isAnthropicProviderFamily,
  isOpenAiProviderFamily,
  preservesAnthropicThinkingSignatures,
  resolveTranscriptToolCallIdMode,
  shouldDropThinkingBlocksForModel,
  shouldSanitizeGeminiThoughtSignaturesForModel,
  supportsOpenAiCompatTurnValidation,
} from "./provider-capabilities.js";
import type { ProviderRuntimeModel } from "./provider-runtime-types.js";
import { isGoogleModelApi } from "./runtime-helpers/google.js";
import type { ToolCallIdMode } from "./tool-call-id.js";

export type TranscriptSanitizeMode = "full" | "images-only";

export type TranscriptPolicy = {
  sanitizeMode: TranscriptSanitizeMode;
  sanitizeToolCallIds: boolean;
  toolCallIdMode?: ToolCallIdMode;
  repairToolUseResultPairing: boolean;
  preserveSignatures: boolean;
  sanitizeThoughtSignatures?: {
    allowBase64Only?: boolean;
    includeCamelCase?: boolean;
  };
  sanitizeThinkingSignatures: boolean;
  dropThinkingBlocks: boolean;
  applyGoogleTurnOrdering: boolean;
  validateGeminiTurns: boolean;
  validateAnthropicTurns: boolean;
  allowSyntheticToolResults: boolean;
};

const OPENAI_MODEL_APIS = new Set<string>(TRANSCRIPT_OPENAI_MODEL_APIS);
const ANTHROPIC_MODEL_APIS = new Set<string>(TRANSCRIPT_ANTHROPIC_MODEL_APIS);
const OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_API_SET = new Set<string>(
  OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_APIS,
);

function isOpenAiApi(modelApi?: string | null): boolean {
  if (!modelApi) {
    return false;
  }
  return OPENAI_MODEL_APIS.has(modelApi);
}

function isOpenAiProvider(provider?: string | null): boolean {
  return isOpenAiProviderFamily(provider);
}

function isAnthropicApi(modelApi?: string | null, provider?: string | null): boolean {
  if (modelApi && ANTHROPIC_MODEL_APIS.has(modelApi)) {
    return true;
  }
  // MiniMax now uses openai-completions API, not anthropic-messages
  return isAnthropicProviderFamily(provider);
}

export function resolveTranscriptPolicy(params: {
  modelApi?: string | null;
  provider?: string | null;
  modelId?: string | null;
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  model?: ProviderRuntimeModel;
}): TranscriptPolicy {
  const provider = normalizeProviderId(params.provider ?? "");
  const modelId = params.modelId ?? "";
  const isGoogle = isGoogleModelApi(params.modelApi);
  const isAnthropic = isAnthropicApi(params.modelApi, provider);
  const isOpenAi = isOpenAiProvider(provider) || (!provider && isOpenAiApi(params.modelApi));
  const isStrictOpenAiCompatible =
    params.modelApi === OPENAI_COMPATIBLE_TURN_VALIDATION_API &&
    !isOpenAi &&
    supportsOpenAiCompatTurnValidation(provider);
  const providerToolCallIdMode = resolveTranscriptToolCallIdMode(provider, modelId);
  const isMistral = providerToolCallIdMode === "strict9";
  const shouldSanitizeGeminiThoughtSignaturesForProvider =
    shouldSanitizeGeminiThoughtSignaturesForModel({
      provider,
      modelId,
    });
  const requiresOpenAiCompatibleToolIdSanitization =
    params.modelApi != null &&
    OPENAI_COMPATIBLE_TOOL_ID_SANITIZATION_API_SET.has(params.modelApi) &&
    (params.modelApi === OPENAI_COMPATIBLE_TURN_VALIDATION_API || !isOpenAi);

  // Anthropic Claude endpoints can reject replayed `thinking` blocks unless the
  // original signatures are preserved byte-for-byte. Drop them at send-time to
  // keep persisted sessions usable across follow-up turns.
  const dropThinkingBlocks = shouldDropThinkingBlocksForModel({ provider, modelId });

  const needsNonImageSanitize =
    isGoogle || isAnthropic || isMistral || shouldSanitizeGeminiThoughtSignaturesForProvider;

  const sanitizeToolCallIds =
    isGoogle || isMistral || isAnthropic || requiresOpenAiCompatibleToolIdSanitization;
  const toolCallIdMode: ToolCallIdMode | undefined = providerToolCallIdMode
    ? providerToolCallIdMode
    : isMistral
      ? "strict9"
      : sanitizeToolCallIds
        ? "strict"
        : undefined;
  // All providers need orphaned tool_result repair after history truncation.
  // OpenAI rejects function_call_output items whose call_id has no matching
  // function_call in the conversation, so the repair must run universally.
  const repairToolUseResultPairing = true;
  const sanitizeThoughtSignatures =
    shouldSanitizeGeminiThoughtSignaturesForProvider || isGoogle
      ? { allowBase64Only: true, includeCamelCase: true }
      : undefined;

  const basePolicy: TranscriptPolicy = {
    sanitizeMode: isOpenAi ? "images-only" : needsNonImageSanitize ? "full" : "images-only",
    sanitizeToolCallIds:
      (!isOpenAi && sanitizeToolCallIds) || requiresOpenAiCompatibleToolIdSanitization,
    toolCallIdMode,
    repairToolUseResultPairing,
    preserveSignatures: isAnthropic && preservesAnthropicThinkingSignatures(provider),
    sanitizeThoughtSignatures: isOpenAi ? undefined : sanitizeThoughtSignatures,
    sanitizeThinkingSignatures: false,
    dropThinkingBlocks,
    applyGoogleTurnOrdering: !isOpenAi && (isGoogle || isStrictOpenAiCompatible),
    validateGeminiTurns: !isOpenAi && (isGoogle || isStrictOpenAiCompatible),
    validateAnthropicTurns: !isOpenAi && (isAnthropic || isStrictOpenAiCompatible),
    allowSyntheticToolResults: !isOpenAi && (isGoogle || isAnthropic),
  };

  return basePolicy;
}

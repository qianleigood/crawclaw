import type { CrawClawConfig } from "../config/config.js";
import {
  GOOGLE_GEMINI_DEFAULT_MODEL as RUST_GOOGLE_GEMINI_DEFAULT_MODEL,
  LEGACY_OPENCODE_ZEN_DEFAULT_MODELS as RUST_LEGACY_OPENCODE_ZEN_DEFAULT_MODELS,
  OLLAMA_DEFAULT_BASE_URL as RUST_OLLAMA_DEFAULT_BASE_URL,
  OPENCODE_GO_DEFAULT_MODEL_REF as RUST_OPENCODE_GO_DEFAULT_MODEL_REF,
  OPENCODE_ZEN_DEFAULT_MODEL as RUST_OPENCODE_ZEN_DEFAULT_MODEL,
  OPENAI_CODEX_DEFAULT_MODEL as RUST_OPENAI_CODEX_DEFAULT_MODEL,
  OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL as RUST_OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL,
  OPENAI_DEFAULT_EMBEDDING_MODEL as RUST_OPENAI_DEFAULT_EMBEDDING_MODEL,
  OPENAI_DEFAULT_IMAGE_MODEL as RUST_OPENAI_DEFAULT_IMAGE_MODEL,
  OPENAI_DEFAULT_MODEL as RUST_OPENAI_DEFAULT_MODEL,
} from "../generated/providers/runtime-constants.generated.js";
import { ensureModelAllowlistEntry } from "./provider-model-allowlist.js";
import { applyAgentDefaultPrimaryModel } from "./provider-model-primary.js";

export const OPENAI_DEFAULT_MODEL = RUST_OPENAI_DEFAULT_MODEL;
export const OPENAI_CODEX_DEFAULT_MODEL = RUST_OPENAI_CODEX_DEFAULT_MODEL;
export const OPENAI_DEFAULT_IMAGE_MODEL = RUST_OPENAI_DEFAULT_IMAGE_MODEL;
export const OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL =
  RUST_OPENAI_DEFAULT_AUDIO_TRANSCRIPTION_MODEL;
export const OPENAI_DEFAULT_EMBEDDING_MODEL = RUST_OPENAI_DEFAULT_EMBEDDING_MODEL;
export const GOOGLE_GEMINI_DEFAULT_MODEL = RUST_GOOGLE_GEMINI_DEFAULT_MODEL;
export const OLLAMA_DEFAULT_BASE_URL = RUST_OLLAMA_DEFAULT_BASE_URL;
export const OPENCODE_GO_DEFAULT_MODEL_REF = RUST_OPENCODE_GO_DEFAULT_MODEL_REF;
export const OPENCODE_ZEN_DEFAULT_MODEL = RUST_OPENCODE_ZEN_DEFAULT_MODEL;

const LEGACY_OPENCODE_ZEN_DEFAULT_MODELS = new Set(RUST_LEGACY_OPENCODE_ZEN_DEFAULT_MODELS);

export function applyGoogleGeminiModelDefault(cfg: CrawClawConfig): {
  next: CrawClawConfig;
  changed: boolean;
} {
  return applyAgentDefaultPrimaryModel({ cfg, model: GOOGLE_GEMINI_DEFAULT_MODEL });
}

export function applyOpenAIProviderConfig(cfg: CrawClawConfig): CrawClawConfig {
  const next = ensureModelAllowlistEntry({
    cfg,
    modelRef: OPENAI_DEFAULT_MODEL,
  });
  const models = { ...next.agents?.defaults?.models };
  models[OPENAI_DEFAULT_MODEL] = {
    ...models[OPENAI_DEFAULT_MODEL],
    alias: models[OPENAI_DEFAULT_MODEL]?.alias ?? "GPT",
  };

  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents?.defaults,
        models,
      },
    },
  };
}

export function applyOpenAIConfig(cfg: CrawClawConfig): CrawClawConfig {
  const next = applyOpenAIProviderConfig(cfg);
  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents?.defaults,
        model:
          next.agents?.defaults?.model && typeof next.agents.defaults.model === "object"
            ? {
                ...next.agents.defaults.model,
                primary: OPENAI_DEFAULT_MODEL,
              }
            : { primary: OPENAI_DEFAULT_MODEL },
      },
    },
  };
}

export function applyOpencodeGoModelDefault(cfg: CrawClawConfig): {
  next: CrawClawConfig;
  changed: boolean;
} {
  return applyAgentDefaultPrimaryModel({ cfg, model: OPENCODE_GO_DEFAULT_MODEL_REF });
}

export function applyOpencodeZenModelDefault(cfg: CrawClawConfig): {
  next: CrawClawConfig;
  changed: boolean;
} {
  return applyAgentDefaultPrimaryModel({
    cfg,
    model: OPENCODE_ZEN_DEFAULT_MODEL,
    legacyModels: LEGACY_OPENCODE_ZEN_DEFAULT_MODELS,
  });
}

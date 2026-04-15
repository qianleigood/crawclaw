import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { getMediaUnderstandingProvider } from "../../media-understanding/provider-registry.js";
import { buildProviderRegistry } from "../../media-understanding/runner.js";
import {
  describeImageWithModel,
  describeImagesWithModel,
  type MediaUnderstandingProvider,
} from "../../plugin-sdk/media-understanding.js";
import { isMinimaxVlmProvider } from "../minimax-vlm.js";
import {
  coerceImageAssistantText,
  coerceImageModelConfig,
  decodeDataUrl,
  type ImageModelConfig,
  resolveProviderVisionModelFromConfig,
} from "./image-tool.helpers.js";
import {
  applyImageModelConfigDefaults,
  buildTextToolResult,
} from "./media-tool-shared.js";
import {
  buildToolModelConfigFromCandidates,
  hasToolModelConfig,
  resolveDefaultModelRef,
} from "./model-config.helpers.js";
import {
  runWithImageModelFallback,
  type AnyAgentTool,
  type ToolFsPolicy,
} from "./tool-runtime.helpers.js";
import {
  buildImageToolResultDetails,
  loadImageToolInputs,
  normalizeImageToolInput,
  pickMaxBytes,
  type ImageSandboxConfig,
} from "./image-tool-runtime.js";

const ANTHROPIC_IMAGE_PRIMARY = "anthropic/claude-opus-4-6";
const ANTHROPIC_IMAGE_FALLBACK = "anthropic/claude-opus-4-5";

const imageToolProviderDeps = {
  buildProviderRegistry,
  getMediaUnderstandingProvider,
};

export const __testing = {
  decodeDataUrl,
  coerceImageAssistantText,
  resolveImageToolMaxTokens,
  setProviderDepsForTest(overrides?: {
    buildProviderRegistry?: typeof buildProviderRegistry;
    getMediaUnderstandingProvider?: typeof getMediaUnderstandingProvider;
  }) {
    imageToolProviderDeps.buildProviderRegistry =
      overrides?.buildProviderRegistry ?? buildProviderRegistry;
    imageToolProviderDeps.getMediaUnderstandingProvider =
      overrides?.getMediaUnderstandingProvider ?? getMediaUnderstandingProvider;
  },
} as const;

function resolveImageToolMaxTokens(modelMaxTokens: number | undefined, requestedMaxTokens = 4096) {
  if (
    typeof modelMaxTokens !== "number" ||
    !Number.isFinite(modelMaxTokens) ||
    modelMaxTokens <= 0
  ) {
    return requestedMaxTokens;
  }
  return Math.min(requestedMaxTokens, modelMaxTokens);
}

/**
 * Resolve the effective image model config for the `image` tool.
 *
 * - Prefer explicit config (`agents.defaults.imageModel`).
 * - Otherwise, try to "pair" the primary model with an image-capable model:
 *   - same provider (best effort)
 *   - fall back to OpenAI/Anthropic when available
 */
export function resolveImageModelConfigForTool(params: {
  cfg?: CrawClawConfig;
  agentDir: string;
}): ImageModelConfig | null {
  // Note: We intentionally do NOT gate based on primarySupportsImages here.
  // Even when the primary model supports images, we keep the tool available
  // because images are auto-injected into prompts (see attempt.ts detectAndLoadPromptImages).
  // The tool description is adjusted via modelHasVision to discourage redundant usage.
  const explicit = coerceImageModelConfig(params.cfg);
  if (hasToolModelConfig(explicit)) {
    return explicit;
  }

  const primary = resolveDefaultModelRef(params.cfg);

  const providerVisionFromConfig = resolveProviderVisionModelFromConfig({
    cfg: params.cfg,
    provider: primary.provider,
  });
  const primaryCandidates = (() => {
    if (isMinimaxVlmProvider(primary.provider)) {
      return [`${primary.provider}/MiniMax-VL-01`];
    }
    if (providerVisionFromConfig) {
      return [providerVisionFromConfig];
    }
    if (primary.provider === "zai") {
      return ["zai/glm-4.6v"];
    }
    if (primary.provider === "openai") {
      return ["openai/gpt-5-mini"];
    }
    if (primary.provider === "anthropic") {
      return [ANTHROPIC_IMAGE_PRIMARY];
    }
    return [];
  })();

  return buildToolModelConfigFromCandidates({
    explicit,
    agentDir: params.agentDir,
    candidates: [...primaryCandidates, "openai/gpt-5-mini", ANTHROPIC_IMAGE_FALLBACK],
  });
}

async function runImagePrompt(params: {
  cfg?: CrawClawConfig;
  agentDir: string;
  imageModelConfig: ImageModelConfig;
  modelOverride?: string;
  prompt: string;
  images: Array<{ buffer: Buffer; mimeType: string }>;
}): Promise<{
  text: string;
  provider: string;
  model: string;
  attempts: Array<{ provider: string; model: string; error: string }>;
}> {
  const effectiveCfg = applyImageModelConfigDefaults(params.cfg, params.imageModelConfig);
  const providerCfg: CrawClawConfig = effectiveCfg ?? {};
  const providerRegistry = imageToolProviderDeps.buildProviderRegistry(undefined, providerCfg);

  const result = await runWithImageModelFallback({
    cfg: effectiveCfg,
    modelOverride: params.modelOverride,
    run: async (provider, modelId) => {
      const imageProvider = imageToolProviderDeps.getMediaUnderstandingProvider(
        provider,
        providerRegistry as Map<string, MediaUnderstandingProvider>,
      );
      if (
        params.images.length > 1 &&
        (imageProvider?.describeImages || !imageProvider?.describeImage)
      ) {
        const describeImages = imageProvider?.describeImages ?? describeImagesWithModel;
        const described = await describeImages({
          images: params.images.map((image, index) => ({
            buffer: image.buffer,
            fileName: `image-${index + 1}`,
            mime: image.mimeType,
          })),
          provider,
          model: modelId,
          prompt: params.prompt,
          maxTokens: resolveImageToolMaxTokens(undefined),
          timeoutMs: 30_000,
          cfg: providerCfg,
          agentDir: params.agentDir,
        });
        return { text: described.text, provider, model: described.model ?? modelId };
      }
      const describeImage = imageProvider?.describeImage ?? describeImageWithModel;
      if (params.images.length === 1) {
        const image = params.images[0];
        const described = await describeImage({
          buffer: image.buffer,
          fileName: "image-1",
          mime: image.mimeType,
          provider,
          model: modelId,
          prompt: params.prompt,
          maxTokens: resolveImageToolMaxTokens(undefined),
          timeoutMs: 30_000,
          cfg: providerCfg,
          agentDir: params.agentDir,
        });
        return { text: described.text, provider, model: described.model ?? modelId };
      }

      const parts: string[] = [];
      for (const [index, image] of params.images.entries()) {
        const described = await describeImage({
          buffer: image.buffer,
          fileName: `image-${index + 1}`,
          mime: image.mimeType,
          provider,
          model: modelId,
          prompt: `${params.prompt}\n\nDescribe image ${index + 1} of ${params.images.length}.`,
          maxTokens: resolveImageToolMaxTokens(undefined),
          timeoutMs: 30_000,
          cfg: providerCfg,
          agentDir: params.agentDir,
        });
        parts.push(`Image ${index + 1}:\n${described.text.trim()}`);
      }
      return {
        text: parts.join("\n\n").trim(),
        provider,
        model: modelId,
      };
    },
  });

  return {
    text: result.result.text,
    provider: result.result.provider,
    model: result.result.model,
    attempts: result.attempts.map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      error: attempt.error,
    })),
  };
}

export function createImageTool(options?: {
  config?: CrawClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  sandbox?: ImageSandboxConfig;
  fsPolicy?: ToolFsPolicy;
  /** If true, the model has native vision capability and images in the prompt are auto-injected */
  modelHasVision?: boolean;
}): AnyAgentTool | null {
  const agentDir = options?.agentDir?.trim();
  if (!agentDir) {
    const explicit = coerceImageModelConfig(options?.config);
    if (hasToolModelConfig(explicit)) {
      throw new Error("createImageTool requires agentDir when enabled");
    }
    return null;
  }
  const imageModelConfig = resolveImageModelConfigForTool({
    cfg: options?.config,
    agentDir,
  });
  if (!imageModelConfig) {
    return null;
  }

  // If model has native vision, images in the prompt are auto-injected
  // so this tool is only needed when image wasn't provided in the prompt
  const description = options?.modelHasVision
    ? "Analyze one or more images with a vision model. Use image for a single path/URL, or images for multiple (up to 20). Only use this tool when images were NOT already provided in the user's message. Images mentioned in the prompt are automatically visible to you."
    : "Analyze one or more images with the configured image model (agents.defaults.imageModel). Use image for a single path/URL, or images for multiple (up to 20). Provide a prompt describing what to analyze.";

  return {
    label: "Image",
    name: "image",
    description,
    parameters: Type.Object({
      prompt: Type.Optional(Type.String()),
      image: Type.Optional(Type.String({ description: "Single image path or URL." })),
      images: Type.Optional(
        Type.Array(Type.String(), {
          description: "Multiple image paths or URLs (up to maxImages, default 20).",
        }),
      ),
      model: Type.Optional(Type.String()),
      maxBytesMb: Type.Optional(Type.Number()),
      maxImages: Type.Optional(Type.Number()),
    }),
    execute: async (_toolCallId, args) => {
      const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
      const normalized = normalizeImageToolInput(record);
      if (!normalized.ok) {
        return normalized.result;
      }

      const maxBytes = pickMaxBytes(options?.config, normalized.maxBytesMb);
      const loadResult = await loadImageToolInputs({
        imageInputs: normalized.imageInputs,
        workspaceDir: options?.workspaceDir,
        maxBytes,
        sandbox: options?.sandbox,
        fsPolicy: options?.fsPolicy,
      });
      if (!loadResult.ok) {
        return loadResult.result;
      }
      const loadedImages = loadResult.loadedImages;

      // MARK: - Run image prompt with all loaded images
      const result = await runImagePrompt({
        cfg: options?.config,
        agentDir,
        imageModelConfig,
        modelOverride: normalized.modelOverride,
        prompt: normalized.promptRaw,
        images: loadedImages.map((img) => ({ buffer: img.buffer, mimeType: img.mimeType })),
      });
      return buildTextToolResult(result, buildImageToolResultDetails(loadedImages));
    },
  };
}

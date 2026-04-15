import { type Context, complete } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { extractPdfContent, type PdfExtractedContent } from "../../media/pdf-extract.js";
import {
  coerceImageModelConfig,
  type ImageModelConfig,
  resolveProviderVisionModelFromConfig,
} from "./image-tool.helpers.js";
import {
  applyImageModelConfigDefaults,
  buildTextToolResult,
  resolveModelFromRegistry,
  resolveModelRuntimeApiKey,
} from "./media-tool-shared.js";
import { hasAuthForProvider, resolveDefaultModelRef } from "./model-config.helpers.js";
import { anthropicAnalyzePdf, geminiAnalyzePdf } from "./pdf-native-providers.js";
import {
  coercePdfAssistantText,
  coercePdfModelConfig,
  parsePageRange,
  providerSupportsNativePdf,
  resolvePdfToolMaxTokens,
} from "./pdf-tool.helpers.js";
import {
  discoverAuthStorage,
  discoverModels,
  ensureCrawClawModelsJson,
  runWithImageModelFallback,
  type AnyAgentTool,
  type ToolFsPolicy,
} from "./tool-runtime.helpers.js";
import {
  buildPdfToolResultDetails,
  loadPdfToolDocuments,
  normalizePdfToolInput,
  type PdfSandboxConfig,
} from "./pdf-tool-runtime.js";

const DEFAULT_MAX_BYTES_MB = 10;
const DEFAULT_MAX_PAGES = 20;
const ANTHROPIC_PDF_PRIMARY = "anthropic/claude-opus-4-6";
const ANTHROPIC_PDF_FALLBACK = "anthropic/claude-opus-4-5";

const PDF_MIN_TEXT_CHARS = 200;
const PDF_MAX_PIXELS = 4_000_000;

// ---------------------------------------------------------------------------
// Model resolution (mirrors image tool pattern)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective PDF model config.
 * Falls back to the image model config, then to provider-specific defaults.
 */
export function resolvePdfModelConfigForTool(params: {
  cfg?: CrawClawConfig;
  agentDir: string;
}): ImageModelConfig | null {
  // Check for explicit PDF model config first
  const explicitPdf = coercePdfModelConfig(params.cfg);
  if (explicitPdf.primary?.trim() || (explicitPdf.fallbacks?.length ?? 0) > 0) {
    return explicitPdf;
  }

  // Fall back to the image model config
  const explicitImage = coerceImageModelConfig(params.cfg);
  if (explicitImage.primary?.trim() || (explicitImage.fallbacks?.length ?? 0) > 0) {
    return explicitImage;
  }

  // Auto-detect from available providers
  const primary = resolveDefaultModelRef(params.cfg);
  const anthropicOk = hasAuthForProvider({ provider: "anthropic", agentDir: params.agentDir });
  const googleOk = hasAuthForProvider({ provider: "google", agentDir: params.agentDir });
  const openaiOk = hasAuthForProvider({ provider: "openai", agentDir: params.agentDir });

  const fallbacks: string[] = [];
  const addFallback = (ref: string) => {
    const trimmed = ref.trim();
    if (trimmed && !fallbacks.includes(trimmed)) {
      fallbacks.push(trimmed);
    }
  };

  // Prefer providers with native PDF support
  let preferred: string | null = null;

  const providerOk = hasAuthForProvider({ provider: primary.provider, agentDir: params.agentDir });
  const providerVision = resolveProviderVisionModelFromConfig({
    cfg: params.cfg,
    provider: primary.provider,
  });

  if (primary.provider === "anthropic" && anthropicOk) {
    preferred = ANTHROPIC_PDF_PRIMARY;
  } else if (primary.provider === "google" && googleOk && providerVision) {
    preferred = providerVision;
  } else if (providerOk && providerVision) {
    preferred = providerVision;
  } else if (anthropicOk) {
    preferred = ANTHROPIC_PDF_PRIMARY;
  } else if (googleOk) {
    preferred = "google/gemini-2.5-pro";
  } else if (openaiOk) {
    preferred = "openai/gpt-5-mini";
  }

  if (preferred?.trim()) {
    if (anthropicOk && preferred !== ANTHROPIC_PDF_PRIMARY) {
      addFallback(ANTHROPIC_PDF_PRIMARY);
    }
    if (anthropicOk) {
      addFallback(ANTHROPIC_PDF_FALLBACK);
    }
    if (openaiOk) {
      addFallback("openai/gpt-5-mini");
    }
    const pruned = fallbacks.filter((ref) => ref !== preferred);
    return { primary: preferred, ...(pruned.length > 0 ? { fallbacks: pruned } : {}) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Build context for extraction fallback path
// ---------------------------------------------------------------------------

function buildPdfExtractionContext(prompt: string, extractions: PdfExtractedContent[]): Context {
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [];

  // Add extracted text and images
  for (let i = 0; i < extractions.length; i++) {
    const extraction = extractions[i];
    if (extraction.text.trim()) {
      const label = extractions.length > 1 ? `[PDF ${i + 1} text]\n` : "[PDF text]\n";
      content.push({ type: "text", text: label + extraction.text });
    }
    for (const img of extraction.images) {
      content.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }

  // Add the user prompt
  content.push({ type: "text", text: prompt });

  return {
    messages: [{ role: "user", content, timestamp: Date.now() }],
  };
}

// ---------------------------------------------------------------------------
// Run PDF prompt with model fallback
// ---------------------------------------------------------------------------

async function runPdfPrompt(params: {
  cfg?: CrawClawConfig;
  agentDir: string;
  pdfModelConfig: ImageModelConfig;
  modelOverride?: string;
  prompt: string;
  pdfBuffers: Array<{ base64: string; filename: string }>;
  pageNumbers?: number[];
  getExtractions: () => Promise<PdfExtractedContent[]>;
}): Promise<{
  text: string;
  provider: string;
  model: string;
  native: boolean;
  attempts: Array<{ provider: string; model: string; error: string }>;
}> {
  const effectiveCfg = applyImageModelConfigDefaults(params.cfg, params.pdfModelConfig);

  await ensureCrawClawModelsJson(effectiveCfg, params.agentDir);
  const authStorage = discoverAuthStorage(params.agentDir);
  const modelRegistry = discoverModels(authStorage, params.agentDir);

  let extractionCache: PdfExtractedContent[] | null = null;
  const getExtractions = async (): Promise<PdfExtractedContent[]> => {
    if (!extractionCache) {
      extractionCache = await params.getExtractions();
    }
    return extractionCache;
  };

  const result = await runWithImageModelFallback({
    cfg: effectiveCfg,
    modelOverride: params.modelOverride,
    run: async (provider, modelId) => {
      const model = resolveModelFromRegistry({ modelRegistry, provider, modelId });
      const apiKey = await resolveModelRuntimeApiKey({
        model,
        cfg: effectiveCfg,
        agentDir: params.agentDir,
        authStorage,
      });

      if (providerSupportsNativePdf(provider)) {
        if (params.pageNumbers && params.pageNumbers.length > 0) {
          throw new Error(
            `pages is not supported with native PDF providers (${provider}/${modelId}). Remove pages, or use a non-native model for page filtering.`,
          );
        }

        const pdfs = params.pdfBuffers.map((p) => ({
          base64: p.base64,
          filename: p.filename,
        }));

        if (provider === "anthropic") {
          const text = await anthropicAnalyzePdf({
            apiKey,
            modelId,
            prompt: params.prompt,
            pdfs,
            maxTokens: resolvePdfToolMaxTokens(model.maxTokens),
            baseUrl: model.baseUrl,
          });
          return { text, provider, model: modelId, native: true };
        }

        if (provider === "google") {
          const text = await geminiAnalyzePdf({
            apiKey,
            modelId,
            prompt: params.prompt,
            pdfs,
            baseUrl: model.baseUrl,
          });
          return { text, provider, model: modelId, native: true };
        }
      }

      const extractions = await getExtractions();
      const hasImages = extractions.some((e) => e.images.length > 0);
      if (hasImages && !model.input?.includes("image")) {
        const hasText = extractions.some((e) => e.text.trim().length > 0);
        if (!hasText) {
          throw new Error(
            `Model ${provider}/${modelId} does not support images and PDF has no extractable text.`,
          );
        }
        const textOnlyExtractions: PdfExtractedContent[] = extractions.map((e) => ({
          text: e.text,
          images: [],
        }));
        const context = buildPdfExtractionContext(params.prompt, textOnlyExtractions);
        const message = await complete(model, context, {
          apiKey,
          maxTokens: resolvePdfToolMaxTokens(model.maxTokens),
        });
        const text = coercePdfAssistantText({ message, provider, model: modelId });
        return { text, provider, model: modelId, native: false };
      }

      const context = buildPdfExtractionContext(params.prompt, extractions);
      const message = await complete(model, context, {
        apiKey,
        maxTokens: resolvePdfToolMaxTokens(model.maxTokens),
      });
      const text = coercePdfAssistantText({ message, provider, model: modelId });
      return { text, provider, model: modelId, native: false };
    },
  });

  return {
    text: result.result.text,
    provider: result.result.provider,
    model: result.result.model,
    native: result.result.native,
    attempts: result.attempts.map((a) => ({
      provider: a.provider,
      model: a.model,
      error: a.error,
    })),
  };
}

// ---------------------------------------------------------------------------
// PDF tool factory
// ---------------------------------------------------------------------------

export function createPdfTool(options?: {
  config?: CrawClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  sandbox?: PdfSandboxConfig;
  fsPolicy?: ToolFsPolicy;
}): AnyAgentTool | null {
  const agentDir = options?.agentDir?.trim();
  if (!agentDir) {
    const explicit = coercePdfModelConfig(options?.config);
    if (explicit.primary?.trim() || (explicit.fallbacks?.length ?? 0) > 0) {
      throw new Error("createPdfTool requires agentDir when enabled");
    }
    return null;
  }

  const pdfModelConfig = resolvePdfModelConfigForTool({ cfg: options?.config, agentDir });
  if (!pdfModelConfig) {
    return null;
  }

  const maxBytesMbDefault = (
    options?.config?.agents?.defaults as Record<string, unknown> | undefined
  )?.pdfMaxBytesMb;
  const maxPagesDefault = (options?.config?.agents?.defaults as Record<string, unknown> | undefined)
    ?.pdfMaxPages;
  const configuredMaxBytesMb =
    typeof maxBytesMbDefault === "number" && Number.isFinite(maxBytesMbDefault)
      ? maxBytesMbDefault
      : DEFAULT_MAX_BYTES_MB;
  const configuredMaxPages =
    typeof maxPagesDefault === "number" && Number.isFinite(maxPagesDefault)
      ? Math.floor(maxPagesDefault)
      : DEFAULT_MAX_PAGES;

  const description =
    "Analyze one or more PDF documents with a model. Supports native PDF analysis for Anthropic and Google models, with text/image extraction fallback for other providers. Use pdf for a single path/URL, or pdfs for multiple (up to 10). Provide a prompt describing what to analyze.";

  return {
    label: "PDF",
    name: "pdf",
    description,
    parameters: Type.Object({
      prompt: Type.Optional(Type.String()),
      pdf: Type.Optional(Type.String({ description: "Single PDF path or URL." })),
      pdfs: Type.Optional(
        Type.Array(Type.String(), {
          description: "Multiple PDF paths or URLs (up to 10).",
        }),
      ),
      pages: Type.Optional(
        Type.String({
          description: 'Page range to process, e.g. "1-5", "1,3,5-7". Defaults to all pages.',
        }),
      ),
      model: Type.Optional(Type.String()),
      maxBytesMb: Type.Optional(Type.Number()),
    }),
    execute: async (_toolCallId, args) => {
      const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
      const normalized = normalizePdfToolInput({
        args: record,
        configuredMaxBytesMb,
      });
      if (!normalized.ok) {
        return normalized.result;
      }

      const loadResult = await loadPdfToolDocuments({
        pdfInputs: normalized.pdfInputs,
        maxBytes: normalized.maxBytes,
        workspaceDir: options?.workspaceDir,
        sandbox: options?.sandbox,
        fsPolicy: options?.fsPolicy,
      });
      if (!loadResult.ok) {
        return loadResult.result;
      }

      const pageNumbers = normalized.pagesRaw
        ? parsePageRange(normalized.pagesRaw, configuredMaxPages)
        : undefined;
      const loadedPdfs = loadResult.loadedPdfs;

      const getExtractions = async (): Promise<PdfExtractedContent[]> => {
        const extractedAll: PdfExtractedContent[] = [];
        for (const pdf of loadedPdfs) {
          const extracted = await extractPdfContent({
            buffer: pdf.buffer,
            maxPages: configuredMaxPages,
            maxPixels: PDF_MAX_PIXELS,
            minTextChars: PDF_MIN_TEXT_CHARS,
            pageNumbers,
          });
          extractedAll.push(extracted);
        }
        return extractedAll;
      };

      const result = await runPdfPrompt({
        cfg: options?.config,
        agentDir,
        pdfModelConfig,
        modelOverride: normalized.modelOverride,
        prompt: normalized.promptRaw,
        pdfBuffers: loadedPdfs.map((p) => ({ base64: p.base64, filename: p.filename })),
        pageNumbers,
        getExtractions,
      });
      return buildTextToolResult(result, {
        native: result.native,
        ...buildPdfToolResultDetails(loadedPdfs),
      });
    },
  };
}

import path from "node:path";
import { appendFileWithinRoot } from "../infra/fs-safe.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";
import type { AgentToolResult } from "./agent-types.js";
import type { ImageSanitizationLimits } from "./image-sanitization.js";
import { toRelativeWorkspacePath } from "./path-policy.js";
import {
  CLAUDE_PARAM_GROUPS,
  assertRequiredParams,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
} from "./pi-tools.params.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { sanitizeToolResultImages } from "./tool-images.js";

export {
  CLAUDE_PARAM_GROUPS,
  assertRequiredParams,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
} from "./pi-tools.params.js";

// NOTE(steipete): Upstream read now does file-magic MIME detection; we keep the wrapper
// to normalize payloads and sanitize oversized images before they hit providers.
type ToolContentBlock = AgentToolResult["content"][number];
type ImageContentBlock = Extract<ToolContentBlock, { type: "image" }>;
type TextContentBlock = Extract<ToolContentBlock, { type: "text" }>;

const DEFAULT_READ_PAGE_MAX_BYTES = 50 * 1024;
const MAX_ADAPTIVE_READ_MAX_BYTES = 512 * 1024;
const ADAPTIVE_READ_CONTEXT_SHARE = 0.2;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_ADAPTIVE_READ_PAGES = 8;

type CrawClawReadToolOptions = {
  modelContextWindowTokens?: number;
  imageSanitization?: ImageSanitizationLimits;
};

type ReadTruncationDetails = {
  truncated: boolean;
  outputLines: number;
  firstLineExceedsLimit: boolean;
};

const READ_CONTINUATION_NOTICE_RE =
  /\n\n\[(?:Showing lines [^\]]*?Use offset=\d+ to continue\.|\d+ more lines in file\. Use offset=\d+ to continue\.)\]\s*$/;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveAdaptiveReadMaxBytes(options?: CrawClawReadToolOptions): number {
  const contextWindowTokens = options?.modelContextWindowTokens;
  if (
    typeof contextWindowTokens !== "number" ||
    !Number.isFinite(contextWindowTokens) ||
    contextWindowTokens <= 0
  ) {
    return DEFAULT_READ_PAGE_MAX_BYTES;
  }
  const fromContext = Math.floor(
    contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * ADAPTIVE_READ_CONTEXT_SHARE,
  );
  return clamp(fromContext, DEFAULT_READ_PAGE_MAX_BYTES, MAX_ADAPTIVE_READ_MAX_BYTES);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

function getToolResultText(result: AgentToolResult): string | undefined {
  const content = Array.isArray(result.content) ? result.content : [];
  const textBlocks = content
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text;
      }
      return undefined;
    })
    .filter((value): value is string => typeof value === "string");
  if (textBlocks.length === 0) {
    return undefined;
  }
  return textBlocks.join("\n");
}

function withToolResultText(result: AgentToolResult, text: string): AgentToolResult {
  const content = Array.isArray(result.content) ? result.content : [];
  let replaced = false;
  const nextContent: ToolContentBlock[] = content.map((block) => {
    if (
      !replaced &&
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text"
    ) {
      replaced = true;
      return {
        ...(block as TextContentBlock),
        text,
      };
    }
    return block;
  });
  if (replaced) {
    return {
      ...result,
      content: nextContent as unknown as AgentToolResult["content"],
    };
  }
  const textBlock = { type: "text", text } as unknown as TextContentBlock;
  return {
    ...result,
    content: [textBlock] as unknown as AgentToolResult["content"],
  };
}

function extractReadTruncationDetails(result: AgentToolResult): ReadTruncationDetails | null {
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") {
    return null;
  }
  const truncation = (details as { truncation?: unknown }).truncation;
  if (!truncation || typeof truncation !== "object") {
    return null;
  }
  const record = truncation as Record<string, unknown>;
  if (record.truncated !== true) {
    return null;
  }
  const outputLinesRaw = record.outputLines;
  const outputLines =
    typeof outputLinesRaw === "number" && Number.isFinite(outputLinesRaw)
      ? Math.max(0, Math.floor(outputLinesRaw))
      : 0;
  return {
    truncated: true,
    outputLines,
    firstLineExceedsLimit: record.firstLineExceedsLimit === true,
  };
}

function stripReadContinuationNotice(text: string): string {
  return text.replace(READ_CONTINUATION_NOTICE_RE, "");
}

function stripReadTruncationContentDetails(result: AgentToolResult): AgentToolResult {
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") {
    return result;
  }

  const detailsRecord = details as Record<string, unknown>;
  const truncationRaw = detailsRecord.truncation;
  if (!truncationRaw || typeof truncationRaw !== "object") {
    return result;
  }

  const truncation = truncationRaw as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(truncation, "content")) {
    return result;
  }

  const { content: _content, ...restTruncation } = truncation;
  return {
    ...result,
    details: {
      ...detailsRecord,
      truncation: restTruncation,
    },
  };
}

async function executeReadWithAdaptivePaging(params: {
  base: AnyAgentTool;
  toolCallId: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  maxBytes: number;
}): Promise<AgentToolResult> {
  const userLimit = params.args.limit;
  const hasExplicitLimit =
    typeof userLimit === "number" && Number.isFinite(userLimit) && userLimit > 0;
  if (hasExplicitLimit) {
    return await params.base.execute(params.toolCallId, params.args, params.signal);
  }

  const offsetRaw = params.args.offset;
  let nextOffset =
    typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw > 0
      ? Math.floor(offsetRaw)
      : 1;
  let firstResult: AgentToolResult | null = null;
  let aggregatedText = "";
  let aggregatedBytes = 0;
  let capped = false;
  let continuationOffset: number | undefined;

  for (let page = 0; page < MAX_ADAPTIVE_READ_PAGES; page += 1) {
    const pageArgs = { ...params.args, offset: nextOffset };
    const pageResult = await params.base.execute(params.toolCallId, pageArgs, params.signal);
    firstResult ??= pageResult;

    const rawText = getToolResultText(pageResult);
    if (typeof rawText !== "string") {
      return pageResult;
    }

    const truncation = extractReadTruncationDetails(pageResult);
    const canContinue =
      Boolean(truncation?.truncated) &&
      !truncation?.firstLineExceedsLimit &&
      (truncation?.outputLines ?? 0) > 0 &&
      page < MAX_ADAPTIVE_READ_PAGES - 1;
    const pageText = canContinue ? stripReadContinuationNotice(rawText) : rawText;
    const delimiter = aggregatedText ? "\n\n" : "";
    const nextBytes = Buffer.byteLength(`${delimiter}${pageText}`, "utf-8");

    if (aggregatedText && aggregatedBytes + nextBytes > params.maxBytes) {
      capped = true;
      continuationOffset = nextOffset;
      break;
    }

    aggregatedText += `${delimiter}${pageText}`;
    aggregatedBytes += nextBytes;

    if (!canContinue || !truncation) {
      return withToolResultText(pageResult, aggregatedText);
    }

    nextOffset += truncation.outputLines;
    continuationOffset = nextOffset;

    if (aggregatedBytes >= params.maxBytes) {
      capped = true;
      break;
    }
  }

  if (!firstResult) {
    return await params.base.execute(params.toolCallId, params.args, params.signal);
  }

  let finalText = aggregatedText;
  if (capped && continuationOffset) {
    finalText += `\n\n[Read output capped at ${formatBytes(params.maxBytes)} for this call. Use offset=${continuationOffset} to continue.]`;
  }
  return withToolResultText(firstResult, finalText);
}

function rewriteReadImageHeader(text: string, mimeType: string): string {
  // pi-coding-agent uses: "Read image file [image/png]"
  if (text.startsWith("Read image file [") && text.endsWith("]")) {
    return `Read image file [${mimeType}]`;
  }
  return text;
}

async function normalizeReadImageResult(
  result: AgentToolResult,
  filePath: string,
): Promise<AgentToolResult> {
  const content = Array.isArray(result.content) ? result.content : [];

  const image = content.find(
    (b): b is ImageContentBlock =>
      !!b &&
      typeof b === "object" &&
      (b as { type?: unknown }).type === "image" &&
      typeof (b as { data?: unknown }).data === "string" &&
      typeof (b as { mimeType?: unknown }).mimeType === "string",
  );
  if (!image) {
    return result;
  }

  if (!image.data.trim()) {
    throw new Error(`read: image payload is empty (${filePath})`);
  }

  const sniffed = await sniffMimeFromBase64(image.data);
  if (!sniffed) {
    return result;
  }

  if (!sniffed.startsWith("image/")) {
    throw new Error(
      `read: file looks like ${sniffed} but was treated as ${image.mimeType} (${filePath})`,
    );
  }

  if (sniffed === image.mimeType) {
    return result;
  }

  const nextContent = content.map((block) => {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "image") {
      const b = block as ImageContentBlock & { mimeType: string };
      return { ...b, mimeType: sniffed } satisfies ImageContentBlock;
    }
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const b = block as TextContentBlock & { text: string };
      return {
        ...b,
        text: rewriteReadImageHeader(b.text, sniffed),
      } satisfies TextContentBlock;
    }
    return block;
  });

  return { ...result, content: nextContent };
}

export function wrapToolWorkspaceRootGuard(tool: AnyAgentTool, root: string): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const normalized = normalizeToolParams(args);
      const record =
        normalized ??
        (args && typeof args === "object" ? (args as Record<string, unknown>) : undefined);
      const filePath = record?.path;
      if (typeof filePath === "string" && filePath.trim()) {
        toRelativeWorkspacePath(root, filePath, { allowRoot: true });
      }
      return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
    },
  };
}

export function resolveToolPathAgainstWorkspaceRoot(params: {
  filePath: string;
  root: string;
}): string {
  const candidate = params.filePath.startsWith("@") ? params.filePath.slice(1) : params.filePath;
  return path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(params.root, candidate || ".");
}

type MemoryFlushAppendOnlyWriteOptions = {
  root: string;
  relativePath: string;
};

async function appendMemoryFlushContent(params: {
  root: string;
  relativePath: string;
  content: string;
}) {
  await appendFileWithinRoot({
    rootDir: params.root,
    relativePath: params.relativePath,
    data: params.content,
    mkdir: true,
    prependNewlineIfNeeded: true,
  });
}

export function wrapToolMemoryFlushAppendOnlyWrite(
  tool: AnyAgentTool,
  options: MemoryFlushAppendOnlyWriteOptions,
): AnyAgentTool {
  const allowedAbsolutePath = path.resolve(options.root, options.relativePath);
  return {
    ...tool,
    description: `${tool.description} During memory flush, this tool may only append to ${options.relativePath}.`,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const normalized = normalizeToolParams(args);
      const record =
        normalized ??
        (args && typeof args === "object" ? (args as Record<string, unknown>) : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.write, tool.name);
      const filePath =
        typeof record?.path === "string" && record.path.trim() ? record.path : undefined;
      const content = typeof record?.content === "string" ? record.content : undefined;
      if (!filePath || content === undefined) {
        return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
      }

      const resolvedPath = resolveToolPathAgainstWorkspaceRoot({
        filePath,
        root: options.root,
      });
      if (resolvedPath !== allowedAbsolutePath) {
        throw new Error(
          `Memory flush writes are restricted to ${options.relativePath}; use that path only.`,
        );
      }

      await appendMemoryFlushContent({
        root: options.root,
        relativePath: options.relativePath,
        content,
      });
      return {
        content: [{ type: "text", text: `Appended content to ${options.relativePath}.` }],
        details: {
          path: options.relativePath,
          appendOnly: true,
        },
      };
    },
  };
}

export function createCrawClawReadTool(
  base: AnyAgentTool,
  options?: CrawClawReadToolOptions,
): AnyAgentTool {
  const patched = patchToolSchemaForClaudeCompatibility(base);
  return {
    ...patched,
    execute: async (toolCallId, params, signal) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.read, base.name);
      const result = await executeReadWithAdaptivePaging({
        base,
        toolCallId,
        args: (normalized ?? params ?? {}) as Record<string, unknown>,
        signal,
        maxBytes: resolveAdaptiveReadMaxBytes(options),
      });
      const filePath = typeof record?.path === "string" ? record.path : "<unknown>";
      const strippedDetailsResult = stripReadTruncationContentDetails(result);
      const normalizedResult = await normalizeReadImageResult(strippedDetailsResult, filePath);
      return sanitizeToolResultImages(
        normalizedResult,
        `read:${filePath}`,
        options?.imageSanitization,
      );
    },
  };
}

import {
  htmlToMarkdown,
  markdownToText,
  truncateText,
  type ExtractMode,
} from "./web-fetch-utils.js";

export const WEB_FETCH_DETAIL_LEVELS = ["brief", "standard", "full"] as const;
export const WEB_FETCH_OUTPUT_MODES = ["markdown", "text", "html", "structured"] as const;
export const WEB_FETCH_RENDER_MODES = ["auto", "never", "stealth", "dynamic"] as const;
export const WEB_FETCH_EXTRACT_VARIANTS = ["readable", "raw", "links", "metadata"] as const;
export const WEB_FETCH_WAIT_UNTIL_MODES = ["domcontentloaded", "load", "networkidle"] as const;

export type WebFetchDetailLevel = (typeof WEB_FETCH_DETAIL_LEVELS)[number];
export type WebFetchOutputMode = (typeof WEB_FETCH_OUTPUT_MODES)[number];
export type WebFetchRenderMode = (typeof WEB_FETCH_RENDER_MODES)[number];
export type WebFetchExtractVariant = (typeof WEB_FETCH_EXTRACT_VARIANTS)[number];
export type WebFetchWaitUntilMode = (typeof WEB_FETCH_WAIT_UNTIL_MODES)[number];

type WebFetchContentShapeParams = {
  detail: WebFetchDetailLevel;
  output: WebFetchOutputMode;
  extractMode: ExtractMode;
  maxChars: number;
  content: string;
  plainText: string;
};

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function splitParagraphs(value: string): string[] {
  return normalizeWhitespace(value)
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitSentences(value: string): string[] {
  return normalizeWhitespace(value)
    .split(/(?<=[.!?。！？])\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) {
      break;
    }
  }
  return result;
}

function deriveSummary(value: string): string | undefined {
  const paragraphs = splitParagraphs(value);
  if (paragraphs.length === 0) {
    return undefined;
  }
  const sentences = splitSentences(paragraphs.join(" "));
  const summary =
    sentences.length >= 2 ? sentences.slice(0, 2).join(" ") : paragraphs.slice(0, 1).join(" ");
  return truncateText(summary, 420).text || undefined;
}

function deriveKeyPoints(value: string): string[] {
  const candidates = [
    ...splitParagraphs(value),
    ...splitSentences(value).filter((entry) => entry.length >= 40),
  ];
  return uniqueStrings(candidates.map((entry) => truncateText(entry, 220).text).filter(Boolean), 3);
}

function deriveMarkdownHeadings(content: string): string[] {
  return uniqueStrings(
    content
      .split("\n")
      .map((line) => line.match(/^#{1,6}\s+(.*)$/u)?.[1]?.trim() ?? "")
      .filter(Boolean)
      .map((entry) => truncateText(entry, 120).text),
    6,
  );
}

function deriveHtmlHeadings(content: string): string[] {
  return uniqueStrings(
    Array.from(content.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/giu))
      .map((match) => match[1]?.replace(/<[^>]+>/g, " ").trim() ?? "")
      .filter(Boolean)
      .map((entry) => truncateText(entry, 120).text),
    6,
  );
}

function deriveHeadings(params: {
  content: string;
  plainText: string;
  output: WebFetchOutputMode;
  title?: string;
}): string[] {
  const preferred =
    params.output === "markdown"
      ? deriveMarkdownHeadings(params.content)
      : params.output === "html"
        ? deriveHtmlHeadings(params.content)
        : [];
  if (preferred.length > 0) {
    return preferred;
  }
  const fallbacks = [
    ...(params.title ? [params.title] : []),
    ...splitParagraphs(params.plainText)
      .slice(0, 2)
      .map((entry) => truncateText(entry, 120).text),
  ];
  return uniqueStrings(fallbacks, 4);
}

function resolvePreviewBudget(params: { detail: WebFetchDetailLevel; maxChars: number }): number {
  const cap = Math.max(100, params.maxChars);
  if (params.detail === "brief") {
    return Math.min(cap, 1_800);
  }
  if (params.detail === "standard") {
    return Math.min(cap, 3_200);
  }
  return Math.min(cap, 5_000);
}

function resolveContentBudget(params: { detail: WebFetchDetailLevel; maxChars: number }): number {
  const cap = Math.max(100, params.maxChars);
  if (params.detail === "brief") {
    return Math.min(cap, 1_800);
  }
  if (params.detail === "standard") {
    return Math.min(cap, 12_000);
  }
  return cap;
}

export function estimateTokenCount(value: string): number {
  if (!value) {
    return 0;
  }
  return Math.max(1, Math.ceil(value.length / 4));
}

export function normalizeRequestedOutput(params: {
  output: unknown;
  extractMode: unknown;
}): WebFetchOutputMode {
  if (typeof params.output === "string") {
    const normalized = params.output.trim().toLowerCase();
    if ((WEB_FETCH_OUTPUT_MODES as readonly string[]).includes(normalized)) {
      return normalized as WebFetchOutputMode;
    }
  }
  return params.extractMode === "text" ? "text" : "markdown";
}

export function normalizeRequestedDetail(value: unknown): WebFetchDetailLevel {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if ((WEB_FETCH_DETAIL_LEVELS as readonly string[]).includes(normalized)) {
      return normalized as WebFetchDetailLevel;
    }
  }
  return "brief";
}

export function normalizeRequestedRender(value: unknown): WebFetchRenderMode {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if ((WEB_FETCH_RENDER_MODES as readonly string[]).includes(normalized)) {
      return normalized as WebFetchRenderMode;
    }
  }
  return "auto";
}

export function normalizeRequestedExtractVariant(value: unknown): WebFetchExtractVariant {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if ((WEB_FETCH_EXTRACT_VARIANTS as readonly string[]).includes(normalized)) {
      return normalized as WebFetchExtractVariant;
    }
  }
  return "readable";
}

export function normalizeRequestedWaitUntil(value: unknown): WebFetchWaitUntilMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if ((WEB_FETCH_WAIT_UNTIL_MODES as readonly string[]).includes(normalized)) {
    return normalized as WebFetchWaitUntilMode;
  }
  return undefined;
}

export function resolveInternalExtractMode(output: WebFetchOutputMode): ExtractMode {
  return output === "text" || output === "structured" ? "text" : "markdown";
}

export function resolvePlainTextContent(params: {
  content: string;
  output: WebFetchOutputMode;
  extractMode: ExtractMode;
}): string {
  if (!params.content) {
    return "";
  }
  if (params.output === "text" || params.output === "structured" || params.extractMode === "text") {
    return normalizeWhitespace(params.content);
  }
  if (params.output === "markdown") {
    return normalizeWhitespace(markdownToText(params.content));
  }
  return normalizeWhitespace(markdownToText(htmlToMarkdown(params.content).text));
}

export function buildWebFetchContentShape(params: WebFetchContentShapeParams): {
  summary?: string;
  keyPoints: string[];
  headings: string[];
  contentPreview?: string;
  primaryText: string;
  content?: string;
  contentOmitted: boolean;
  truncated: boolean;
  rawLength: number;
  wrappedLength: number;
  estimatedTokens: number;
} {
  const plainText = normalizeWhitespace(params.plainText);
  const summary = deriveSummary(plainText);
  const keyPoints = deriveKeyPoints(plainText);
  const headings = deriveHeadings({
    content: params.content,
    plainText,
    output: params.output,
  });

  const previewSource = plainText || params.content;
  const preview = truncateText(previewSource, resolvePreviewBudget(params)).text;
  const includeContent = params.detail !== "brief";
  const primarySource = includeContent ? params.content : preview;
  const primary = truncateText(primarySource, resolveContentBudget(params));

  const estimatedTokens = estimateTokenCount(
    [summary ?? "", ...keyPoints, ...headings, preview, includeContent ? primary.text : ""].join(
      "\n",
    ),
  );

  return {
    ...(summary ? { summary } : {}),
    keyPoints,
    headings,
    ...(preview ? { contentPreview: preview } : {}),
    primaryText: primary.text,
    ...(includeContent ? { content: primary.text } : {}),
    contentOmitted: !includeContent || primary.truncated,
    truncated: primary.truncated,
    rawLength: primary.text.length,
    wrappedLength: primary.text.length,
    estimatedTokens,
  };
}

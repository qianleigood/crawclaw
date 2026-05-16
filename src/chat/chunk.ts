import { findFenceSpanAt, isSafeFenceBreak, parseFenceSpans } from "../markdown/fences.js";
import { chunkTextByBreakResolver } from "../shared/text-chunking.js";

export type TextChunkProvider = string;
export type ChunkMode = "length" | "newline";

const DEFAULT_CHUNK_LIMIT = 4000;
const DEFAULT_CHUNK_MODE: ChunkMode = "length";

export function resolveTextChunkLimit(
  _cfg: unknown,
  _provider?: TextChunkProvider,
  _accountId?: string | null,
  opts?: { fallbackLimit?: number },
): number {
  return typeof opts?.fallbackLimit === "number" && opts.fallbackLimit > 0
    ? opts.fallbackLimit
    : DEFAULT_CHUNK_LIMIT;
}

export function resolveChunkMode(
  _cfg: unknown,
  _provider?: TextChunkProvider,
  _accountId?: string | null,
): ChunkMode {
  return DEFAULT_CHUNK_MODE;
}

export function chunkByNewline(
  text: string,
  maxLineLength: number,
  opts?: {
    splitLongLines?: boolean;
    trimLines?: boolean;
    isSafeBreak?: (index: number) => boolean;
  },
): string[] {
  if (!text) {
    return [];
  }
  if (maxLineLength <= 0) {
    return text.trim() ? [text] : [];
  }
  const splitLongLines = opts?.splitLongLines !== false;
  const trimLines = opts?.trimLines !== false;
  const lines = splitByNewline(text, opts?.isSafeBreak);
  const chunks: string[] = [];
  let pendingBlankLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingBlankLines += 1;
      continue;
    }

    const maxPrefix = Math.max(0, maxLineLength - 1);
    const cappedBlankLines = pendingBlankLines > 0 ? Math.min(pendingBlankLines, maxPrefix) : 0;
    const prefix = cappedBlankLines > 0 ? "\n".repeat(cappedBlankLines) : "";
    pendingBlankLines = 0;

    const lineValue = trimLines ? trimmed : line;
    if (!splitLongLines || lineValue.length + prefix.length <= maxLineLength) {
      chunks.push(prefix + lineValue);
      continue;
    }

    const firstLimit = Math.max(1, maxLineLength - prefix.length);
    const first = lineValue.slice(0, firstLimit);
    chunks.push(prefix + first);
    const remaining = lineValue.slice(firstLimit);
    if (remaining) {
      chunks.push(...chunkText(remaining, maxLineLength));
    }
  }

  if (pendingBlankLines > 0 && chunks.length > 0) {
    chunks[chunks.length - 1] += "\n".repeat(pendingBlankLines);
  }

  return chunks;
}

export function chunkByParagraph(
  text: string,
  limit: number,
  opts?: { splitLongParagraphs?: boolean },
): string[] {
  if (!text) {
    return [];
  }
  if (limit <= 0) {
    return [text];
  }
  const splitLongParagraphs = opts?.splitLongParagraphs !== false;
  const normalized = text.replace(/\r\n?/g, "\n");
  const paragraphRe = /\n[\t ]*\n+/;
  if (!paragraphRe.test(normalized)) {
    if (normalized.length <= limit) {
      return [normalized];
    }
    return splitLongParagraphs ? chunkText(normalized, limit) : [normalized];
  }

  const spans = parseFenceSpans(normalized);
  const parts: string[] = [];
  const re = /\n[\t ]*\n+/g;
  let lastIndex = 0;
  for (const match of normalized.matchAll(re)) {
    const idx = match.index ?? 0;
    if (!isSafeFenceBreak(spans, idx)) {
      continue;
    }
    parts.push(normalized.slice(lastIndex, idx));
    lastIndex = idx + match[0].length;
  }
  parts.push(normalized.slice(lastIndex));

  const chunks: string[] = [];
  for (const part of parts) {
    const paragraph = part.replace(/\s+$/g, "");
    if (!paragraph.trim()) {
      continue;
    }
    if (paragraph.length <= limit || !splitLongParagraphs) {
      chunks.push(paragraph);
    } else {
      chunks.push(...chunkText(paragraph, limit));
    }
  }

  return chunks;
}

export function chunkTextWithMode(text: string, limit: number, mode: ChunkMode): string[] {
  return mode === "newline" ? chunkByParagraph(text, limit) : chunkText(text, limit);
}

export function chunkMarkdownTextWithMode(text: string, limit: number, mode: ChunkMode): string[] {
  if (mode === "newline") {
    const paragraphChunks = chunkByParagraph(text, limit, { splitLongParagraphs: false });
    const out: string[] = [];
    for (const chunk of paragraphChunks) {
      const nested = chunkMarkdownText(chunk, limit);
      out.push(...(nested.length || !chunk ? nested : [chunk]));
    }
    return out;
  }
  return chunkMarkdownText(text, limit);
}

function splitByNewline(
  text: string,
  isSafeBreak: (index: number) => boolean = () => true,
): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n" && isSafeBreak(i)) {
      lines.push(text.slice(start, i));
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  return lines;
}

function resolveChunkEarlyReturn(text: string, limit: number): string[] | undefined {
  if (!text) {
    return [];
  }
  if (limit <= 0) {
    return [text];
  }
  if (text.length <= limit) {
    return [text];
  }
  return undefined;
}

export function chunkText(text: string, limit: number): string[] {
  const early = resolveChunkEarlyReturn(text, limit);
  if (early) {
    return early;
  }
  return chunkTextByBreakResolver(text, limit, (window) => {
    const { lastNewline, lastWhitespace } = scanParenAwareBreakpoints(window, 0, window.length);
    return lastNewline > 0 ? lastNewline : lastWhitespace;
  });
}

export function chunkMarkdownText(text: string, limit: number): string[] {
  const early = resolveChunkEarlyReturn(text, limit);
  if (early) {
    return early;
  }

  const chunks: string[] = [];
  const spans = parseFenceSpans(text);
  let start = 0;
  let reopenFence: ReturnType<typeof findFenceSpanAt> | undefined;

  while (start < text.length) {
    const reopenPrefix = reopenFence ? `${reopenFence.openLine}\n` : "";
    const contentLimit = Math.max(1, limit - reopenPrefix.length);
    if (text.length - start <= contentLimit) {
      const finalChunk = `${reopenPrefix}${text.slice(start)}`;
      if (finalChunk.length > 0) {
        chunks.push(finalChunk);
      }
      break;
    }

    const windowEnd = Math.min(text.length, start + contentLimit);
    const softBreak = pickSafeBreakIndex(text, start, windowEnd, spans);
    let breakIdx = softBreak > start ? softBreak : windowEnd;

    const initialFence = isSafeFenceBreak(spans, breakIdx)
      ? undefined
      : findFenceSpanAt(spans, breakIdx);

    let fenceToSplit = initialFence;
    if (initialFence) {
      const closeLine = `${initialFence.indent}${initialFence.marker}`;
      const maxIdxIfNeedNewline = start + (contentLimit - (closeLine.length + 1));

      if (maxIdxIfNeedNewline <= start) {
        fenceToSplit = undefined;
        breakIdx = windowEnd;
      } else {
        const minProgressIdx = Math.min(
          text.length,
          Math.max(start + 1, initialFence.start + initialFence.openLine.length + 2),
        );
        const maxIdxIfAlreadyNewline = start + (contentLimit - closeLine.length);

        let pickedNewline = false;
        let lastNewline = text.lastIndexOf("\n", Math.max(start, maxIdxIfAlreadyNewline - 1));
        while (lastNewline >= start) {
          const candidateBreak = lastNewline + 1;
          if (candidateBreak < minProgressIdx) {
            break;
          }
          const candidateFence = findFenceSpanAt(spans, candidateBreak);
          if (candidateFence && candidateFence.start === initialFence.start) {
            breakIdx = candidateBreak;
            pickedNewline = true;
            break;
          }
          lastNewline = text.lastIndexOf("\n", lastNewline - 1);
        }

        if (!pickedNewline) {
          if (minProgressIdx > maxIdxIfAlreadyNewline) {
            fenceToSplit = undefined;
            breakIdx = windowEnd;
          } else {
            breakIdx = Math.max(minProgressIdx, maxIdxIfNeedNewline);
          }
        }
      }

      const fenceAtBreak = findFenceSpanAt(spans, breakIdx);
      fenceToSplit =
        fenceAtBreak && fenceAtBreak.start === initialFence.start ? fenceAtBreak : undefined;
    }

    const rawContent = text.slice(start, breakIdx);
    if (!rawContent) {
      break;
    }

    let rawChunk = `${reopenPrefix}${rawContent}`;
    const brokeOnSeparator = breakIdx < text.length && /\s/.test(text[breakIdx]);
    let nextStart = Math.min(text.length, breakIdx + (brokeOnSeparator ? 1 : 0));

    if (fenceToSplit) {
      const closeLine = `${fenceToSplit.indent}${fenceToSplit.marker}`;
      rawChunk = rawChunk.endsWith("\n") ? `${rawChunk}${closeLine}` : `${rawChunk}\n${closeLine}`;
      reopenFence = fenceToSplit;
    } else {
      nextStart = skipLeadingNewlines(text, nextStart);
      reopenFence = undefined;
    }

    chunks.push(rawChunk);
    start = nextStart;
  }
  return chunks;
}

function skipLeadingNewlines(value: string, start = 0): number {
  let i = start;
  while (i < value.length && value[i] === "\n") {
    i++;
  }
  return i;
}

function pickSafeBreakIndex(
  text: string,
  start: number,
  end: number,
  spans: ReturnType<typeof parseFenceSpans>,
): number {
  const { lastNewline, lastWhitespace } = scanParenAwareBreakpoints(text, start, end, (index) =>
    isSafeFenceBreak(spans, index),
  );

  if (lastNewline > start) {
    return lastNewline;
  }
  if (lastWhitespace > start) {
    return lastWhitespace;
  }
  return -1;
}

function scanParenAwareBreakpoints(
  text: string,
  start: number,
  end: number,
  isAllowed: (index: number) => boolean = () => true,
): { lastNewline: number; lastWhitespace: number } {
  let lastNewline = -1;
  let lastWhitespace = -1;
  let depth = 0;

  for (let i = start; i < end; i++) {
    if (!isAllowed(i)) {
      continue;
    }
    const char = text[i];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    if (char === "\n") {
      lastNewline = i;
    } else if (/\s/.test(char)) {
      lastWhitespace = i;
    }
  }

  return { lastNewline, lastWhitespace };
}

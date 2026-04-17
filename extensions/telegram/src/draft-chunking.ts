import { type CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
import { resolveTextChunkLimit } from "crawclaw/plugin-sdk/reply-chunking";
import { TELEGRAM_TEXT_CHUNK_LIMIT } from "./outbound-adapter.js";

const DEFAULT_TELEGRAM_DRAFT_STREAM_MIN = 200;
const DEFAULT_TELEGRAM_DRAFT_STREAM_MAX = 800;

export function resolveTelegramDraftStreamingChunking(
  cfg: CrawClawConfig | undefined,
  accountId?: string | null,
): {
  minChars: number;
  maxChars: number;
  breakPreference: "paragraph" | "newline" | "sentence";
} {
  const textLimit = resolveTextChunkLimit(cfg, "telegram", accountId, {
    fallbackLimit: TELEGRAM_TEXT_CHUNK_LIMIT,
  });
  const maxRequested = Math.max(1, DEFAULT_TELEGRAM_DRAFT_STREAM_MAX);
  const maxChars = Math.max(1, Math.min(maxRequested, textLimit));
  const minRequested = Math.max(1, DEFAULT_TELEGRAM_DRAFT_STREAM_MIN);
  const minChars = Math.min(minRequested, maxChars);
  const breakPreference = "paragraph";
  return { minChars, maxChars, breakPreference };
}

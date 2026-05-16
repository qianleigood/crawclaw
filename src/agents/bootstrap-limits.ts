import type { CrawClawConfig } from "../config/config.js";

export const DEFAULT_BOOTSTRAP_MAX_CHARS = 20_000;
export const DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000;
export const DEFAULT_BOOTSTRAP_PROMPT_TRUNCATION_WARNING_MODE = "once";

export function resolveBootstrapMaxChars(cfg?: CrawClawConfig): number {
  const raw = cfg?.agents?.defaults?.bootstrapMaxChars;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_BOOTSTRAP_MAX_CHARS;
}

export function resolveBootstrapTotalMaxChars(cfg?: CrawClawConfig): number {
  const raw = cfg?.agents?.defaults?.bootstrapTotalMaxChars;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS;
}

export function resolveBootstrapPromptTruncationWarningMode(
  cfg?: CrawClawConfig,
): "off" | "once" | "always" {
  const raw = cfg?.agents?.defaults?.bootstrapPromptTruncationWarning;
  if (raw === "off" || raw === "once" || raw === "always") {
    return raw;
  }
  return DEFAULT_BOOTSTRAP_PROMPT_TRUNCATION_WARNING_MODE;
}

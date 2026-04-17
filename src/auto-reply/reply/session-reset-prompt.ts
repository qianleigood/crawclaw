import { appendCronStyleCurrentTimeLine } from "../../agents/current-time.js";
import type { CrawClawConfig } from "../../config/config.js";

const BARE_SESSION_RESET_PROMPT_BASE =
  "A new session was started via /new. Greet the user briefly in your normal voice, in 1-2 sentences, and ask what they want to do next. Do not mention internal steps, files, tools, or reasoning.";

/**
 * Build the bare session reset prompt, appending the current date/time so agents
 * see the real runtime date instead of guessing it from training cutoff.
 */
export function buildBareSessionResetPrompt(cfg?: CrawClawConfig, nowMs?: number): string {
  return appendCronStyleCurrentTimeLine(
    BARE_SESSION_RESET_PROMPT_BASE,
    cfg ?? {},
    nowMs ?? Date.now(),
  );
}

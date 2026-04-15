import { createRequire } from "node:module";
import { getMSTeamsRuntime } from "./runtime.js";

let cachedUserAgent: string | undefined;

function resolveTeamsSdkVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@microsoft/teams.apps/package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function resolveCrawClawVersion(): string {
  try {
    return getMSTeamsRuntime().version;
  } catch {
    return "unknown";
  }
}

/**
 * Build a combined User-Agent string that preserves the Teams SDK identity
 * and appends the CrawClaw version.
 *
 * Format: "teams.ts[apps]/<sdk-version> CrawClaw/<crawclaw-version>"
 * Example: "teams.ts[apps]/2.0.5 CrawClaw/2026.3.22"
 *
 * This lets the Teams backend track SDK usage while also identifying the
 * host application.
 */
/** Reset the cached User-Agent (for testing). */
export function resetUserAgentCache(): void {
  cachedUserAgent = undefined;
}

export function buildUserAgent(): string {
  if (cachedUserAgent) {
    return cachedUserAgent;
  }
  cachedUserAgent = `teams.ts[apps]/${resolveTeamsSdkVersion()} CrawClaw/${resolveCrawClawVersion()}`;
  return cachedUserAgent;
}

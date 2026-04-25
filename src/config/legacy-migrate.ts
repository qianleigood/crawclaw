import type { CrawClawConfig } from "./types.js";

export function migrateLegacyConfig(_raw: unknown): {
  config: CrawClawConfig | null;
  changes: string[];
} {
  return { config: null, changes: [] };
}

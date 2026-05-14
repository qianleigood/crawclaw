import type { CrawClawConfig } from "../../../config/config.js";

export type MutableAllowlistHit = {
  channel: string;
  path: string;
  entry: string;
  dangerousFlagPath: string;
};

export function scanMutableAllowlistEntries(_cfg: CrawClawConfig): MutableAllowlistHit[] {
  return [];
}

export function collectMutableAllowlistWarnings(_hits: MutableAllowlistHit[]): string[] {
  return [];
}

import { resolveActiveTalkProviderConfig } from "../../config/talk.js";
import type { CrawClawConfig } from "../../config/types.js";

export { resolveActiveTalkProviderConfig };

export function getRuntimeConfigSnapshot(): CrawClawConfig | null {
  return null;
}

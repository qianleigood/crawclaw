import type { CrawClawConfig } from "../../config/config.js";
import type { ContextArchiveService } from "./service.js";

export async function resolveSharedContextArchiveService(
  _config?: CrawClawConfig,
): Promise<ContextArchiveService | undefined> {
  return undefined;
}

export function resetSharedContextArchiveServiceForTests(): void {
  return;
}

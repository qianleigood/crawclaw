import type {
  ContextArchiveCleanupOptions,
  ContextArchiveCleanupReport,
  ContextArchiveUsageSummary,
} from "./types.js";
import type { ContextArchiveService } from "./service.js";

export async function summarizeContextArchiveUsage(
  archive: ContextArchiveService,
): Promise<ContextArchiveUsageSummary> {
  return await archive.getUsage();
}

export async function cleanContextArchive(
  archive: ContextArchiveService,
  options?: ContextArchiveCleanupOptions,
): Promise<ContextArchiveCleanupReport> {
  return await archive.pruneRetention(options);
}

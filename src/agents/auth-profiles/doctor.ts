import type { CrawClawConfig } from "../../config/config.js";
import { normalizeProviderId } from "../model-selection.js";
import type { AuthProfileStore } from "./types.js";

/**
 * Migration hints for deprecated/removed OAuth providers.
 * Users with stale credentials should be guided to migrate.
 */
const DEPRECATED_PROVIDER_MIGRATION_HINTS: Record<string, string> = {
  "qwen-portal":
    "Qwen OAuth via portal.qwen.ai has been deprecated. Please migrate to Model Studio (Alibaba Cloud Coding Plan). Run: crawclaw onboard --auth-choice modelstudio-api-key (or modelstudio-api-key-cn for the China endpoint).",
};

export async function formatAuthDoctorHint(params: {
  cfg?: CrawClawConfig;
  store: AuthProfileStore;
  provider: string;
  profileId?: string;
}): Promise<string> {
  const normalizedProvider = normalizeProviderId(params.provider);

  // Check for deprecated provider migration hints first
  const migrationHint = DEPRECATED_PROVIDER_MIGRATION_HINTS[normalizedProvider];
  if (migrationHint) {
    return migrationHint;
  }

  return "";
}

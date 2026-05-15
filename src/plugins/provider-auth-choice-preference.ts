import type { CrawClawConfig } from "../config/config.js";
import { resolveManifestProviderAuthChoice } from "./provider-auth-choices.js";

export async function resolvePreferredProviderForAuthChoice(params: {
  choice: string;
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  const choice = params.choice;
  const manifestResolved = resolveManifestProviderAuthChoice(choice, params);
  if (manifestResolved) {
    return manifestResolved.providerId;
  }

  if (choice === "custom-api-key") {
    return "custom";
  }
  return undefined;
}

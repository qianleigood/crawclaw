import {
  ensureAuthProfileStore,
  resolveApiKeyForProfile,
  resolveAuthProfileOrder,
} from "../../agents/auth-profiles.js";
import { resolveEnvApiKey } from "../../agents/model-auth.js";
import { createCliTranslator, getActiveCliLocale } from "../../cli/i18n/text.js";
import type { CrawClawConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import { normalizeOptionalSecretInput } from "../../utils/normalize-secret-input.js";
import type { SecretInputMode } from "../onboard-types.js";

export type NonInteractiveApiKeySource = "flag" | "env" | "profile";

function parseEnvVarNameFromSourceLabel(source: string | undefined): string | undefined {
  if (!source) {
    return undefined;
  }
  const match = /^(?:shell env: |env: )([A-Z][A-Z0-9_]*)$/.exec(source.trim());
  return match?.[1];
}

async function resolveApiKeyFromProfiles(params: {
  provider: string;
  cfg: CrawClawConfig;
  agentDir?: string;
}): Promise<string | null> {
  const store = ensureAuthProfileStore(params.agentDir);
  const order = resolveAuthProfileOrder({
    cfg: params.cfg,
    store,
    provider: params.provider,
  });
  for (const profileId of order) {
    const cred = store.profiles[profileId];
    if (cred?.type !== "api_key") {
      continue;
    }
    const resolved = await resolveApiKeyForProfile({
      cfg: params.cfg,
      store,
      profileId,
      agentDir: params.agentDir,
    });
    if (resolved?.apiKey) {
      return resolved.apiKey;
    }
  }
  return null;
}

export async function resolveNonInteractiveApiKey(params: {
  provider: string;
  cfg: CrawClawConfig;
  flagValue?: string;
  flagName: string;
  envVar: string;
  envVarName?: string;
  runtime: RuntimeEnv;
  agentDir?: string;
  allowProfile?: boolean;
  required?: boolean;
  secretInputMode?: SecretInputMode;
}): Promise<{ key: string; source: NonInteractiveApiKeySource; envVarName?: string } | null> {
  const flagKey = normalizeOptionalSecretInput(params.flagValue);
  const t = createCliTranslator(getActiveCliLocale());
  const envResolved = resolveEnvApiKey(params.provider);
  const explicitEnvVar = params.envVarName?.trim();
  const explicitEnvKey = explicitEnvVar
    ? normalizeOptionalSecretInput(process.env[explicitEnvVar])
    : undefined;
  const resolvedEnvKey = envResolved?.apiKey ?? explicitEnvKey;
  const resolvedEnvVarName = parseEnvVarNameFromSourceLabel(envResolved?.source) ?? explicitEnvVar;

  const useSecretRefMode = params.secretInputMode === "ref"; // pragma: allowlist secret
  if (useSecretRefMode) {
    if (!resolvedEnvKey && flagKey) {
      params.runtime.error(
        t("wizard.auth.error.flagRequiresEnvRef", {
          flag: params.flagName,
          env: params.envVar,
        }),
      );
      params.runtime.exit(1);
      return null;
    }
    if (resolvedEnvKey) {
      if (!resolvedEnvVarName) {
        params.runtime.error(
          t("wizard.auth.error.refRequiresExplicitEnv", { provider: params.provider }),
        );
        params.runtime.exit(1);
        return null;
      }
      return { key: resolvedEnvKey, source: "env", envVarName: resolvedEnvVarName };
    }
  }

  if (flagKey) {
    return { key: flagKey, source: "flag" };
  }

  if (resolvedEnvKey) {
    return { key: resolvedEnvKey, source: "env", envVarName: resolvedEnvVarName };
  }

  if (params.allowProfile ?? true) {
    const profileKey = await resolveApiKeyFromProfiles({
      provider: params.provider,
      cfg: params.cfg,
      agentDir: params.agentDir,
    });
    if (profileKey) {
      return { key: profileKey, source: "profile" };
    }
  }

  if (params.required === false) {
    return null;
  }

  const profileHint =
    params.allowProfile === false
      ? ""
      : t("wizard.auth.error.profileHint", { provider: params.provider });
  params.runtime.error(
    t("wizard.auth.error.missingApiKey", {
      flag: params.flagName,
      env: params.envVar,
      profileHint,
    }),
  );
  params.runtime.exit(1);
  return null;
}

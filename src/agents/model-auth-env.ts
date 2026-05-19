import { getEnvApiKey } from "@mariozechner/pi-ai";
import { getShellEnvAppliedKeys } from "../infra/shell-env.js";
import {
  ANTHROPIC_VERTEX_PROVIDER_ID,
  GOOGLE_VERTEX_PROVIDER_ID,
  OAUTH_PROVIDER_AUTH_ENV_VARS,
} from "../providers/runtime-constants.js";
import { normalizeOptionalSecretInput } from "../utils/normalize-secret-input.js";
import { hasAnthropicVertexAvailableAuth } from "./anthropic-vertex-auth-presence.js";
import { PROVIDER_ENV_API_KEY_CANDIDATES } from "./model-auth-env-vars.js";
import { GCP_VERTEX_CREDENTIALS_MARKER } from "./model-auth-markers.js";
import { normalizeProviderIdForAuth } from "./provider-id.js";

export type EnvApiKeyResult = {
  apiKey: string;
  source: string;
  mode: "api-key" | "oauth";
};

const OAUTH_PROVIDER_AUTH_ENV_VAR_NAMES = new Set<string>(OAUTH_PROVIDER_AUTH_ENV_VARS);

export function resolveEnvApiKey(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvApiKeyResult | null {
  const normalized = normalizeProviderIdForAuth(provider);
  const applied = new Set(getShellEnvAppliedKeys());
  const pick = (envVar: string): EnvApiKeyResult | null => {
    const value = normalizeOptionalSecretInput(env[envVar]);
    if (!value) {
      return null;
    }
    const source = applied.has(envVar) ? `shell env: ${envVar}` : `env: ${envVar}`;
    return {
      apiKey: value,
      source,
      mode: OAUTH_PROVIDER_AUTH_ENV_VAR_NAMES.has(envVar) ? "oauth" : "api-key",
    };
  };

  const candidates = PROVIDER_ENV_API_KEY_CANDIDATES[normalized];
  if (candidates) {
    for (const envVar of candidates) {
      const resolved = pick(envVar);
      if (resolved) {
        return resolved;
      }
    }
  }

  if (normalized === GOOGLE_VERTEX_PROVIDER_ID) {
    const envKey = getEnvApiKey(normalized);
    if (!envKey) {
      return null;
    }
    return { apiKey: envKey, source: "gcloud adc", mode: "api-key" };
  }

  if (normalized === ANTHROPIC_VERTEX_PROVIDER_ID) {
    // Vertex AI uses GCP credentials (SA JSON or ADC), not API keys.
    // Return a sentinel so the model resolver still treats this provider as available.
    if (hasAnthropicVertexAvailableAuth(env)) {
      return { apiKey: GCP_VERTEX_CREDENTIALS_MARKER, source: "gcloud adc", mode: "api-key" };
    }
    return null;
  }

  return null;
}

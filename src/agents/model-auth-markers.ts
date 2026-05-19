import type { SecretRefSource } from "../config/types.secrets.js";
import {
  AWS_SDK_ENV_MARKERS as GENERATED_AWS_SDK_ENV_MARKERS,
  CUSTOM_LOCAL_AUTH_MARKER as GENERATED_CUSTOM_LOCAL_AUTH_MARKER,
  GCP_VERTEX_CREDENTIALS_MARKER as GENERATED_GCP_VERTEX_CREDENTIALS_MARKER,
  LEGACY_ENV_API_KEY_MARKERS,
  MINIMAX_OAUTH_MARKER as GENERATED_MINIMAX_OAUTH_MARKER,
  NON_ENV_SECRETREF_MARKER as GENERATED_NON_ENV_SECRETREF_MARKER,
  OAUTH_API_KEY_MARKER_PREFIX as GENERATED_OAUTH_API_KEY_MARKER_PREFIX,
  OLLAMA_LOCAL_AUTH_MARKER as GENERATED_OLLAMA_LOCAL_AUTH_MARKER,
  SECRETREF_ENV_HEADER_MARKER_PREFIX as GENERATED_SECRETREF_ENV_HEADER_MARKER_PREFIX,
} from "../providers/runtime-constants.js";
import { listKnownProviderEnvApiKeyNames } from "./model-auth-env-vars.js";

export const MINIMAX_OAUTH_MARKER = GENERATED_MINIMAX_OAUTH_MARKER;
export const OAUTH_API_KEY_MARKER_PREFIX = GENERATED_OAUTH_API_KEY_MARKER_PREFIX;
export const OLLAMA_LOCAL_AUTH_MARKER = GENERATED_OLLAMA_LOCAL_AUTH_MARKER;
export const CUSTOM_LOCAL_AUTH_MARKER = GENERATED_CUSTOM_LOCAL_AUTH_MARKER;
export const GCP_VERTEX_CREDENTIALS_MARKER = GENERATED_GCP_VERTEX_CREDENTIALS_MARKER;
export const NON_ENV_SECRETREF_MARKER = GENERATED_NON_ENV_SECRETREF_MARKER; // pragma: allowlist secret
export const SECRETREF_ENV_HEADER_MARKER_PREFIX = GENERATED_SECRETREF_ENV_HEADER_MARKER_PREFIX; // pragma: allowlist secret

const AWS_SDK_ENV_MARKERS = new Set<string>(GENERATED_AWS_SDK_ENV_MARKERS);

const KNOWN_ENV_API_KEY_MARKERS = new Set([
  ...listKnownProviderEnvApiKeyNames(),
  ...LEGACY_ENV_API_KEY_MARKERS,
  ...AWS_SDK_ENV_MARKERS,
]);

export function isAwsSdkAuthMarker(value: string): boolean {
  return AWS_SDK_ENV_MARKERS.has(value.trim());
}

export function isKnownEnvApiKeyMarker(value: string): boolean {
  const trimmed = value.trim();
  return KNOWN_ENV_API_KEY_MARKERS.has(trimmed) && !isAwsSdkAuthMarker(trimmed);
}

export function resolveOAuthApiKeyMarker(providerId: string): string {
  return `${OAUTH_API_KEY_MARKER_PREFIX}${providerId.trim()}`;
}

export function isOAuthApiKeyMarker(value: string): boolean {
  return value.trim().startsWith(OAUTH_API_KEY_MARKER_PREFIX);
}

export function resolveNonEnvSecretRefApiKeyMarker(_source: SecretRefSource): string {
  return NON_ENV_SECRETREF_MARKER;
}

export function resolveNonEnvSecretRefHeaderValueMarker(_source: SecretRefSource): string {
  return NON_ENV_SECRETREF_MARKER;
}

export function resolveEnvSecretRefHeaderValueMarker(envVarName: string): string {
  return `${SECRETREF_ENV_HEADER_MARKER_PREFIX}${envVarName.trim()}`;
}

export function isSecretRefHeaderValueMarker(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === NON_ENV_SECRETREF_MARKER || trimmed.startsWith(SECRETREF_ENV_HEADER_MARKER_PREFIX)
  );
}

export function isNonSecretApiKeyMarker(
  value: string,
  opts?: { includeEnvVarName?: boolean },
): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const isKnownMarker =
    trimmed === MINIMAX_OAUTH_MARKER ||
    isOAuthApiKeyMarker(trimmed) ||
    trimmed === OLLAMA_LOCAL_AUTH_MARKER ||
    trimmed === CUSTOM_LOCAL_AUTH_MARKER ||
    trimmed === GCP_VERTEX_CREDENTIALS_MARKER ||
    trimmed === NON_ENV_SECRETREF_MARKER ||
    isAwsSdkAuthMarker(trimmed);
  if (isKnownMarker) {
    return true;
  }
  if (opts?.includeEnvVarName === false) {
    return false;
  }
  // Do not treat arbitrary ALL_CAPS values as markers; only recognize the
  // known env-var markers we intentionally persist for compatibility.
  return KNOWN_ENV_API_KEY_MARKERS.has(trimmed);
}

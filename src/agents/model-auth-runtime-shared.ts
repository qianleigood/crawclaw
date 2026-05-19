import {
  AWS_ACCESS_KEY_ID_ENV,
  AWS_BEDROCK_BEARER_TOKEN_ENV,
  AWS_PROFILE_ENV,
  AWS_SECRET_ACCESS_KEY_ENV,
} from "../providers/runtime-constants.js";
import { normalizeSecretInput } from "../utils/normalize-secret-input.js";

export type ResolvedProviderAuth = {
  apiKey?: string;
  profileId?: string;
  source: string;
  mode: "api-key" | "oauth" | "token" | "aws-sdk";
};

export function resolveAwsSdkEnvVarName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env[AWS_BEDROCK_BEARER_TOKEN_ENV]?.trim()) {
    return AWS_BEDROCK_BEARER_TOKEN_ENV;
  }
  if (env[AWS_ACCESS_KEY_ID_ENV]?.trim() && env[AWS_SECRET_ACCESS_KEY_ENV]?.trim()) {
    return AWS_ACCESS_KEY_ID_ENV;
  }
  if (env[AWS_PROFILE_ENV]?.trim()) {
    return AWS_PROFILE_ENV;
  }
  return undefined;
}

export function requireApiKey(auth: ResolvedProviderAuth, provider: string): string {
  const key = normalizeSecretInput(auth.apiKey);
  if (key) {
    return key;
  }
  throw new Error(`No API key resolved for provider "${provider}" (auth mode: ${auth.mode}).`);
}

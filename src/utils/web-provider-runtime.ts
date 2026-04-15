import { normalizeSecretInput } from "./normalize-secret-input.js";

export function readProviderEnvValue(envVars: string[]): string | undefined {
  for (const envVar of envVars) {
    const value = normalizeSecretInput(process.env[envVar]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function providerRequiresCredential(
  provider: Pick<{ requiresCredential?: boolean }, "requiresCredential">,
): boolean {
  return provider.requiresCredential !== false;
}

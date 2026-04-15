import { normalizeSecretInputString, resolveSecretInputRef } from "../../config/types.secrets.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { readProviderEnvValue } from "../../utils/web-provider-runtime.js";

export function resolveWebSearchProviderCredential(params: {
  credentialValue: unknown;
  path: string;
  envVars: string[];
}): string | undefined {
  const fromConfigRaw = normalizeSecretInputString(params.credentialValue);
  const fromConfig = normalizeSecretInput(fromConfigRaw);
  if (fromConfig) {
    return fromConfig;
  }

  const credentialRef = resolveSecretInputRef({
    value: params.credentialValue,
  }).ref;
  if (credentialRef?.source === "env") {
    const fromEnvRef = readProviderEnvValue([credentialRef.id]);
    if (fromEnvRef) {
      return fromEnvRef;
    }
  }
  return readProviderEnvValue(params.envVars);
}

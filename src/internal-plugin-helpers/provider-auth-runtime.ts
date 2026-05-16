// Public auth helpers retained for non-executing provider setup code.

export { resolveEnvApiKey } from "../agents/model-auth-env.js";
export { NON_ENV_SECRETREF_MARKER } from "../agents/model-auth-markers.js";
export {
  requireApiKey,
  resolveAwsSdkEnvVarName,
  type ResolvedProviderAuth,
} from "../agents/model-auth-runtime-shared.js";
export { resolveApiKeyForProvider } from "../agents/model-auth.js";

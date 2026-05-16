import {
  getOAuthApiKey as getOAuthApiKeyFromPi,
  refreshOpenAICodexToken as refreshOpenAICodexTokenFromPi,
} from "@mariozechner/pi-ai/oauth";
import { ensureGlobalUndiciEnvProxyDispatcher } from "../../src/internal-plugin-helpers/runtime-env.js";

export async function getOAuthApiKey(
  ...args: Parameters<typeof getOAuthApiKeyFromPi>
): Promise<Awaited<ReturnType<typeof getOAuthApiKeyFromPi>>> {
  ensureGlobalUndiciEnvProxyDispatcher();
  return await getOAuthApiKeyFromPi(...args);
}

export async function refreshOpenAICodexToken(
  ...args: Parameters<typeof refreshOpenAICodexTokenFromPi>
): Promise<Awaited<ReturnType<typeof refreshOpenAICodexTokenFromPi>>> {
  ensureGlobalUndiciEnvProxyDispatcher();
  return await refreshOpenAICodexTokenFromPi(...args);
}

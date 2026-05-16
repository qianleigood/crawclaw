import type { AuthRateLimiter } from "../../auth-rate-limit.js";
import type { GatewayAuthResult } from "../../auth.js";
import { isLoopbackAddress } from "../../net.js";
import type { AuthProvidedKind } from "./auth-messages.js";

export const BROWSER_ORIGIN_LOOPBACK_RATE_LIMIT_IP = "198.18.0.1";

export type HandshakeBrowserSecurityContext = {
  hasBrowserOriginHeader: boolean;
  enforceOriginCheckForAnyClient: boolean;
  rateLimitClientIp: string | undefined;
  authRateLimiter?: AuthRateLimiter;
};

type HandshakeConnectAuth = {
  token?: string;
  password?: string;
};

export function resolveHandshakeBrowserSecurityContext(params: {
  requestOrigin?: string;
  clientIp: string | undefined;
  rateLimiter?: AuthRateLimiter;
  browserRateLimiter?: AuthRateLimiter;
}): HandshakeBrowserSecurityContext {
  const hasBrowserOriginHeader = Boolean(
    params.requestOrigin && params.requestOrigin.trim() !== "",
  );
  return {
    hasBrowserOriginHeader,
    enforceOriginCheckForAnyClient: hasBrowserOriginHeader,
    rateLimitClientIp:
      hasBrowserOriginHeader && isLoopbackAddress(params.clientIp)
        ? BROWSER_ORIGIN_LOOPBACK_RATE_LIMIT_IP
        : params.clientIp,
    authRateLimiter:
      hasBrowserOriginHeader && params.browserRateLimiter
        ? params.browserRateLimiter
        : params.rateLimiter,
  };
}

function buildUnauthorizedHandshakeContext(params: {
  authProvided: AuthProvidedKind;
  recommendedNextStep:
    | "update_auth_configuration"
    | "update_auth_credentials"
    | "wait_then_retry"
    | "review_auth_configuration";
}) {
  return {
    authProvided: params.authProvided,
    recommendedNextStep: params.recommendedNextStep,
  };
}

export function resolveAuthProvidedKind(
  connectAuth: HandshakeConnectAuth | null | undefined,
): AuthProvidedKind {
  return connectAuth?.password ? "password" : connectAuth?.token ? "token" : "none";
}

export function resolveUnauthorizedHandshakeContext(params: {
  connectAuth: HandshakeConnectAuth | null | undefined;
  failedAuth: GatewayAuthResult;
}): {
  authProvided: AuthProvidedKind;
  recommendedNextStep:
    | "update_auth_configuration"
    | "update_auth_credentials"
    | "wait_then_retry"
    | "review_auth_configuration";
} {
  const authProvided = resolveAuthProvidedKind(params.connectAuth);
  switch (params.failedAuth.reason) {
    case "token_missing":
    case "token_missing_config":
    case "password_missing":
    case "password_missing_config":
      return buildUnauthorizedHandshakeContext({
        authProvided,
        recommendedNextStep: "update_auth_configuration",
      });
    case "token_mismatch":
    case "password_mismatch":
    case "rate_limited":
      return buildUnauthorizedHandshakeContext({
        authProvided,
        recommendedNextStep: "wait_then_retry",
      });
    default:
      return buildUnauthorizedHandshakeContext({
        authProvided,
        recommendedNextStep: "review_auth_configuration",
      });
  }
}

import { describe, expect, it } from "vitest";
import type { AuthRateLimiter } from "../../auth-rate-limit.js";
import {
  BROWSER_ORIGIN_LOOPBACK_RATE_LIMIT_IP,
  resolveHandshakeBrowserSecurityContext,
  resolveUnauthorizedHandshakeContext,
} from "./handshake-auth-helpers.js";

function createRateLimiter(): AuthRateLimiter {
  return {
    check: () => ({ allowed: true, remaining: 1, retryAfterMs: 0 }),
    reset: () => {},
    recordFailure: () => {},
    size: () => 0,
    prune: () => {},
    dispose: () => {},
  };
}

describe("handshake auth helpers", () => {
  it("pins browser-origin loopback clients to the synthetic rate-limit ip", () => {
    const rateLimiter = createRateLimiter();
    const browserRateLimiter = createRateLimiter();
    const resolved = resolveHandshakeBrowserSecurityContext({
      requestOrigin: "https://app.example",
      clientIp: "127.0.0.1",
      rateLimiter,
      browserRateLimiter,
    });

    expect(resolved).toMatchObject({
      hasBrowserOriginHeader: true,
      enforceOriginCheckForAnyClient: true,
      rateLimitClientIp: BROWSER_ORIGIN_LOOPBACK_RATE_LIMIT_IP,
      authRateLimiter: browserRateLimiter,
    });
  });

  it("recommends waiting after shared-token mismatch", () => {
    const resolved = resolveUnauthorizedHandshakeContext({
      connectAuth: { token: "shared-token" },
      failedAuth: { ok: false, reason: "token_mismatch" },
    });

    expect(resolved).toEqual({
      authProvided: "token",
      recommendedNextStep: "wait_then_retry",
    });
  });

  it("recommends configuration updates when auth is missing", () => {
    const resolved = resolveUnauthorizedHandshakeContext({
      connectAuth: null,
      failedAuth: { ok: false, reason: "token_missing" },
    });

    expect(resolved).toEqual({
      authProvided: "none",
      recommendedNextStep: "update_auth_configuration",
    });
  });
});

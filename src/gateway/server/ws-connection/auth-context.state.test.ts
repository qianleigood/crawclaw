import { describe, expect, it, vi } from "vitest";
import type { AuthRateLimiter } from "../../auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "../../auth.js";
import { resolveConnectAuthState } from "./auth-context.js";

function createLimiter() {
  return {
    check: vi.fn(() => ({ allowed: true, retryAfterMs: 5_000 })),
    reset: vi.fn(),
    recordFailure: vi.fn(),
  } as unknown as AuthRateLimiter;
}

describe("resolveConnectAuthState", () => {
  it("records shared-secret failures", async () => {
    const rateLimiter = createLimiter();
    const state = await resolveConnectAuthState({
      resolvedAuth: {
        mode: "token",
        token: "correct-secret",
        allowTailscale: false,
      } satisfies ResolvedGatewayAuth,
      connectAuth: {
        token: "wrong-secret",
      },
      req: {
        headers: {},
        socket: { remoteAddress: "203.0.113.20" },
      } as never,
      trustedProxies: [],
      allowRealIpFallback: false,
      rateLimiter,
      clientIp: "203.0.113.20",
    });

    expect(state.authOk).toBe(false);
    expect(state.authResult.reason).toBe("token_mismatch");
    expect(
      (rateLimiter as never as { recordFailure: ReturnType<typeof vi.fn> }).recordFailure,
    ).toHaveBeenCalled();
  });
});

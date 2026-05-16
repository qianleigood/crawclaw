import { describe, expect, it } from "vitest";
import { resolveConnectAuthDecision, type ConnectAuthState } from "./auth-context.js";

function createState(overrides?: Partial<ConnectAuthState>): ConnectAuthState {
  return {
    authResult: { ok: false, reason: "token_mismatch" },
    authOk: false,
    authMethod: "token",
    sharedAuthOk: false,
    sharedAuthProvided: true,
    ...overrides,
  };
}

describe("resolveConnectAuthDecision", () => {
  it("returns the resolved shared-auth decision unchanged", async () => {
    const state = createState();
    await expect(resolveConnectAuthDecision({ state })).resolves.toEqual({
      authResult: state.authResult,
      authOk: false,
      authMethod: "token",
    });
  });

  it("preserves successful auth methods", async () => {
    const state = createState({
      authResult: { ok: true, method: "trusted-proxy" },
      authOk: true,
      authMethod: "trusted-proxy",
      sharedAuthOk: true,
      sharedAuthProvided: false,
    });
    await expect(resolveConnectAuthDecision({ state })).resolves.toEqual({
      authResult: state.authResult,
      authOk: true,
      authMethod: "trusted-proxy",
    });
  });
});

import { describe, expect, test } from "vitest";
import {
  evaluateMissingDeviceIdentity,
  isTrustedProxyBrowserClientsOperatorAuth,
  resolveBrowserClientsAuthPolicy,
  shouldClearUnboundScopesForMissingDeviceIdentity,
  shouldSkipBrowserClientsPairing,
} from "./connect-policy.js";

describe("ws connect policy", () => {
  test("resolves browser-client auth policy", () => {
    const bypass = resolveBrowserClientsAuthPolicy({
      isBrowserClients: true,
      browserClientsConfig: { dangerouslyDisableDeviceAuth: true },
      deviceRaw: {
        id: "dev-1",
        publicKey: "pk",
        signature: "sig",
        signedAt: Date.now(),
        nonce: "nonce-1",
      },
    });
    expect(bypass.allowBypass).toBe(true);
    expect(bypass.device).toBeNull();

    const regular = resolveBrowserClientsAuthPolicy({
      isBrowserClients: false,
      browserClientsConfig: { dangerouslyDisableDeviceAuth: true },
      deviceRaw: {
        id: "dev-2",
        publicKey: "pk",
        signature: "sig",
        signedAt: Date.now(),
        nonce: "nonce-2",
      },
    });
    expect(regular.allowBypass).toBe(false);
    expect(regular.device?.id).toBe("dev-2");
  });

  test("evaluates missing-device decisions", () => {
    const policy = resolveBrowserClientsAuthPolicy({
      isBrowserClients: false,
      browserClientsConfig: undefined,
      deviceRaw: null,
    });

    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: true,
        role: "node",
        isBrowserClients: false,
        browserClientsAuthPolicy: policy,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("allow");

    const browserClientsStrict = resolveBrowserClientsAuthPolicy({
      isBrowserClients: true,
      browserClientsConfig: { allowInsecureAuth: true, dangerouslyDisableDeviceAuth: false },
      deviceRaw: null,
    });
    // Remote Browser client with allowInsecureAuth -> still rejected.
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isBrowserClients: true,
        browserClientsAuthPolicy: browserClientsStrict,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("reject-browser-client-insecure-auth");

    // Local Browser client with allowInsecureAuth -> allowed.
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isBrowserClients: true,
        browserClientsAuthPolicy: browserClientsStrict,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: true,
      }).kind,
    ).toBe("allow");

    // Browser client without allowInsecureAuth, even on localhost -> rejected.
    const browserClientsNoInsecure = resolveBrowserClientsAuthPolicy({
      isBrowserClients: true,
      browserClientsConfig: { dangerouslyDisableDeviceAuth: false },
      deviceRaw: null,
    });
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isBrowserClients: true,
        browserClientsAuthPolicy: browserClientsNoInsecure,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: true,
      }).kind,
    ).toBe("reject-browser-client-insecure-auth");

    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isBrowserClients: false,
        browserClientsAuthPolicy: policy,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("allow");

    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isBrowserClients: false,
        browserClientsAuthPolicy: policy,
        trustedProxyAuthOk: false,
        sharedAuthOk: false,
        authOk: false,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("reject-unauthorized");

    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "node",
        isBrowserClients: false,
        browserClientsAuthPolicy: policy,
        trustedProxyAuthOk: false,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
        isLocalClient: false,
      }).kind,
    ).toBe("reject-device-required");

    // Trusted-proxy authenticated Browser client should bypass device-identity gating.
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isBrowserClients: true,
        browserClientsAuthPolicy: browserClientsNoInsecure,
        trustedProxyAuthOk: true,
        sharedAuthOk: false,
        authOk: true,
        hasSharedAuth: false,
        isLocalClient: false,
      }).kind,
    ).toBe("allow");

    const bypass = resolveBrowserClientsAuthPolicy({
      isBrowserClients: true,
      browserClientsConfig: { dangerouslyDisableDeviceAuth: true },
      deviceRaw: null,
    });
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "operator",
        isBrowserClients: true,
        browserClientsAuthPolicy: bypass,
        trustedProxyAuthOk: false,
        sharedAuthOk: false,
        authOk: false,
        hasSharedAuth: false,
        isLocalClient: false,
      }).kind,
    ).toBe("allow");

    // Regression: dangerouslyDisableDeviceAuth bypass must NOT extend to node-role
    // sessions — the break-glass flag is scoped to operator Browser client only.
    // A device-less node-role connection must still be rejected even when the flag
    // is set, to prevent the flag from being abused to admit unauthorized node
    // registrations.
    expect(
      evaluateMissingDeviceIdentity({
        hasDeviceIdentity: false,
        role: "node",
        isBrowserClients: true,
        browserClientsAuthPolicy: bypass,
        trustedProxyAuthOk: false,
        sharedAuthOk: false,
        authOk: false,
        hasSharedAuth: false,
        isLocalClient: false,
      }).kind,
    ).toBe("reject-device-required");
  });

  test("dangerouslyDisableDeviceAuth skips pairing for operator browser-client only", () => {
    const bypass = resolveBrowserClientsAuthPolicy({
      isBrowserClients: true,
      browserClientsConfig: { dangerouslyDisableDeviceAuth: true },
      deviceRaw: null,
    });
    const strict = resolveBrowserClientsAuthPolicy({
      isBrowserClients: true,
      browserClientsConfig: undefined,
      deviceRaw: null,
    });
    expect(shouldSkipBrowserClientsPairing(bypass, "operator", false)).toBe(true);
    expect(shouldSkipBrowserClientsPairing(bypass, "node", false)).toBe(false);
    expect(shouldSkipBrowserClientsPairing(strict, "operator", false)).toBe(false);
    expect(shouldSkipBrowserClientsPairing(strict, "operator", true)).toBe(true);
  });

  test("auth.mode=none skips pairing for operator browser-client only", () => {
    const browserClients = resolveBrowserClientsAuthPolicy({
      isBrowserClients: true,
      browserClientsConfig: undefined,
      deviceRaw: null,
    });
    const nonBrowserClients = resolveBrowserClientsAuthPolicy({
      isBrowserClients: false,
      browserClientsConfig: undefined,
      deviceRaw: null,
    });
    // Browser client + operator + auth.mode=none: skip pairing (the fix for #42931)
    expect(shouldSkipBrowserClientsPairing(browserClients, "operator", false, "none")).toBe(true);
    // Browser client + node role + auth.mode=none: still require pairing
    expect(shouldSkipBrowserClientsPairing(browserClients, "node", false, "none")).toBe(false);
    // Non-Control-UI + operator + auth.mode=none: still require pairing
    // (prevents #43478 regression where ALL clients bypassed pairing)
    expect(shouldSkipBrowserClientsPairing(nonBrowserClients, "operator", false, "none")).toBe(
      false,
    );
    // Browser client + operator + auth.mode=shared-key: no change
    expect(shouldSkipBrowserClientsPairing(browserClients, "operator", false, "shared-key")).toBe(
      false,
    );
    // Browser client + operator + no authMode: no change
    expect(shouldSkipBrowserClientsPairing(browserClients, "operator", false)).toBe(false);
  });

  test("trusted-proxy browser-client bypass only applies to operator + trusted-proxy auth", () => {
    const cases: Array<{
      role: "operator" | "node";
      authMode: string;
      authOk: boolean;
      authMethod: string | undefined;
      expected: boolean;
    }> = [
      {
        role: "operator",
        authMode: "trusted-proxy",
        authOk: true,
        authMethod: "trusted-proxy",
        expected: true,
      },
      {
        role: "node",
        authMode: "trusted-proxy",
        authOk: true,
        authMethod: "trusted-proxy",
        expected: false,
      },
      {
        role: "operator",
        authMode: "token",
        authOk: true,
        authMethod: "token",
        expected: false,
      },
      {
        role: "operator",
        authMode: "trusted-proxy",
        authOk: false,
        authMethod: "trusted-proxy",
        expected: false,
      },
    ];

    for (const tc of cases) {
      expect(
        isTrustedProxyBrowserClientsOperatorAuth({
          isBrowserClients: true,
          role: tc.role,
          authMode: tc.authMode,
          authOk: tc.authOk,
          authMethod: tc.authMethod,
        }),
      ).toBe(tc.expected);
    }
  });

  test("clears unbound scopes for device-less shared auth outside explicit preservation cases", () => {
    const nonBrowserClients = resolveBrowserClientsAuthPolicy({
      isBrowserClients: false,
      browserClientsConfig: undefined,
      deviceRaw: null,
    });
    const browserClients = resolveBrowserClientsAuthPolicy({
      isBrowserClients: true,
      browserClientsConfig: { allowInsecureAuth: true },
      deviceRaw: null,
    });

    expect(
      shouldClearUnboundScopesForMissingDeviceIdentity({
        decision: { kind: "allow" },
        browserClientsAuthPolicy: nonBrowserClients,
        preserveInsecureLocalBrowserClientsScopes: false,
        authMethod: "token",
      }),
    ).toBe(true);

    expect(
      shouldClearUnboundScopesForMissingDeviceIdentity({
        decision: { kind: "allow" },
        browserClientsAuthPolicy: nonBrowserClients,
        preserveInsecureLocalBrowserClientsScopes: false,
        authMethod: "password",
      }),
    ).toBe(true);

    expect(
      shouldClearUnboundScopesForMissingDeviceIdentity({
        decision: { kind: "allow" },
        browserClientsAuthPolicy: nonBrowserClients,
        preserveInsecureLocalBrowserClientsScopes: false,
        authMethod: "trusted-proxy",
      }),
    ).toBe(true);

    expect(
      shouldClearUnboundScopesForMissingDeviceIdentity({
        decision: { kind: "allow" },
        browserClientsAuthPolicy: nonBrowserClients,
        preserveInsecureLocalBrowserClientsScopes: false,
        authMethod: undefined,
        trustedProxyAuthOk: true,
      }),
    ).toBe(true);

    expect(
      shouldClearUnboundScopesForMissingDeviceIdentity({
        decision: { kind: "allow" },
        browserClientsAuthPolicy: browserClients,
        preserveInsecureLocalBrowserClientsScopes: true,
        authMethod: "token",
      }),
    ).toBe(false);

    expect(
      shouldClearUnboundScopesForMissingDeviceIdentity({
        decision: { kind: "reject-device-required" },
        browserClientsAuthPolicy: nonBrowserClients,
        preserveInsecureLocalBrowserClientsScopes: false,
        authMethod: undefined,
      }),
    ).toBe(true);
  });
});

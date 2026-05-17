import { describe, expect, it } from "vitest";
import {
  resolveDaemonInstallRuntimeInputs,
  resolveGatewayDevMode,
} from "./daemon-install-plan.shared.js";

describe("resolveGatewayDevMode", () => {
  it("detects src ts entrypoints", () => {
    expect(resolveGatewayDevMode(["node", "/Users/me/crawclaw/src/gateway/boot.ts"])).toBe(true);
    expect(resolveGatewayDevMode(["node", "C:\\Users\\me\\crawclaw\\src\\gateway\\boot.ts"])).toBe(
      true,
    );
    expect(resolveGatewayDevMode(["node", "/Users/me/crawclaw/dist/gateway/boot.js"])).toBe(false);
  });
});

describe("resolveDaemonInstallRuntimeInputs", () => {
  it("keeps explicit devMode overrides", () => {
    expect(
      resolveDaemonInstallRuntimeInputs({
        devMode: false,
      }),
    ).toEqual({
      devMode: false,
    });
  });
});

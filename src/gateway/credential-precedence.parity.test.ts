import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { resolveGatewayAuth } from "./auth.js";
import { resolveGatewayCredentialsFromConfig } from "./credentials.js";
import { resolveGatewayProbeAuth } from "./probe-auth.js";

type ExpectedCredentialSet = {
  call: { token?: string; password?: string };
  probe: { token?: string; password?: string };
  auth: { token?: string; password?: string };
};

type TestCase = {
  name: string;
  cfg: CrawClawConfig;
  env: NodeJS.ProcessEnv;
  expected: ExpectedCredentialSet;
};

const gatewayEnv = {
  CRAWCLAW_GATEWAY_TOKEN: "env-token", // pragma: allowlist secret
  CRAWCLAW_GATEWAY_PASSWORD: "env-password", // pragma: allowlist secret
} as NodeJS.ProcessEnv;

function makeRemoteGatewayConfig(remote: { token?: string; password?: string }): CrawClawConfig {
  return {
    gateway: {
      mode: "remote",
      remote,
      auth: {
        token: "local-token",
        password: "local-password", // pragma: allowlist secret
      },
    },
  } as CrawClawConfig;
}

describe("gateway credential precedence coverage", () => {
  const cases: TestCase[] = [
    {
      name: "local mode: env overrides config for call/probe, auth remains config-first",
      cfg: {
        gateway: {
          mode: "local",
          auth: {
            token: "config-token",
            password: "config-password", // pragma: allowlist secret
          },
        },
      } as CrawClawConfig,
      env: {
        CRAWCLAW_GATEWAY_TOKEN: "env-token", // pragma: allowlist secret
        CRAWCLAW_GATEWAY_PASSWORD: "env-password", // pragma: allowlist secret
      } as NodeJS.ProcessEnv,
      expected: {
        call: { token: "env-token", password: "env-password" }, // pragma: allowlist secret
        probe: { token: "env-token", password: "env-password" }, // pragma: allowlist secret
        auth: { token: "config-token", password: "config-password" }, // pragma: allowlist secret
      },
    },
    {
      name: "remote mode with remote token configured",
      cfg: makeRemoteGatewayConfig({
        token: "remote-token",
        password: "remote-password", // pragma: allowlist secret
      }),
      env: gatewayEnv,
      expected: {
        call: { token: "remote-token", password: "env-password" }, // pragma: allowlist secret
        probe: { token: "remote-token", password: "env-password" }, // pragma: allowlist secret
        auth: { token: "local-token", password: "local-password" }, // pragma: allowlist secret
      },
    },
    {
      name: "remote mode without remote token keeps remote probe strict",
      cfg: makeRemoteGatewayConfig({
        password: "remote-password", // pragma: allowlist secret
      }),
      env: gatewayEnv,
      expected: {
        call: { token: "env-token", password: "env-password" }, // pragma: allowlist secret
        probe: { token: undefined, password: "env-password" }, // pragma: allowlist secret
        auth: { token: "local-token", password: "local-password" }, // pragma: allowlist secret
      },
    },
  ];

  it.each(cases)("$name", async ({ cfg, env, expected }) => {
    const mode = cfg.gateway?.mode === "remote" ? "remote" : "local";
    const call = resolveGatewayCredentialsFromConfig({
      cfg,
      env,
    });
    const probe = resolveGatewayProbeAuth({
      cfg,
      mode,
      env,
    });
    const auth = resolveGatewayAuth({
      authConfig: cfg.gateway?.auth,
      env,
    });

    expect(call).toEqual(expected.call);
    expect(probe).toEqual(expected.probe);
    expect({ token: auth.token, password: auth.password }).toEqual(expected.auth);
  });
});

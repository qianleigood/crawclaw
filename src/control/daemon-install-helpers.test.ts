import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeStateDirDotEnv } from "../config/test-helpers.js";

const mocks = vi.hoisted(() => ({
  loadAuthProfileStoreForSecretsRuntime: vi.fn(),
  resolveGatewayProgramArguments: vi.fn(),
  buildServiceEnvironment: vi.fn(),
}));

vi.mock("../agents/auth-profiles.js", () => ({
  loadAuthProfileStoreForSecretsRuntime: mocks.loadAuthProfileStoreForSecretsRuntime,
}));

vi.mock("../daemon/program-args.js", () => ({
  resolveGatewayProgramArguments: mocks.resolveGatewayProgramArguments,
}));

vi.mock("../daemon/service-env.js", () => ({
  buildServiceEnvironment: mocks.buildServiceEnvironment,
}));

import {
  buildGatewayInstallPlan,
  gatewayInstallErrorHint,
  resolveGatewayDevMode,
} from "./daemon-install-helpers.js";

afterEach(() => {
  vi.resetAllMocks();
});

describe("resolveGatewayDevMode", () => {
  it("detects dev mode for src ts entrypoints", () => {
    expect(resolveGatewayDevMode(["node", "/Users/me/crawclaw/src/gateway/boot.ts"])).toBe(true);
    expect(resolveGatewayDevMode(["node", "C:\\Users\\me\\crawclaw\\src\\gateway\\boot.ts"])).toBe(
      true,
    );
    expect(resolveGatewayDevMode(["node", "/Users/me/crawclaw/dist/gateway/boot.js"])).toBe(false);
  });
});

function mockGatewayPlanFixture(
  params: {
    workingDirectory?: string;
    serviceEnvironment?: Record<string, string>;
  } = {},
) {
  const { workingDirectory = "/Users/me", serviceEnvironment = { CRAWCLAW_PORT: "3000" } } = params;
  mocks.resolveGatewayProgramArguments.mockResolvedValue({
    programArguments: ["/opt/crawclaw/bin/crawclaw-gateway", "--port", "3000"],
    workingDirectory,
  });
  mocks.loadAuthProfileStoreForSecretsRuntime.mockReturnValue({
    version: 1,
    profiles: {},
  });
  mocks.buildServiceEnvironment.mockReturnValue(serviceEnvironment);
}

describe("buildGatewayInstallPlan", () => {
  // Prevent tests from reading the developer's real ~/.crawclaw/.env when
  // passing `env: {}` (which falls back to os.homedir for state-dir resolution).
  let isolatedHome: string;
  beforeEach(() => {
    isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "oc-plan-test-"));
  });
  afterEach(() => {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  });

  it("resolves the native Gateway binary and returns plan", async () => {
    mockGatewayPlanFixture();

    const plan = await buildGatewayInstallPlan({
      env: { HOME: isolatedHome },
      port: 3000,
    });

    expect(plan.programArguments).toEqual(["/opt/crawclaw/bin/crawclaw-gateway", "--port", "3000"]);
    expect(plan.workingDirectory).toBe("/Users/me");
    expect(plan.environment).toEqual({ CRAWCLAW_PORT: "3000" });
    expect(mocks.buildServiceEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { HOME: isolatedHome },
        port: 3000,
      }),
    );
  });

  it("ignores desktop Node path env for native Gateway service installs", async () => {
    mockGatewayPlanFixture();

    await buildGatewayInstallPlan({
      env: {
        HOME: isolatedHome,
        CRAWCLAW_DESKTOP_NODE_PATH:
          "/Applications/CrawClaw Desktop.app/Contents/MacOS/CrawClaw Desktop",
      },
      port: 3000,
    });

    expect(mocks.resolveGatewayProgramArguments).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 3000,
      }),
    );
    expect(mocks.buildServiceEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          CRAWCLAW_DESKTOP_NODE_PATH:
            "/Applications/CrawClaw Desktop.app/Contents/MacOS/CrawClaw Desktop",
        }),
      }),
    );
  });

  it("merges config env vars into the environment", async () => {
    mockGatewayPlanFixture({
      serviceEnvironment: {
        CRAWCLAW_PORT: "3000",
        HOME: "/Users/me",
      },
    });

    const plan = await buildGatewayInstallPlan({
      env: {},
      port: 3000,
      config: {
        env: {
          vars: {
            GOOGLE_API_KEY: "test-key", // pragma: allowlist secret
          },
          CUSTOM_VAR: "custom-value",
        },
      },
    });

    // Config env vars should be present
    expect(plan.environment.GOOGLE_API_KEY).toBe("test-key");
    expect(plan.environment.CUSTOM_VAR).toBe("custom-value");
    // Service environment vars should take precedence
    expect(plan.environment.CRAWCLAW_PORT).toBe("3000");
    expect(plan.environment.HOME).toBe("/Users/me");
  });

  it("drops dangerous config env vars before service merge", async () => {
    mockGatewayPlanFixture({
      serviceEnvironment: {
        CRAWCLAW_PORT: "3000",
      },
    });

    const plan = await buildGatewayInstallPlan({
      env: {},
      port: 3000,
      config: {
        env: {
          vars: {
            NODE_OPTIONS: "--require /tmp/evil.js",
            SAFE_KEY: "safe-value",
          },
        },
      },
    });

    expect(plan.environment.NODE_OPTIONS).toBeUndefined();
    expect(plan.environment.SAFE_KEY).toBe("safe-value");
  });

  it("does not include empty config env values", async () => {
    mockGatewayPlanFixture();

    const plan = await buildGatewayInstallPlan({
      env: {},
      port: 3000,
      config: {
        env: {
          vars: {
            VALID_KEY: "valid",
            EMPTY_KEY: "",
          },
        },
      },
    });

    expect(plan.environment.VALID_KEY).toBe("valid");
    expect(plan.environment.EMPTY_KEY).toBeUndefined();
  });

  it("drops whitespace-only config env values", async () => {
    mockGatewayPlanFixture({ serviceEnvironment: {} });

    const plan = await buildGatewayInstallPlan({
      env: {},
      port: 3000,
      config: {
        env: {
          vars: {
            VALID_KEY: "valid",
          },
          TRIMMED_KEY: "  ",
        },
      },
    });

    expect(plan.environment.VALID_KEY).toBe("valid");
    expect(plan.environment.TRIMMED_KEY).toBeUndefined();
  });

  it("keeps service env values over config env vars", async () => {
    mockGatewayPlanFixture({
      serviceEnvironment: {
        HOME: "/Users/service",
        CRAWCLAW_PORT: "3000",
      },
    });

    const plan = await buildGatewayInstallPlan({
      env: {},
      port: 3000,
      config: {
        env: {
          HOME: "/Users/config",
          vars: {
            CRAWCLAW_PORT: "9999",
          },
        },
      },
    });

    expect(plan.environment.HOME).toBe("/Users/service");
    expect(plan.environment.CRAWCLAW_PORT).toBe("3000");
  });

  it("merges env-backed auth-profile refs into the service environment", async () => {
    mockGatewayPlanFixture({
      serviceEnvironment: {
        CRAWCLAW_PORT: "3000",
      },
    });
    mocks.loadAuthProfileStoreForSecretsRuntime.mockReturnValue({
      version: 1,
      profiles: {
        "openai:default": {
          type: "api_key",
          provider: "openai",
          keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
        },
        "anthropic:default": {
          type: "token",
          provider: "anthropic",
          tokenRef: { source: "env", provider: "default", id: "ANTHROPIC_TOKEN" },
        },
      },
    });

    const plan = await buildGatewayInstallPlan({
      env: {
        OPENAI_API_KEY: "sk-openai-test", // pragma: allowlist secret
        ANTHROPIC_TOKEN: "ant-test-token",
      },
      port: 3000,
    });

    expect(plan.environment.OPENAI_API_KEY).toBe("sk-openai-test");
    expect(plan.environment.ANTHROPIC_TOKEN).toBe("ant-test-token");
  });

  it("blocks dangerous auth-profile env refs from the service environment", async () => {
    mockGatewayPlanFixture({
      serviceEnvironment: {
        CRAWCLAW_PORT: "3000",
      },
    });
    mocks.loadAuthProfileStoreForSecretsRuntime.mockReturnValue({
      version: 1,
      profiles: {
        "node:default": {
          type: "token",
          provider: "node",
          tokenRef: { source: "env", provider: "default", id: "NODE_OPTIONS" },
        },
        "git:default": {
          type: "token",
          provider: "git",
          tokenRef: { source: "env", provider: "default", id: "GIT_ASKPASS" },
        },
        "openai:default": {
          type: "api_key",
          provider: "openai",
          keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
        },
      },
    });

    const warn = vi.fn();
    const plan = await buildGatewayInstallPlan({
      env: {
        NODE_OPTIONS: "--require ./pwn.js",
        GIT_ASKPASS: "/tmp/askpass.sh",
        OPENAI_API_KEY: "sk-openai-test", // pragma: allowlist secret
      },
      port: 3000,
      warn,
    });

    expect(plan.environment.NODE_OPTIONS).toBeUndefined();
    expect(plan.environment.GIT_ASKPASS).toBeUndefined();
    expect(plan.environment.OPENAI_API_KEY).toBe("sk-openai-test");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NODE_OPTIONS"), "Auth profile");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GIT_ASKPASS"), "Auth profile");
  });

  it("skips non-portable auth-profile env ref keys", async () => {
    mockGatewayPlanFixture({
      serviceEnvironment: {
        CRAWCLAW_PORT: "3000",
      },
    });
    mocks.loadAuthProfileStoreForSecretsRuntime.mockReturnValue({
      version: 1,
      profiles: {
        "broken:default": {
          type: "token",
          provider: "broken",
          tokenRef: { source: "env", provider: "default", id: "BAD KEY" },
        },
      },
    });

    const plan = await buildGatewayInstallPlan({
      env: {
        "BAD KEY": "should-not-pass",
      },
      port: 3000,
    });

    expect(plan.environment["BAD KEY"]).toBeUndefined();
  });

  it("skips unresolved auth-profile env refs", async () => {
    mockGatewayPlanFixture({
      serviceEnvironment: {
        CRAWCLAW_PORT: "3000",
      },
    });
    mocks.loadAuthProfileStoreForSecretsRuntime.mockReturnValue({
      version: 1,
      profiles: {
        "openai:default": {
          type: "api_key",
          provider: "openai",
          keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
        },
      },
    });

    const plan = await buildGatewayInstallPlan({
      env: {},
      port: 3000,
    });

    expect(plan.environment.OPENAI_API_KEY).toBeUndefined();
  });
});

describe("buildGatewayInstallPlan — dotenv merge", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-plan-dotenv-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges .env file vars into the install plan", async () => {
    await writeStateDirDotEnv("BRAVE_API_KEY=BSA-from-env\nOPENROUTER_API_KEY=or-key\n", {
      stateDir: path.join(tmpDir, ".crawclaw"),
    });
    mockGatewayPlanFixture({ serviceEnvironment: { CRAWCLAW_PORT: "3000" } });

    const plan = await buildGatewayInstallPlan({
      env: { HOME: tmpDir },
      port: 3000,
    });

    expect(plan.environment.BRAVE_API_KEY).toBe("BSA-from-env");
    expect(plan.environment.OPENROUTER_API_KEY).toBe("or-key");
    expect(plan.environment.CRAWCLAW_PORT).toBe("3000");
  });

  it("config env vars override .env file vars", async () => {
    await writeStateDirDotEnv("MY_KEY=from-dotenv\n", {
      stateDir: path.join(tmpDir, ".crawclaw"),
    });
    mockGatewayPlanFixture({ serviceEnvironment: {} });

    const plan = await buildGatewayInstallPlan({
      env: { HOME: tmpDir },
      port: 3000,
      config: {
        env: {
          vars: {
            MY_KEY: "from-config",
          },
        },
      },
    });

    expect(plan.environment.MY_KEY).toBe("from-config");
  });

  it("service env overrides .env file vars", async () => {
    await writeStateDirDotEnv("HOME=/from-dotenv\n", {
      stateDir: path.join(tmpDir, ".crawclaw"),
    });
    mockGatewayPlanFixture({
      serviceEnvironment: { HOME: "/from-service" },
    });

    const plan = await buildGatewayInstallPlan({
      env: { HOME: tmpDir },
      port: 3000,
    });

    expect(plan.environment.HOME).toBe("/from-service");
  });

  it("works when .env file does not exist", async () => {
    mockGatewayPlanFixture({ serviceEnvironment: { CRAWCLAW_PORT: "3000" } });

    const plan = await buildGatewayInstallPlan({
      env: { HOME: tmpDir },
      port: 3000,
    });

    expect(plan.environment.CRAWCLAW_PORT).toBe("3000");
  });
});

describe("gatewayInstallErrorHint", () => {
  it("returns platform-specific hints", () => {
    expect(gatewayInstallErrorHint("win32")).toContain("Startup-folder login item");
    expect(gatewayInstallErrorHint("win32")).toContain("elevated PowerShell");
    expect(gatewayInstallErrorHint("linux")).toMatch(
      /(?:crawclaw|crawclaw)( --profile isolated)? gateway install/,
    );
  });
});

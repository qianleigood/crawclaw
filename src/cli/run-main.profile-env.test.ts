import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileState = vi.hoisted(() => ({
  hasCliDotEnv: false,
}));

const dotenvState = vi.hoisted(() => {
  const state = {
    profileAtDotenvLoad: undefined as string | undefined,
  };
  return {
    state,
    loadDotEnv: vi.fn(() => {
      state.profileAtDotenvLoad = process.env.CRAWCLAW_PROFILE;
    }),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  type ExistsSyncPath = Parameters<typeof actual.existsSync>[0];
  return {
    ...actual,
    existsSync: vi.fn((target: ExistsSyncPath) => {
      if (typeof target === "string" && target.endsWith(".env")) {
        return fileState.hasCliDotEnv;
      }
      return actual.existsSync(target);
    }),
  };
});

vi.mock("./dotenv.js", () => ({
  loadCliDotEnv: dotenvState.loadDotEnv,
}));

vi.mock("../infra/env.js", () => ({
  normalizeEnv: vi.fn(),
}));

vi.mock("../infra/runtime-guard.js", () => ({
  assertSupportedRuntime: vi.fn(),
}));

vi.mock("../infra/path-env.js", () => ({
  ensureCrawClawCliOnPath: vi.fn(),
}));

vi.mock("./route.js", () => ({
  tryRouteCli: vi.fn(async () => true),
}));

vi.mock("./windows-argv.js", () => ({
  normalizeWindowsArgv: (argv: string[]) => argv,
}));

import { runCli } from "./run-main.js";

describe("runCli profile env bootstrap", () => {
  const originalProfile = process.env.CRAWCLAW_PROFILE;
  const originalStateDir = process.env.CRAWCLAW_STATE_DIR;
  const originalConfigPath = process.env.CRAWCLAW_CONFIG_PATH;
  const originalGatewayPort = process.env.CRAWCLAW_GATEWAY_PORT;
  const originalGatewayUrl = process.env.CRAWCLAW_GATEWAY_URL;
  const originalGatewayToken = process.env.CRAWCLAW_GATEWAY_TOKEN;
  const originalGatewayPassword = process.env.CRAWCLAW_GATEWAY_PASSWORD;

  beforeEach(() => {
    delete process.env.CRAWCLAW_PROFILE;
    delete process.env.CRAWCLAW_STATE_DIR;
    delete process.env.CRAWCLAW_CONFIG_PATH;
    delete process.env.CRAWCLAW_GATEWAY_PORT;
    delete process.env.CRAWCLAW_GATEWAY_URL;
    delete process.env.CRAWCLAW_GATEWAY_TOKEN;
    delete process.env.CRAWCLAW_GATEWAY_PASSWORD;
    dotenvState.state.profileAtDotenvLoad = undefined;
    dotenvState.loadDotEnv.mockClear();
    fileState.hasCliDotEnv = false;
  });

  afterEach(() => {
    if (originalProfile === undefined) {
      delete process.env.CRAWCLAW_PROFILE;
    } else {
      process.env.CRAWCLAW_PROFILE = originalProfile;
    }
    if (originalStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = originalStateDir;
    }
    if (originalConfigPath === undefined) {
      delete process.env.CRAWCLAW_CONFIG_PATH;
    } else {
      process.env.CRAWCLAW_CONFIG_PATH = originalConfigPath;
    }
    if (originalGatewayPort === undefined) {
      delete process.env.CRAWCLAW_GATEWAY_PORT;
    } else {
      process.env.CRAWCLAW_GATEWAY_PORT = originalGatewayPort;
    }
    if (originalGatewayUrl === undefined) {
      delete process.env.CRAWCLAW_GATEWAY_URL;
    } else {
      process.env.CRAWCLAW_GATEWAY_URL = originalGatewayUrl;
    }
    if (originalGatewayToken === undefined) {
      delete process.env.CRAWCLAW_GATEWAY_TOKEN;
    } else {
      process.env.CRAWCLAW_GATEWAY_TOKEN = originalGatewayToken;
    }
    if (originalGatewayPassword === undefined) {
      delete process.env.CRAWCLAW_GATEWAY_PASSWORD;
    } else {
      process.env.CRAWCLAW_GATEWAY_PASSWORD = originalGatewayPassword;
    }
  });

  it("applies --profile before dotenv loading", async () => {
    fileState.hasCliDotEnv = true;
    await runCli(["node", "crawclaw", "--profile", "rawdog", "status"]);

    expect(dotenvState.loadDotEnv).toHaveBeenCalledOnce();
    expect(dotenvState.state.profileAtDotenvLoad).toBe("rawdog");
    expect(process.env.CRAWCLAW_PROFILE).toBe("rawdog");
  });
});

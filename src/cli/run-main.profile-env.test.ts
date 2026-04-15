import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileState = vi.hoisted(() => ({
  hasCliDotEnv: false,
}));

const dotenvState = vi.hoisted(() => {
  const state = {
    profileAtDotenvLoad: undefined as string | undefined,
    containerAtDotenvLoad: undefined as string | undefined,
  };
  return {
    state,
    loadDotEnv: vi.fn(() => {
      state.profileAtDotenvLoad = process.env.CRAWCLAW_PROFILE;
      state.containerAtDotenvLoad = process.env.CRAWCLAW_CONTAINER;
    }),
  };
});

const maybeRunCliInContainerMock = vi.hoisted(() =>
  vi.fn((argv: string[]) => ({ handled: false, argv })),
);

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

vi.mock("./container-target.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./container-target.js")>();
  return {
    ...actual,
    maybeRunCliInContainer: maybeRunCliInContainerMock,
  };
});

import { runCli } from "./run-main.js";

describe("runCli profile env bootstrap", () => {
  const originalProfile = process.env.CRAWCLAW_PROFILE;
  const originalStateDir = process.env.CRAWCLAW_STATE_DIR;
  const originalConfigPath = process.env.CRAWCLAW_CONFIG_PATH;
  const originalContainer = process.env.CRAWCLAW_CONTAINER;
  const originalGatewayPort = process.env.CRAWCLAW_GATEWAY_PORT;
  const originalGatewayUrl = process.env.CRAWCLAW_GATEWAY_URL;
  const originalGatewayToken = process.env.CRAWCLAW_GATEWAY_TOKEN;
  const originalGatewayPassword = process.env.CRAWCLAW_GATEWAY_PASSWORD;

  beforeEach(() => {
    delete process.env.CRAWCLAW_PROFILE;
    delete process.env.CRAWCLAW_STATE_DIR;
    delete process.env.CRAWCLAW_CONFIG_PATH;
    delete process.env.CRAWCLAW_CONTAINER;
    delete process.env.CRAWCLAW_GATEWAY_PORT;
    delete process.env.CRAWCLAW_GATEWAY_URL;
    delete process.env.CRAWCLAW_GATEWAY_TOKEN;
    delete process.env.CRAWCLAW_GATEWAY_PASSWORD;
    dotenvState.state.profileAtDotenvLoad = undefined;
    dotenvState.state.containerAtDotenvLoad = undefined;
    dotenvState.loadDotEnv.mockClear();
    maybeRunCliInContainerMock.mockClear();
    fileState.hasCliDotEnv = false;
  });

  afterEach(() => {
    if (originalProfile === undefined) {
      delete process.env.CRAWCLAW_PROFILE;
    } else {
      process.env.CRAWCLAW_PROFILE = originalProfile;
    }
    if (originalContainer === undefined) {
      delete process.env.CRAWCLAW_CONTAINER;
    } else {
      process.env.CRAWCLAW_CONTAINER = originalContainer;
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

  it("rejects --container combined with --profile", async () => {
    await expect(
      runCli(["node", "crawclaw", "--container", "demo", "--profile", "rawdog", "status"]),
    ).rejects.toThrow("--container cannot be combined with --profile/--dev");

    expect(dotenvState.loadDotEnv).not.toHaveBeenCalled();
    expect(process.env.CRAWCLAW_PROFILE).toBe("rawdog");
  });

  it("rejects --container combined with interleaved --profile", async () => {
    await expect(
      runCli(["node", "crawclaw", "status", "--container", "demo", "--profile", "rawdog"]),
    ).rejects.toThrow("--container cannot be combined with --profile/--dev");
  });

  it("rejects --container combined with interleaved --dev", async () => {
    await expect(
      runCli(["node", "crawclaw", "status", "--container", "demo", "--dev"]),
    ).rejects.toThrow("--container cannot be combined with --profile/--dev");
  });

  it("does not let dotenv change container target resolution", async () => {
    fileState.hasCliDotEnv = true;
    dotenvState.loadDotEnv.mockImplementationOnce(() => {
      process.env.CRAWCLAW_CONTAINER = "demo";
      dotenvState.state.profileAtDotenvLoad = process.env.CRAWCLAW_PROFILE;
      dotenvState.state.containerAtDotenvLoad = process.env.CRAWCLAW_CONTAINER;
    });

    await runCli(["node", "crawclaw", "status"]);

    expect(dotenvState.loadDotEnv).toHaveBeenCalledOnce();
    expect(process.env.CRAWCLAW_CONTAINER).toBe("demo");
    expect(dotenvState.state.containerAtDotenvLoad).toBe("demo");
    expect(maybeRunCliInContainerMock).toHaveBeenCalledWith(["node", "crawclaw", "status"]);
    expect(maybeRunCliInContainerMock).toHaveReturnedWith({
      handled: false,
      argv: ["node", "crawclaw", "status"],
    });
  });

  it("allows container mode when CRAWCLAW_PROFILE is already set in env", async () => {
    process.env.CRAWCLAW_PROFILE = "work";

    await expect(
      runCli(["node", "crawclaw", "--container", "demo", "status"]),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["CRAWCLAW_GATEWAY_PORT", "19001"],
    ["CRAWCLAW_GATEWAY_URL", "ws://127.0.0.1:18789"],
    ["CRAWCLAW_GATEWAY_TOKEN", "demo-token"],
    ["CRAWCLAW_GATEWAY_PASSWORD", "demo-password"],
  ])("allows container mode when %s is set in env", async (key, value) => {
    process.env[key] = value;

    await expect(
      runCli(["node", "crawclaw", "--container", "demo", "status"]),
    ).resolves.toBeUndefined();
  });

  it("allows container mode when only CRAWCLAW_STATE_DIR is set in env", async () => {
    process.env.CRAWCLAW_STATE_DIR = "/tmp/crawclaw-host-state";

    await expect(
      runCli(["node", "crawclaw", "--container", "demo", "status"]),
    ).resolves.toBeUndefined();
  });

  it("allows container mode when only CRAWCLAW_CONFIG_PATH is set in env", async () => {
    process.env.CRAWCLAW_CONFIG_PATH = "/tmp/crawclaw-host-state/crawclaw.json";

    await expect(
      runCli(["node", "crawclaw", "--container", "demo", "status"]),
    ).resolves.toBeUndefined();
  });
});

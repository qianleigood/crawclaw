import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { setupWizardCommand } from "./onboard.js";

const mocks = vi.hoisted(() => ({
  runInteractiveSetup: vi.fn(async () => {}),
  runNonInteractiveSetup: vi.fn(async () => {}),
  readConfigFileSnapshot: vi.fn(async () => ({ exists: false, valid: false, runtimeConfig: {} })),
  handleReset: vi.fn(async () => {}),
}));

vi.mock("./onboard-interactive.js", () => ({
  runInteractiveSetup: mocks.runInteractiveSetup,
}));

vi.mock("./onboard-non-interactive.js", () => ({
  runNonInteractiveSetup: mocks.runNonInteractiveSetup,
}));

vi.mock("../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

vi.mock("./onboard-helpers.js", () => ({
  DEFAULT_WORKSPACE: "~/.crawclaw/workspace",
  handleReset: mocks.handleReset,
}));

function makeRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn() as unknown as RuntimeEnv["exit"],
  };
}

describe("setupWizardCommand", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.clearAllMocks();
    mocks.readConfigFileSnapshot.mockResolvedValue({
      exists: false,
      valid: false,
      runtimeConfig: {},
    });
  });

  it("fails fast for invalid secret-input-mode before setup starts", async () => {
    const runtime = makeRuntime();

    await setupWizardCommand(
      {
        secretInputMode: "invalid" as never, // pragma: allowlist secret
      },
      runtime,
    );

    expect(runtime.error).toHaveBeenCalledWith(
      'Invalid --secret-input-mode. Use "plaintext" or "ref".',
    );
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(mocks.runInteractiveSetup).not.toHaveBeenCalled();
    expect(mocks.runNonInteractiveSetup).not.toHaveBeenCalled();
  });

  it("localizes non-interactive risk acknowledgement errors", async () => {
    process.argv = ["node", "crawclaw", "--lang", "zh-CN", "onboard", "--non-interactive"];
    const runtime = makeRuntime();

    await setupWizardCommand(
      {
        nonInteractive: true,
      },
      runtime,
    );

    expect(runtime.error).toHaveBeenCalledWith(
      [
        "非交互设置需要明确确认风险。",
        "阅读：https://docs.crawclaw.ai/security",
        "重新运行：crawclaw onboard --non-interactive --accept-risk ...",
      ].join("\n"),
    );
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(mocks.runNonInteractiveSetup).not.toHaveBeenCalled();
  });

  it("logs ASCII-safe Windows guidance before setup", async () => {
    const runtime = makeRuntime();
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    try {
      await setupWizardCommand({}, runtime);

      expect(runtime.log).toHaveBeenCalledWith(
        [
          "Windows detected - CrawClaw supports native Windows.",
          "Use PowerShell and the native installer for the supported Windows path.",
          "Quick setup: iwr -useb https://crawclaw.ai/install.ps1 | iex",
          "Guide: https://docs.crawclaw.ai/platforms/windows",
        ].join("\n"),
      );
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("defaults --reset to config+creds+sessions scope", async () => {
    const runtime = makeRuntime();

    await setupWizardCommand(
      {
        reset: true,
      },
      runtime,
    );

    expect(mocks.handleReset).toHaveBeenCalledWith(
      "config+creds+sessions",
      expect.any(String),
      runtime,
    );
  });

  it("uses configured default workspace for --reset when --workspace is not provided", async () => {
    const runtime = makeRuntime();
    mocks.readConfigFileSnapshot.mockResolvedValue({
      exists: true,
      valid: true,
      runtimeConfig: {
        agents: {
          defaults: {
            workspace: "/tmp/crawclaw-custom-workspace",
          },
        },
      },
    });

    await setupWizardCommand(
      {
        reset: true,
      },
      runtime,
    );

    expect(mocks.handleReset).toHaveBeenCalledWith(
      "config+creds+sessions",
      path.resolve("/tmp/crawclaw-custom-workspace"),
      runtime,
    );
  });

  it("accepts explicit --reset-scope full", async () => {
    const runtime = makeRuntime();

    await setupWizardCommand(
      {
        reset: true,
        resetScope: "full",
      },
      runtime,
    );

    expect(mocks.handleReset).toHaveBeenCalledWith("full", expect.any(String), runtime);
  });

  it("fails fast for invalid --reset-scope", async () => {
    const runtime = makeRuntime();

    await setupWizardCommand(
      {
        reset: true,
        resetScope: "invalid" as never,
      },
      runtime,
    );

    expect(runtime.error).toHaveBeenCalledWith(
      'Invalid --reset-scope. Use "config", "config+creds+sessions", or "full".',
    );
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(mocks.handleReset).not.toHaveBeenCalled();
    expect(mocks.runInteractiveSetup).not.toHaveBeenCalled();
    expect(mocks.runNonInteractiveSetup).not.toHaveBeenCalled();
  });
});

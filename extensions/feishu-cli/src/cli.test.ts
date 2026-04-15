import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  getFeishuCliStatus: vi.fn(),
  runInteractiveLarkCliCommand: vi.fn(),
}));

vi.mock("./lark-cli.js", () => ({
  getFeishuCliStatus: runtimeMocks.getFeishuCliStatus,
  runInteractiveLarkCliCommand: runtimeMocks.runInteractiveLarkCliCommand,
}));

import { registerFeishuCliCli } from "./cli.js";

function buildProgram() {
  const program = new Command();
  registerFeishuCliCli({
    program,
    config: { enabled: true, command: "lark-cli", timeoutMs: 30_000, profile: "default" },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return program;
}

describe("feishu-cli CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("prints JSON status output", async () => {
    runtimeMocks.getFeishuCliStatus.mockResolvedValue({
      identity: "user",
      enabled: true,
      command: "lark-cli",
      profile: "default",
      timeoutMs: 30_000,
      installed: true,
      version: "1.0.7",
      authOk: true,
      status: "ready",
      message: "ready",
    });
    const logSpy = vi.spyOn(console, "log");

    await buildProgram().parseAsync(["feishu-cli", "status", "--json"], { from: "user" });

    const firstArg = logSpy.mock.calls[0]?.[0];
    expect(typeof firstArg).toBe("string");
    expect(JSON.parse(firstArg as string)).toMatchObject({
      status: "ready",
      version: "1.0.7",
    });
  });

  it("proxies auth login through the interactive runner", async () => {
    runtimeMocks.runInteractiveLarkCliCommand.mockReturnValue(0);

    await buildProgram().parseAsync(["feishu-cli", "auth", "login"], { from: "user" });

    expect(runtimeMocks.runInteractiveLarkCliCommand).toHaveBeenCalledWith({
      config: { enabled: true, command: "lark-cli", timeoutMs: 30_000, profile: "default" },
      args: ["auth", "login"],
    });
  });

  it("sets a non-zero exit code when auth logout fails", async () => {
    runtimeMocks.runInteractiveLarkCliCommand.mockReturnValue(2);

    await buildProgram().parseAsync(["feishu-cli", "auth", "logout"], { from: "user" });

    expect(process.exitCode).toBe(2);
  });
});

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProgramContext } from "./context.js";
import { setProgramContext } from "./program-context.js";
import { registerBackupCommand } from "./register.backup.js";

const mocks = vi.hoisted(() => ({
  backupCreateCommand: vi.fn(),
  backupVerifyCommand: vi.fn(),
  runtime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  },
}));

const backupCreateCommand = mocks.backupCreateCommand;
const backupVerifyCommand = mocks.backupVerifyCommand;
const runtime = mocks.runtime;

vi.mock("../../commands/backup.js", () => ({
  backupCreateCommand: mocks.backupCreateCommand,
}));

vi.mock("../../commands/backup-verify.js", () => ({
  backupVerifyCommand: mocks.backupVerifyCommand,
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: mocks.runtime,
}));

describe("registerBackupCommand", () => {
  async function runCli(args: string[]) {
    const program = new Command();
    registerBackupCommand(program);
    await program.parseAsync(args, { from: "user" });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    backupCreateCommand.mockResolvedValue(undefined);
    backupVerifyCommand.mockResolvedValue(undefined);
  });

  it("runs backup create with forwarded options", async () => {
    await runCli(["backup", "create", "--output", "/tmp/backups", "--json", "--dry-run"]);

    expect(backupCreateCommand).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        output: "/tmp/backups",
        json: true,
        dryRun: true,
        verify: false,
        onlyConfig: false,
        includeWorkspace: true,
      }),
    );
  });

  it("honors --no-include-workspace", async () => {
    await runCli(["backup", "create", "--no-include-workspace"]);

    expect(backupCreateCommand).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        includeWorkspace: false,
      }),
    );
  });

  it("forwards --verify to backup create", async () => {
    await runCli(["backup", "create", "--verify"]);

    expect(backupCreateCommand).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        verify: true,
      }),
    );
  });

  it("forwards --only-config to backup create", async () => {
    await runCli(["backup", "create", "--only-config"]);

    expect(backupCreateCommand).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        onlyConfig: true,
      }),
    );
  });

  it("runs backup verify with forwarded options", async () => {
    await runCli(["backup", "verify", "/tmp/crawclaw-backup.tar.gz", "--json"]);

    expect(backupVerifyCommand).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        archive: "/tmp/crawclaw-backup.tar.gz",
        json: true,
      }),
    );
  });

  it("localizes backup help copy", () => {
    const program = new Command();
    setProgramContext(
      program,
      createProgramContext({ argv: ["node", "crawclaw", "--lang", "zh-CN"] }),
    );
    registerBackupCommand(program);

    const backup = program.commands.find((command) => command.name() === "backup");
    const create = backup?.commands.find((command) => command.name() === "create");
    expect(backup?.description()).toBe("创建并校验 CrawClaw 本地状态备份");
    expect(create?.description()).toBe("写入包含配置、凭据、会话和工作区的备份归档");
    expect(create?.helpInformation()).toContain("只打印备份计划，不写入归档");
  });
});

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCliTranslator } from "../i18n/index.js";
import { setProgramContext } from "./program-context.js";
import { registerStatusHealthSessionsCommands } from "./register.status-health-sessions.js";

const mocks = vi.hoisted(() => ({
  statusCommand: vi.fn(),
  healthCommand: vi.fn(),
  sessionsCommand: vi.fn(),
  sessionsCleanupCommand: vi.fn(),
  tasksListCommand: vi.fn(),
  tasksAuditCommand: vi.fn(),
  tasksMaintenanceCommand: vi.fn(),
  tasksShowCommand: vi.fn(),
  tasksNotifyCommand: vi.fn(),
  tasksCancelCommand: vi.fn(),
  flowsListCommand: vi.fn(),
  flowsShowCommand: vi.fn(),
  flowsCancelCommand: vi.fn(),
  setVerbose: vi.fn(),
  runtime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  },
}));

const statusCommand = mocks.statusCommand;
const healthCommand = mocks.healthCommand;
const sessionsCommand = mocks.sessionsCommand;
const sessionsCleanupCommand = mocks.sessionsCleanupCommand;
const tasksListCommand = mocks.tasksListCommand;
const tasksAuditCommand = mocks.tasksAuditCommand;
const tasksMaintenanceCommand = mocks.tasksMaintenanceCommand;
const tasksShowCommand = mocks.tasksShowCommand;
const tasksNotifyCommand = mocks.tasksNotifyCommand;
const tasksCancelCommand = mocks.tasksCancelCommand;
const flowsListCommand = mocks.flowsListCommand;
const flowsShowCommand = mocks.flowsShowCommand;
const flowsCancelCommand = mocks.flowsCancelCommand;
const setVerbose = mocks.setVerbose;
const runtime = mocks.runtime;

vi.mock("../../commands/status.js", () => ({
  statusCommand: mocks.statusCommand,
}));

vi.mock("../../commands/health.js", () => ({
  healthCommand: mocks.healthCommand,
}));

vi.mock("../../commands/sessions.js", () => ({
  sessionsCommand: mocks.sessionsCommand,
}));

vi.mock("../../commands/sessions-cleanup.js", () => ({
  sessionsCleanupCommand: mocks.sessionsCleanupCommand,
}));

vi.mock("../../commands/tasks.js", () => ({
  tasksListCommand: mocks.tasksListCommand,
  tasksAuditCommand: mocks.tasksAuditCommand,
  tasksMaintenanceCommand: mocks.tasksMaintenanceCommand,
  tasksShowCommand: mocks.tasksShowCommand,
  tasksNotifyCommand: mocks.tasksNotifyCommand,
  tasksCancelCommand: mocks.tasksCancelCommand,
}));

vi.mock("../../commands/flows.js", () => ({
  flowsListCommand: mocks.flowsListCommand,
  flowsShowCommand: mocks.flowsShowCommand,
  flowsCancelCommand: mocks.flowsCancelCommand,
}));

vi.mock("../../globals.js", () => ({
  setVerbose: mocks.setVerbose,
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: mocks.runtime,
}));

describe("registerStatusHealthSessionsCommands", () => {
  async function runCli(args: string[]) {
    const program = new Command();
    registerStatusHealthSessionsCommands(program);
    await program.parseAsync(args, { from: "user" });
  }

  function createZhProgram() {
    const program = new Command();
    setProgramContext(program, {
      programVersion: "9.9.9-test",
      locale: "zh-CN",
      t: createCliTranslator("zh-CN"),
      channelOptions: [],
      messageChannelOptions: "",
      agentChannelOptions: "last",
    });
    registerStatusHealthSessionsCommands(program);
    return program;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    runtime.exit.mockImplementation(() => {});
    statusCommand.mockResolvedValue(undefined);
    healthCommand.mockResolvedValue(undefined);
    sessionsCommand.mockResolvedValue(undefined);
    sessionsCleanupCommand.mockResolvedValue(undefined);
    tasksListCommand.mockResolvedValue(undefined);
    tasksAuditCommand.mockResolvedValue(undefined);
    tasksMaintenanceCommand.mockResolvedValue(undefined);
    tasksShowCommand.mockResolvedValue(undefined);
    tasksNotifyCommand.mockResolvedValue(undefined);
    tasksCancelCommand.mockResolvedValue(undefined);
    flowsListCommand.mockResolvedValue(undefined);
    flowsShowCommand.mockResolvedValue(undefined);
    flowsCancelCommand.mockResolvedValue(undefined);
  });

  it("runs status command with timeout and debug-derived verbose", async () => {
    await runCli([
      "status",
      "--json",
      "--all",
      "--deep",
      "--usage",
      "--debug",
      "--timeout",
      "5000",
    ]);

    expect(setVerbose).toHaveBeenCalledWith(true);
    expect(statusCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        all: true,
        deep: true,
        usage: true,
        timeoutMs: 5000,
        verbose: true,
      }),
      runtime,
    );
  });

  it("rejects invalid status timeout without calling status command", async () => {
    await runCli(["status", "--timeout", "nope"]);

    expect(runtime.error).toHaveBeenCalledWith(
      "--timeout must be a positive integer (milliseconds)",
    );
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(statusCommand).not.toHaveBeenCalled();
  });

  it("runs health command with parsed timeout", async () => {
    await runCli(["health", "--json", "--timeout", "2500", "--verbose"]);

    expect(setVerbose).toHaveBeenCalledWith(true);
    expect(healthCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        timeoutMs: 2500,
        verbose: true,
      }),
      runtime,
    );
  });

  it("rejects invalid health timeout without calling health command", async () => {
    await runCli(["health", "--timeout", "0"]);

    expect(runtime.error).toHaveBeenCalledWith(
      "--timeout must be a positive integer (milliseconds)",
    );
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(healthCommand).not.toHaveBeenCalled();
  });

  it("runs sessions command with forwarded options", async () => {
    await runCli([
      "sessions",
      "--json",
      "--verbose",
      "--store",
      "/tmp/sessions.json",
      "--active",
      "120",
    ]);

    expect(setVerbose).toHaveBeenCalledWith(true);
    expect(sessionsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        store: "/tmp/sessions.json",
        active: "120",
      }),
      runtime,
    );
  });

  it("runs sessions command with --agent forwarding", async () => {
    await runCli(["sessions", "--agent", "work"]);

    expect(sessionsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "work",
        allAgents: false,
      }),
      runtime,
    );
  });

  it("runs sessions command with --all-agents forwarding", async () => {
    await runCli(["sessions", "--all-agents"]);

    expect(sessionsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        allAgents: true,
      }),
      runtime,
    );
  });

  it("runs sessions cleanup subcommand with forwarded options", async () => {
    await runCli([
      "sessions",
      "cleanup",
      "--store",
      "/tmp/sessions.json",
      "--dry-run",
      "--enforce",
      "--fix-missing",
      "--active-key",
      "agent:main:main",
      "--json",
    ]);

    expect(sessionsCleanupCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        store: "/tmp/sessions.json",
        agent: undefined,
        allAgents: false,
        dryRun: true,
        enforce: true,
        fixMissing: true,
        activeKey: "agent:main:main",
        json: true,
      }),
      runtime,
    );
  });

  it("forwards parent-level all-agents to cleanup subcommand", async () => {
    await runCli(["sessions", "--all-agents", "cleanup", "--dry-run"]);

    expect(sessionsCleanupCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        allAgents: true,
      }),
      runtime,
    );
  });

  it("uses localized help copy when program context locale is zh-CN", () => {
    const program = createZhProgram();
    const status = program.commands.find((command) => command.name() === "status");
    const sessions = program.commands.find((command) => command.name() === "sessions");
    const tasks = program.commands.find((command) => command.name() === "tasks");
    const audit = tasks?.commands.find((command) => command.name() === "audit");
    const flow = tasks?.commands.find((command) => command.name() === "flow");

    expect(status?.description()).toBe("显示渠道健康状态和最近会话目标");
    expect(status?.options.find((option) => option.long === "--json")?.description).toBe(
      "输出 JSON 而不是文本",
    );
    expect(sessions?.description()).toBe("列出已存储的会话");
    expect(tasks?.description()).toBe("查看持久化后台任务状态");
    expect(audit?.description()).toBe("显示过期或损坏的后台任务与 TaskFlow");
    expect(flow?.description()).toBe("查看 tasks 下持久化 TaskFlow 状态");
  });

  it("runs tasks list from the parent command", async () => {
    await runCli(["tasks", "--json", "--runtime", "acp", "--status", "running"]);

    expect(tasksListCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        runtime: "acp",
        status: "running",
      }),
      runtime,
    );
  });

  it("runs tasks show subcommand with lookup forwarding", async () => {
    await runCli(["tasks", "show", "run-123", "--json"]);

    expect(tasksShowCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup: "run-123",
        json: true,
      }),
      runtime,
    );
  });

  it("runs tasks maintenance subcommand with apply forwarding", async () => {
    await runCli(["tasks", "--json", "maintenance", "--apply"]);

    expect(tasksMaintenanceCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        apply: true,
      }),
      runtime,
    );
  });

  it("runs tasks audit subcommand with filters", async () => {
    await runCli([
      "tasks",
      "--json",
      "audit",
      "--severity",
      "error",
      "--code",
      "stale_running",
      "--limit",
      "5",
    ]);

    expect(tasksAuditCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        severity: "error",
        code: "stale_running",
        limit: 5,
      }),
      runtime,
    );
  });

  it("routes tasks flow commands through the TaskFlow handlers", async () => {
    await runCli(["tasks", "flow", "list", "--json", "--status", "blocked"]);
    expect(flowsListCommand).toHaveBeenCalledWith(expect.any(Object), runtime);

    await runCli(["tasks", "flow", "show", "flow-123", "--json"]);
    expect(flowsShowCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup: "flow-123",
      }),
      runtime,
    );

    await runCli(["tasks", "flow", "cancel", "flow-123"]);
    expect(flowsCancelCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup: "flow-123",
      }),
      runtime,
    );
  });

  it("runs tasks notify subcommand with lookup and policy forwarding", async () => {
    await runCli(["tasks", "notify", "run-123", "state_changes"]);

    expect(tasksNotifyCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup: "run-123",
        notify: "state_changes",
      }),
      runtime,
    );
  });

  it("runs tasks cancel subcommand with lookup forwarding", async () => {
    await runCli(["tasks", "cancel", "run-123"]);

    expect(tasksCancelCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup: "run-123",
      }),
      runtime,
    );
  });

  it("does not register the legacy top-level flows command", () => {
    const program = new Command();
    registerStatusHealthSessionsCommands(program);

    expect(program.commands.find((command) => command.name() === "flows")).toBeUndefined();
  });

  it("documents JSON snapshot semantics in status help", () => {
    const program = new Command();
    registerStatusHealthSessionsCommands(program);

    let help = "";
    const status = program.commands.find((command) => command.name() === "status");
    status?.configureOutput({
      writeOut: (value) => {
        help += value;
      },
      writeErr: (value) => {
        help += value;
      },
    });
    status?.outputHelp();
    expect(help).toContain("Default `status --json` is a fast local snapshot");
    expect(help).toContain("use `--deep` or `--all`");
  });
});

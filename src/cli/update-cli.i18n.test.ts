import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createCliTranslator } from "./i18n/index.js";
import { setProgramContext } from "./program/program-context.js";
import { registerUpdateCli } from "./update-cli.js";

vi.mock("./update-cli/status.js", () => ({ updateStatusCommand: vi.fn() }));
vi.mock("./update-cli/update-command.js", () => ({ updateCommand: vi.fn() }));
vi.mock("./update-cli/wizard.js", () => ({ updateWizardCommand: vi.fn() }));

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
  return program;
}

describe("registerUpdateCli i18n", () => {
  it("localizes update help copy", () => {
    const program = createZhProgram();
    registerUpdateCli(program);

    const update = program.commands.find((command) => command.name() === "update");
    const status = update?.commands.find((command) => command.name() === "status");
    const wizard = update?.commands.find((command) => command.name() === "wizard");

    expect(update?.description()).toBe("更新 CrawClaw 并检查更新通道状态");
    expect(update?.helpInformation()).toContain("预览更新动作，不实际修改");
    expect(status?.description()).toBe("显示更新通道和版本状态");
    expect(status?.helpInformation()).toContain("更新检查超时时间");
    expect(wizard?.description()).toBe("交互式更新向导");
  });
});

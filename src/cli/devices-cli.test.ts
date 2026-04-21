import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerDevicesCli } from "./devices-cli.js";
import { createCliTranslator } from "./i18n/index.js";
import { setProgramContext } from "./program/program-context.js";

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

describe("registerDevicesCli", () => {
  it("localizes devices help copy", () => {
    const program = createZhProgram();
    registerDevicesCli(program);

    const devices = program.commands.find((command) => command.name() === "devices");
    const list = devices?.commands.find((command) => command.name() === "list");
    const approve = devices?.commands.find((command) => command.name() === "approve");
    const rotate = devices?.commands.find((command) => command.name() === "rotate");

    expect(devices?.description()).toBe("设备配对与 token 管理");
    expect(list?.description()).toBe("列出待审批和已配对设备");
    expect(list?.helpInformation()).toContain("Gateway WebSocket URL");
    expect(approve?.description()).toBe("批准待审批设备配对请求");
    expect(rotate?.helpInformation()).toContain("要附加到 token 的 scope");
  });
});

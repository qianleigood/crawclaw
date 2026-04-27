import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerChannelsCli } from "./channels-cli.js";
import { createProgramContext } from "./program/context.js";
import { setProgramContext } from "./program/program-context.js";

describe("registerChannelsCli", () => {
  it("localizes channels help copy", () => {
    const program = new Command();
    setProgramContext(
      program,
      createProgramContext({ argv: ["node", "crawclaw", "--lang", "zh-CN"] }),
    );

    registerChannelsCli(program);

    const channels = program.commands.find((command) => command.name() === "channels");
    const add = channels?.commands.find((command) => command.name() === "add");
    const status = channels?.commands.find((command) => command.name() === "status");
    const login = channels?.commands.find((command) => command.name() === "login");

    expect(channels?.description()).toBe("管理渠道配置；health/status 显示运行时健康");
    expect(add?.description()).toBe("新增或更新渠道账号");
    expect(add?.helpInformation()).toContain("机器人 token（Telegram/Discord）");
    expect(status?.description()).toBe("显示网关渠道状态（本地探测请用 status --deep）");
    expect(login?.description()).toBe("连接渠道账号（如果支持）");
  });
});

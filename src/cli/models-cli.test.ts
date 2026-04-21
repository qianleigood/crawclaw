import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createCliTranslator } from "./i18n/index.js";
import { registerModelsCli } from "./models-cli.js";
import { setProgramContext } from "./program/program-context.js";

vi.mock("../commands/models.js", () => ({
  modelsAliasesAddCommand: vi.fn(),
  modelsAliasesListCommand: vi.fn(),
  modelsAliasesRemoveCommand: vi.fn(),
  modelsAuthAddCommand: vi.fn(),
  modelsAuthLoginCommand: vi.fn(),
  modelsAuthOrderClearCommand: vi.fn(),
  modelsAuthOrderGetCommand: vi.fn(),
  modelsAuthOrderSetCommand: vi.fn(),
  modelsAuthPasteTokenCommand: vi.fn(),
  modelsAuthSetupTokenCommand: vi.fn(),
  modelsFallbacksAddCommand: vi.fn(),
  modelsFallbacksClearCommand: vi.fn(),
  modelsFallbacksListCommand: vi.fn(),
  modelsFallbacksRemoveCommand: vi.fn(),
  modelsImageFallbacksAddCommand: vi.fn(),
  modelsImageFallbacksClearCommand: vi.fn(),
  modelsImageFallbacksListCommand: vi.fn(),
  modelsImageFallbacksRemoveCommand: vi.fn(),
  modelsListCommand: vi.fn(),
  modelsScanCommand: vi.fn(),
  modelsSetCommand: vi.fn(),
  modelsSetImageCommand: vi.fn(),
  modelsStatusCommand: vi.fn(),
}));

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

describe("registerModelsCli", () => {
  it("localizes models help copy", () => {
    const program = createZhProgram();
    registerModelsCli(program);

    const models = program.commands.find((command) => command.name() === "models");
    const status = models?.commands.find((command) => command.name() === "status");
    const scan = models?.commands.find((command) => command.name() === "scan");
    const auth = models?.commands.find((command) => command.name() === "auth");
    const order = auth?.commands.find((command) => command.name() === "order");

    expect(models?.description()).toBe("发现、扫描并配置模型");
    expect(status?.description()).toBe("显示已配置模型状态");
    expect(status?.helpInformation()).toContain("认证过期/即将过期");
    expect(scan?.description()).toBe("扫描支持 tools + images 的 OpenRouter 免费模型");
    expect(auth?.description()).toBe("管理模型认证 profile");
    expect(order?.description()).toBe("管理每个 agent 的 auth profile 顺序覆盖");
  });
});

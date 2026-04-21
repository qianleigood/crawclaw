import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCliTranslator } from "../i18n/index.js";
import { setProgramContext } from "./program-context.js";
import { registerConfigureCommand } from "./register.configure.js";

const mocks = vi.hoisted(() => ({
  configureCommandFromSectionsArgMock: vi.fn(),
  runtime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  },
}));

const { configureCommandFromSectionsArgMock, runtime } = mocks;

vi.mock("../../commands/configure.js", () => ({
  CONFIGURE_WIZARD_SECTIONS: ["auth", "channels", "gateway", "agent"],
  configureCommandFromSectionsArg: mocks.configureCommandFromSectionsArgMock,
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: mocks.runtime,
}));

describe("registerConfigureCommand", () => {
  async function runCli(args: string[]) {
    const program = new Command();
    registerConfigureCommand(program);
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
    registerConfigureCommand(program);
    return program;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    configureCommandFromSectionsArgMock.mockResolvedValue(undefined);
  });

  it("forwards repeated --section values", async () => {
    await runCli(["configure", "--section", "auth", "--section", "channels"]);

    expect(configureCommandFromSectionsArgMock).toHaveBeenCalledWith(["auth", "channels"], runtime);
  });

  it("reports errors through runtime when configure command fails", async () => {
    configureCommandFromSectionsArgMock.mockRejectedValueOnce(new Error("configure failed"));

    await runCli(["configure"]);

    expect(runtime.error).toHaveBeenCalledWith("Error: configure failed");
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });

  it("uses localized help copy when program context locale is zh-CN", () => {
    const program = createZhProgram();
    const configure = program.commands.find((command) => command.name() === "configure");
    expect(configure?.description()).toBe("交互式配置凭据、渠道、网关和 agent 默认值");

    const sectionOption = configure?.options.find((option) => option.long === "--section");
    expect(sectionOption?.description).toContain("配置分区");
  });
});

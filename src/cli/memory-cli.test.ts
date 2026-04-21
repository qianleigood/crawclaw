import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { createCliTranslator } from "./i18n/index.js";
import { registerMemoryCli } from "./memory-cli.js";
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

describe("registerMemoryCli", () => {
  it("localizes memory help copy", () => {
    const program = createZhProgram();
    registerMemoryCli(program);

    const memory = program.commands.find((command) => command.name() === "memory");
    const status = memory?.commands.find((command) => command.name() === "status");
    const dream = memory?.commands.find((command) => command.name() === "dream");
    const promptJournalSummary = memory?.commands.find(
      (command) => command.name() === "prompt-journal-summary",
    );
    const sessionSummary = memory?.commands.find((command) => command.name() === "session-summary");

    expect(memory?.description()).toBe("查看和管理 NotebookLM 知识访问");
    expect(status?.description()).toBe("显示 NotebookLM 知识 provider 状态");
    expect(promptJournalSummary?.helpInformation()).toContain("读取指定 journal JSONL 文件");
    expect(dream?.description()).toBe("查看并运行 durable-memory dream 过程");
    expect(sessionSummary?.description()).toContain("逐 session summary");
  });
});

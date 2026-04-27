import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

async function importForHelpTest<T>(label: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import ${label}: ${message}`, { cause: error });
  }
}

async function createZhProgram() {
  const { createCliTranslator } = await importForHelpTest(
    "cli i18n",
    () => import("./i18n/index.js"),
  );
  const { setProgramContext } = await importForHelpTest(
    "program context",
    () => import("./program/program-context.js"),
  );
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

describe("sub CLI help i18n", () => {
  it("localizes small subcli help copy", async () => {
    vi.resetModules();
    const program = await createZhProgram();
    const { registerCompletionCli } = await importForHelpTest(
      "completion cli",
      () => import("./completion-cli.js"),
    );
    const { registerDnsCli } = await importForHelpTest("dns cli", () => import("./dns-cli.js"));
    const { registerDocsCli } = await importForHelpTest("docs cli", () => import("./docs-cli.js"));
    const { registerLogsCli } = await importForHelpTest("logs cli", () => import("./logs-cli.js"));

    registerCompletionCli(program);
    registerDnsCli(program);
    registerDocsCli(program);
    registerLogsCli(program);

    const completion = program.commands.find((command) => command.name() === "completion");
    const dns = program.commands.find((command) => command.name() === "dns");
    const dnsSetup = dns?.commands.find((command) => command.name() === "setup");
    const docs = program.commands.find((command) => command.name() === "docs");
    const logs = program.commands.find((command) => command.name() === "logs");

    expect(completion?.description()).toBe("生成 shell 补全脚本");
    expect(completion?.helpInformation()).toContain("将补全脚本安装到 shell profile");
    expect(dns?.description()).toBe("用于广域发现的 DNS 辅助工具（Tailscale + CoreDNS）");
    expect(dnsSetup?.description()).toContain("设置 CoreDNS");
    expect(docs?.description()).toBe("搜索在线 CrawClaw 文档");
    expect(logs?.description()).toBe("通过 RPC 跟随网关文件日志");
    expect(logs?.helpInformation()).toContain("返回的最大行数");
  });
});

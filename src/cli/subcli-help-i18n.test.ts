import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerClawbotCli } from "./clawbot-cli.js";
import { registerCompletionCli } from "./completion-cli.js";
import { registerDnsCli } from "./dns-cli.js";
import { registerDocsCli } from "./docs-cli.js";
import { createCliTranslator } from "./i18n/index.js";
import { registerLogsCli } from "./logs-cli.js";
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

describe("sub CLI help i18n", () => {
  it("localizes small subcli help copy", () => {
    const program = createZhProgram();

    registerClawbotCli(program);
    registerCompletionCli(program);
    registerDnsCli(program);
    registerDocsCli(program);
    registerLogsCli(program);

    const clawbot = program.commands.find((command) => command.name() === "clawbot");
    const completion = program.commands.find((command) => command.name() === "completion");
    const dns = program.commands.find((command) => command.name() === "dns");
    const dnsSetup = dns?.commands.find((command) => command.name() === "setup");
    const docs = program.commands.find((command) => command.name() === "docs");
    const logs = program.commands.find((command) => command.name() === "logs");

    expect(clawbot?.description()).toBe("旧版 clawbot 命令别名");
    expect(completion?.description()).toBe("生成 shell 补全脚本");
    expect(completion?.helpInformation()).toContain("将补全脚本安装到 shell profile");
    expect(dns?.description()).toBe("用于广域发现的 DNS 辅助工具（Tailscale + CoreDNS）");
    expect(dnsSetup?.description()).toContain("设置 CoreDNS");
    expect(docs?.description()).toBe("搜索在线 CrawClaw 文档");
    expect(logs?.description()).toBe("通过 RPC 跟随网关文件日志");
    expect(logs?.helpInformation()).toContain("返回的最大行数");
  });
});

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import type { HookStatusReport } from "../hooks/hooks-status.js";
import {
  formatHookInfo,
  formatHooksCheck,
  formatHooksList,
  registerHooksCli,
} from "./hooks-cli.js";
import { createCliTranslator, setActiveCliLocale } from "./i18n/index.js";
import { setProgramContext } from "./program/program-context.js";
import { createEmptyInstallChecks } from "./requirements-test-fixtures.js";

const report: HookStatusReport = {
  workspaceDir: "/tmp/workspace",
  managedHooksDir: "/tmp/hooks",
  hooks: [
    {
      name: "command-logger",
      description: "Log all command events to a centralized audit file",
      source: "crawclaw-bundled",
      pluginId: undefined,
      filePath: "/tmp/hooks/command-logger/HOOK.md",
      baseDir: "/tmp/hooks/command-logger",
      handlerPath: "/tmp/hooks/command-logger/handler.js",
      hookKey: "command-logger",
      emoji: "📝",
      homepage: "https://docs.crawclaw.ai/automation/hooks#command-logger",
      events: ["command"],
      always: false,
      enabledByConfig: true,
      requirementsSatisfied: true,
      loadable: true,
      blockedReason: undefined,
      managedByPlugin: false,
      ...createEmptyInstallChecks(),
    },
  ],
};

function createPluginManagedHookReport(): HookStatusReport {
  return {
    workspaceDir: "/tmp/workspace",
    managedHooksDir: "/tmp/hooks",
    hooks: [
      {
        name: "plugin-hook",
        description: "Hook from plugin",
        source: "crawclaw-plugin",
        pluginId: "voice-call",
        filePath: "/tmp/hooks/plugin-hook/HOOK.md",
        baseDir: "/tmp/hooks/plugin-hook",
        handlerPath: "/tmp/hooks/plugin-hook/handler.js",
        hookKey: "plugin-hook",
        emoji: "🔗",
        homepage: undefined,
        events: ["command:new"],
        always: false,
        enabledByConfig: true,
        requirementsSatisfied: true,
        loadable: true,
        blockedReason: undefined,
        managedByPlugin: true,
        ...createEmptyInstallChecks(),
      },
    ],
  };
}

describe("hooks cli formatting", () => {
  it("labels hooks list output", () => {
    const output = formatHooksList(report, {});
    expect(output).toContain("Hooks");
    expect(output).not.toContain("Internal Hooks");
  });

  it("labels hooks status output", () => {
    const output = formatHooksCheck(report, {});
    expect(output).toContain("Hooks Status");
  });

  it("labels plugin-managed hooks with plugin id", () => {
    const pluginReport = createPluginManagedHookReport();

    const output = formatHooksList(pluginReport, {});
    expect(output).toContain("plugin:voice-call");
  });

  it("shows plugin-managed details in hook info", () => {
    const pluginReport = createPluginManagedHookReport();

    const output = formatHookInfo(pluginReport, "plugin-hook", {});
    expect(output).toContain("voice-call");
    expect(output).toContain("Managed by plugin");
  });

  it("localizes runtime hook output in zh-CN", () => {
    setActiveCliLocale("zh-CN");
    try {
      const listOutput = formatHooksList(report, {});
      const infoOutput = formatHookInfo(createPluginManagedHookReport(), "plugin-hook", {});
      const checkOutput = formatHooksCheck(report, {});

      expect(listOutput).toContain("可用");
      expect(listOutput).toContain("状态");
      expect(infoOutput).toContain("详情：");
      expect(infoOutput).toContain("由插件管理");
      expect(checkOutput).toContain("Hooks 状态");
    } finally {
      setActiveCliLocale("en");
    }
  });

  it("localizes hooks help copy", () => {
    const program = new Command();
    setProgramContext(program, {
      programVersion: "9.9.9-test",
      locale: "zh-CN",
      t: createCliTranslator("zh-CN"),
      channelOptions: [],
      messageChannelOptions: "",
      agentChannelOptions: "last",
    });
    registerHooksCli(program);

    const hooks = program.commands.find((command) => command.name() === "hooks");
    const list = hooks?.commands.find((command) => command.name() === "list");
    const install = hooks?.commands.find((command) => command.name() === "install");

    expect(hooks?.description()).toBe("管理内部 agent hooks");
    expect(list?.description()).toBe("列出所有 hooks");
    expect(list?.helpInformation()).toContain("只显示可用 hooks");
    expect(install?.description()).toContain("已废弃");
  });
});

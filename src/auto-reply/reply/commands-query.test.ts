import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import {
  buildRuntimesQueryReply,
  buildSessionsQueryReply,
  buildSkillsQueryReply,
  handleQueryCommand,
} from "./commands-query.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const baseCfg = {
  commands: { text: true },
  cli: { language: "zh-CN" },
} as CrawClawConfig;

describe("slash query commands", () => {
  it("lists skills with localized framing", () => {
    const reply = buildSkillsQueryReply({
      cfg: baseCfg,
      skillCommands: [
        { name: "docs", description: "Search docs" },
        { name: "github", description: "GitHub" },
      ],
    });

    expect(reply.text).toContain("🧰 技能");
    expect(reply.text).toContain("/docs - Search docs");
    expect(reply.text).toContain("提示：/skills 列出命令；/skill <name> [input] 运行单个技能。");
  });

  it("lists recent sessions without mutating the store", () => {
    const reply = buildSessionsQueryReply({
      cfg: baseCfg,
      sessionStore: {
        main: { sessionId: "sess-main", updatedAt: 2000 },
        "agent:main:subagent:demo": { sessionId: "sess-sub", updatedAt: 1000 },
      },
      now: 3000,
    });

    expect(reply.text).toContain("💬 会话");
    expect(reply.text).toContain("2 个活跃会话");
    expect(reply.text).toContain("main");
    expect(reply.text).toContain("agent:main:subagent:demo");
    expect(reply.text).toContain("/sessions 只读");
  });

  it("summarizes runtime manifest entries", () => {
    const reply = buildRuntimesQueryReply({
      cfg: baseCfg,
      manifestPath: "/tmp/manifest.json",
      manifest: {
        plugins: {
          browser: { state: "healthy", package: "pinchtab@1.0.0" },
          "open-websearch": { state: "missing", reason: "not installed" },
        },
      },
    });

    expect(reply.text).toContain("🧩 运行时");
    expect(reply.text).toContain("browser: healthy");
    expect(reply.text).toContain("open-websearch: missing");
    expect(reply.text).toContain("/runtimes 显示安装状态");
  });

  it("handles /skills through the command pipeline", async () => {
    const params = buildCommandTestParams("/skills", baseCfg);
    params.skillCommands = [{ name: "docs", skillName: "docs", description: "Search docs" }];

    const result = await handleQueryCommand(params, true);

    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("/docs - Search docs");
  });

  it("does not handle removed approval query shell", async () => {
    const result = await handleQueryCommand(buildCommandTestParams("/approvals", baseCfg), true);

    expect(result).toBeNull();
  });
});

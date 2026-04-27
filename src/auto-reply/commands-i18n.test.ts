import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { localizeSlashCommandReplyText } from "./commands-i18n.js";

const zhCfg = { cli: { language: "zh-CN" } } as CrawClawConfig;

describe("localizeSlashCommandReplyText", () => {
  it("localizes generic usage and hint prefixes", () => {
    const text = [
      "Usage: /workflow <status|cancel|resume> <executionId> [input]",
      "Examples:",
      "Try: /models openai 2",
      "More: /models openai 3",
      "All: /models openai all",
      "Switch: /model <provider/model>",
      "Tip: use /skill <name> [input] to run a skill.",
    ].join("\n");

    expect(localizeSlashCommandReplyText(text, zhCfg)).toBe(
      [
        "用法：/workflow <status|cancel|resume> <executionId> [input]",
        "示例：",
        "试试：/models openai 2",
        "更多：/models openai 3",
        "全部：/models openai all",
        "切换：/model <provider/model>",
        "提示：use /skill <name> [input] to run a skill.",
      ].join("\n"),
    );
  });

  it("localizes exact command prompt messages", () => {
    expect(localizeSlashCommandReplyText("Invalid /debug syntax.", zhCfg)).toBe(
      "无效的 /debug 语法。",
    );
    expect(
      localizeSlashCommandReplyText(
        "⚠️ /btw requires an active session with existing context.",
        zhCfg,
      ),
    ).toBe("⚠️ /btw 需要一个已存在上下文的活动会话。");
  });
});

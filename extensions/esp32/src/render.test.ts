import { describe, expect, it } from "vitest";
import { renderEsp32Reply } from "./render.js";

describe("renderEsp32Reply", () => {
  it("compresses long technical replies into short voice-first output", async () => {
    const rendered = await renderEsp32Reply({
      text: [
        "可以，下面是完整实现：",
        "```ts",
        "console.log('hello world')",
        "```",
        "/Users/qianlei/crawclaw/src/foo.ts:12",
        "- 第一步：打开文件",
        "- 第二步：运行测试",
        "最终结论是系统已经启动，但 ESP32 只需要听到一句短反馈。",
      ].join("\n"),
      config: {
        maxSpokenChars: 40,
        maxDisplayChars: 72,
      },
    });

    expect(rendered.spokenText.length).toBeLessThanOrEqual(40);
    expect(rendered.displayText.length).toBeLessThanOrEqual(72);
    expect(rendered.spokenText).not.toContain("console.log");
    expect(rendered.spokenText).not.toContain("/Users/");
    expect(rendered.affect.state).toBe("neutral");
  });

  it("accepts strict renderer JSON then applies the algorithmic hard gate", async () => {
    const rendered = await renderEsp32Reply({
      text: "unused fallback",
      renderer: async () =>
        JSON.stringify({
          spokenText: '已完成。```json\n{"ok":true}\n```这段很长很长很长很长很长很长很长很长很长',
          displayText: "完成",
          affect: { state: "success", expression: "ok" },
        }),
      config: {
        maxSpokenChars: 20,
        maxDisplayChars: 8,
      },
    });

    expect(rendered.spokenText.length).toBeLessThanOrEqual(20);
    expect(rendered.spokenText).toMatch(/^已完成。这段/);
    expect(rendered.spokenText).not.toContain(" ");
    expect(rendered.spokenText).not.toContain("{");
    expect(rendered.displayText).toBe("完成");
    expect(rendered.affect).toMatchObject({ state: "success", expression: "ok" });
  });

  it("falls back to deterministic rendering when renderer output is invalid", async () => {
    const rendered = await renderEsp32Reply({
      text: "抱歉，这次设备离线了，我会保留完整结果在 CrawClaw 会话里。",
      renderer: async () => "not json",
      config: {
        maxSpokenChars: 32,
        maxDisplayChars: 32,
      },
    });

    expect(rendered.spokenText).toContain("抱歉");
    expect(rendered.affect.state).toBe("apologetic");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/index.js";
import { stripAnsi } from "../terminal/ansi.js";
import {
  createTuiStatusLineController,
  formatIdleStatusText,
  formatStatusElapsed,
  isBusyStatus,
} from "./tui-status-line.js";

describe("tui status line", () => {
  afterEach(() => {
    setActiveCliLocale("en");
  });

  it("classifies long-running activity states as busy", () => {
    expect(isBusyStatus("sending")).toBe(true);
    expect(isBusyStatus("waiting")).toBe(true);
    expect(isBusyStatus("streaming")).toBe(true);
    expect(isBusyStatus("running")).toBe(true);
    expect(isBusyStatus("idle")).toBe(false);
    expect(isBusyStatus("error")).toBe(false);
  });

  it("formats elapsed time compactly", () => {
    expect(formatStatusElapsed(1_000, 8_900)).toBe("7s");
    expect(formatStatusElapsed(1_000, 68_000)).toBe("1m 7s");
  });

  it("formats idle connection and activity text", () => {
    expect(formatIdleStatusText("connected", "idle")).toBe("connected | idle");
    expect(formatIdleStatusText("connected", "")).toBe("connected");
  });

  it("localizes idle status text in zh-CN", () => {
    setActiveCliLocale("zh-CN");

    expect(formatIdleStatusText("connected", "idle")).toBe("已连接 | 空闲");
  });

  it("localizes busy status text in zh-CN", () => {
    setActiveCliLocale("zh-CN");
    const children: Array<{ render: (width: number) => string[] }> = [];
    const controller = createTuiStatusLineController({
      tui: { requestRender: vi.fn() } as never,
      statusContainer: {
        clear: () => {
          children.length = 0;
        },
        addChild: (child: { render: (width: number) => string[] }) => {
          children.push(child);
        },
      } as never,
      getConnectionStatus: () => "connected",
      setConnectionStatusValue: vi.fn(),
      getActivityStatus: () => "running",
      setActivityStatusValue: vi.fn(),
      getIsConnected: () => true,
      getStatusTimeout: () => null,
      setStatusTimeout: vi.fn(),
    });

    controller.renderStatus();

    const rendered = stripAnsi(children[0]?.render(80).join("\n") ?? "");
    expect(rendered).toContain("运行中");
    expect(rendered).toContain("已连接");
    expect(rendered).not.toContain("running");
    expect(rendered).not.toContain("connected");

    controller.stop();
  });

  it("localizes waiting status text in zh-CN", () => {
    setActiveCliLocale("zh-CN");
    const children: Array<{ render: (width: number) => string[] }> = [];
    const controller = createTuiStatusLineController({
      tui: { requestRender: vi.fn() } as never,
      statusContainer: {
        clear: () => {
          children.length = 0;
        },
        addChild: (child: { render: (width: number) => string[] }) => {
          children.push(child);
        },
      } as never,
      getConnectionStatus: () => "connected",
      setConnectionStatusValue: vi.fn(),
      getActivityStatus: () => "waiting",
      setActivityStatusValue: vi.fn(),
      getIsConnected: () => true,
      getStatusTimeout: () => null,
      setStatusTimeout: vi.fn(),
    });

    controller.renderStatus();

    const rendered = stripAnsi(children[0]?.render(80).join("\n") ?? "");
    expect(rendered).toContain("已连接");
    expect(
      [
        "思考中",
        "整理上下文",
        "等待回复",
        "分析中",
        "处理请求",
        "准备输出",
        "检查工具",
        "汇总结果",
        "生成回复",
        "继续处理",
      ].some((phrase) => rendered.includes(phrase)),
    ).toBe(true);
    expect(rendered).not.toContain("flibbertigibbeting");
    expect(rendered).not.toContain("kerfuffling");
    expect(rendered).not.toContain("connected");

    controller.stop();
  });
});

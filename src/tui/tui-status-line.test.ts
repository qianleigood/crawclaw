import { describe, expect, it } from "vitest";
import { formatIdleStatusText, formatStatusElapsed, isBusyStatus } from "./tui-status-line.js";

describe("tui status line", () => {
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
});

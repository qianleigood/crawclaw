import { describe, expect, it } from "vitest";
import { formatTuiFirstScreenHint } from "./tui-discovery.js";

describe("tui discovery hints", () => {
  it("keeps the first-screen hint short and actionable", () => {
    const hint = formatTuiFirstScreenHint();

    expect(hint).toContain("/help");
    expect(hint).toContain("Ctrl+L");
    expect(hint).toContain("Ctrl+G");
    expect(hint).toContain("Ctrl+P");
    expect(hint).toContain("Ctrl+O");
    expect(hint.length).toBeLessThanOrEqual(120);
  });
});

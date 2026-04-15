import { describe, expect, it } from "vitest";
import {
  resolveToolLoopBehavior,
  resolveToolLoopCategory,
} from "./tool-loop-behavior.js";

describe("tool-loop-behavior", () => {
  it("classifies polling tools from params", () => {
    expect(resolveToolLoopCategory("process", { action: "poll" })).toBe("poll");
    expect(resolveToolLoopBehavior("process", { action: "poll" }).isPollingTool).toBe(true);
  });

  it("classifies write and fetch style tools", () => {
    expect(resolveToolLoopCategory("write", { path: "/tmp/file.txt" })).toBe("write");
    expect(resolveToolLoopCategory("web_fetch", { url: "https://example.com" })).toBe("fetch");
  });

  it("returns conservative defaults for unknown tools", () => {
    expect(resolveToolLoopBehavior("custom_tool", { foo: "bar" })).toMatchObject({
      category: "other",
      supportsExactRetry: true,
      isPollingTool: false,
    });
  });
});

import { describe, expect, it } from "vitest";
import { splitSdkTools } from "./pi-embedded-runner.js";
import { createStubTool } from "./test-helpers/pi-tool-stubs.js";

describe("splitSdkTools", () => {
  const tools = [
    createStubTool("read"),
    createStubTool("exec"),
    createStubTool("edit"),
    createStubTool("write"),
    createStubTool("browser"),
  ];

  it("routes all tools to customTools by default", () => {
    const { builtInTools, customTools } = splitSdkTools({
      tools,
    });
    expect(builtInTools).toEqual([]);
    expect(customTools.map((tool) => tool.name)).toEqual([
      "read",
      "exec",
      "edit",
      "write",
      "browser",
    ]);
  });

  it("can pin selected tools into builtInTools for native provider exposure", () => {
    const { builtInTools, customTools } = splitSdkTools({
      tools,
      preferBuiltInToolNames: new Set(["browser", "read"]),
    });

    expect(builtInTools).toEqual(["read"]);
    expect(customTools.map((tool) => tool.name)).toEqual(["exec", "edit", "write", "browser"]);
  });
});

import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCrawClawRuntimeTool } from "../agents/runtime-tools/native.js";
import { finalizeInboundContextWithRust } from "./inbound-policy-runtime.js";

vi.mock("../agents/runtime-tools/native.js", () => ({
  runCrawClawRuntimeTool: vi.fn(),
}));

const runRuntimeTool = vi.mocked(runCrawClawRuntimeTool);

describe("finalizeInboundContextWithRust", () => {
  beforeEach(() => {
    runRuntimeTool.mockReset();
  });

  it("uses the Rust message policy worker operation", async () => {
    runRuntimeTool.mockResolvedValue({
      ctx: {
        Body: "hello",
        BodyForAgent: "hello",
        BodyForCommands: "hello",
        CommandAuthorized: false,
      },
    });

    const result = await finalizeInboundContextWithRust({
      Body: "hello",
    });

    expect(result.CommandAuthorized).toBe(false);
    expect(runRuntimeTool).toHaveBeenCalledWith(
      "message_policy",
      {
        operation: "inbound.finalizeContext",
        payload: {
          ctx: { Body: "hello" },
          opts: {},
        },
      },
      { timeoutMs: 30_000 },
    );
  });

  it("passes force options to Rust", async () => {
    runRuntimeTool.mockResolvedValue({
      ctx: {
        Body: "base",
        BodyForAgent: "base",
        BodyForCommands: "say hi",
        CommandAuthorized: false,
      },
    });

    const result = await finalizeInboundContextWithRust(
      {
        Body: "base",
        CommandBody: "say hi",
      },
      { forceBodyForCommands: true },
    );

    expect(result.BodyForCommands).toBe("say hi");
    expect(runRuntimeTool).toHaveBeenCalledWith(
      "message_policy",
      expect.objectContaining({
        payload: expect.objectContaining({
          opts: { forceBodyForCommands: true },
        }),
      }),
      expect.any(Object),
    );
  });

  it("keeps async inbound dispatch on the Rust policy adapter", () => {
    const source = fs.readFileSync(new URL("./dispatch.ts", import.meta.url), "utf8");

    expect(source).toContain("./inbound-policy-runtime.js");
    expect(source).not.toContain("../channels/inbound-context.js");
  });
});

import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCrawClawRuntimeTool } from "../../agents/runtime-tools/native.js";
import type { CrawClawConfig } from "../../config/config.js";
import {
  enforceRustCrossContextPolicy,
  resolveRustOutboundFallbackSessionRoute,
} from "./message-policy-runtime.js";

vi.mock("../../agents/runtime-tools/native.js", () => ({
  runCrawClawRuntimeTool: vi.fn(),
}));

const runRuntimeTool = vi.mocked(runCrawClawRuntimeTool);

describe("message policy runtime adapter", () => {
  beforeEach(() => {
    runRuntimeTool.mockReset();
  });

  it("routes cross-provider outbound policy decisions through Rust", async () => {
    runRuntimeTool.mockResolvedValue({ allowed: true });

    await enforceRustCrossContextPolicy({
      cfg: {
        tools: {
          message: {
            crossContext: {
              allowAcrossProviders: true,
            },
          },
        },
      } as CrawClawConfig,
      channel: "telegram",
      action: "send",
      args: { to: "telegram:@ops" },
      toolContext: {
        currentChannelId: "C123",
        currentChannelProvider: "slack",
      },
    });

    expect(runRuntimeTool).toHaveBeenCalledWith(
      "message_policy",
      {
        operation: "outbound.enforceCrossContextPolicy",
        payload: expect.objectContaining({
          channel: "telegram",
          action: "send",
          args: { to: "telegram:@ops" },
        }),
      },
      expect.objectContaining({
        timeoutMs: 30_000,
      }),
    );
  });

  it("surfaces Rust cross-context policy denial", async () => {
    runRuntimeTool.mockRejectedValue(new Error("Cross-context messaging denied"));

    await expect(
      enforceRustCrossContextPolicy({
        cfg: {} as CrawClawConfig,
        channel: "telegram",
        action: "send",
        args: { to: "telegram:@ops" },
        toolContext: {
          currentChannelId: "C123",
          currentChannelProvider: "slack",
        },
      }),
    ).rejects.toThrow("Cross-context messaging denied");
  });

  it("keeps no-context sends on the local fast path", async () => {
    await enforceRustCrossContextPolicy({
      cfg: {} as CrawClawConfig,
      channel: "slack",
      action: "send",
      args: { to: "channel:C123" },
    });

    expect(runRuntimeTool).not.toHaveBeenCalled();
  });

  it("resolves fallback outbound session routes through Rust", async () => {
    runRuntimeTool.mockResolvedValue({
      route: {
        sessionKey: "agent:main:generic:direct:u123",
        baseSessionKey: "agent:main:generic:direct:u123",
        peer: { kind: "direct", id: "u123" },
        chatType: "direct",
        from: "generic:u123",
        to: "user:u123",
      },
    });

    const route = await resolveRustOutboundFallbackSessionRoute({
      cfg: { session: { dmScope: "per-channel-peer" } } as CrawClawConfig,
      channel: "generic",
      agentId: "main",
      target: "user:u123",
      resolvedTarget: {
        kind: "user",
        to: "user:u123",
        source: "directory",
      },
    });

    expect(route?.sessionKey).toBe("agent:main:generic:direct:u123");
    expect(runRuntimeTool).toHaveBeenCalledWith(
      "message_policy",
      expect.objectContaining({
        operation: "outbound.resolveFallbackSessionRoute",
      }),
      expect.any(Object),
    );
  });

  it("keeps the async outbound runner on the Rust policy adapter", () => {
    const source = fs.readFileSync(new URL("./message-action-runner.ts", import.meta.url), "utf8");

    expect(source).toContain("./message-policy-runtime.js");
    expect(source).not.toMatch(/\benforceCrossContextPolicy\b/);
  });
});

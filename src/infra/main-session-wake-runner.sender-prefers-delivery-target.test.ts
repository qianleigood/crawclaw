import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { runMainSessionWakeOnce } from "./main-session-wake-runner.js";
import { installMainSessionWakeRunnerTestRuntime } from "./main-session-wake-runner.test-harness.js";
import {
  seedMainSessionStore,
  withTempHeartbeatSandbox,
} from "./main-session-wake-runner.test-utils.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

installMainSessionWakeRunnerTestRuntime({ includeSlack: true });

describe("runMainSessionWakeOnce", () => {
  beforeEach(() => {
    resetSystemEventsForTest();
  });

  afterEach(() => {
    resetSystemEventsForTest();
  });

  it("uses the delivery target as sender when lastTo differs", async () => {
    await withTempHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const cfg: CrawClawConfig = {
          agents: {
            defaults: {
              workspace: tmpDir,
              heartbeat: {
                target: "slack",
                to: "C0A9P2N8QHY",
              },
            },
          },
          session: { store: storePath },
        };

        const sessionKey = await seedMainSessionStore(storePath, cfg, {
          lastChannel: "telegram",
          lastProvider: "telegram",
          lastTo: "1644620762",
        });
        enqueueSystemEvent("Test system event", { sessionKey, contextKey: "test:wake" });

        replySpy.mockImplementation(async (ctx: { To?: string; From?: string }) => {
          expect(ctx.To).toBe("C0A9P2N8QHY");
          expect(ctx.From).toBe("C0A9P2N8QHY");
          return { text: "ok" };
        });

        const sendSlack = vi.fn().mockResolvedValue({
          messageId: "m1",
          channelId: "C0A9P2N8QHY",
        });

        await runMainSessionWakeOnce({
          cfg,
          reason: "wake",
          deps: {
            slack: sendSlack,
            getQueueSize: () => 0,
            nowMs: () => 0,
          },
        });

        expect(sendSlack).toHaveBeenCalled();
      },
      { prefix: "crawclaw-hb-" },
    );
  });
});

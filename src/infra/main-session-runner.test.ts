import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as replyModule from "../auto-reply/reply.js";
import type { CrawClawConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { runMainSessionOnce } from "./main-session-runner.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

afterEach(() => {
  resetSystemEventsForTest();
  vi.restoreAllMocks();
});

describe("main-session wake runner", () => {
  it("runs queued system events even when legacy agent heartbeat cadence is disabled", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-main-wake-"));
    const storePath = path.join(tmpDir, "sessions.json");
    const cfg: CrawClawConfig = {
      agents: {
        defaults: {
          workspace: tmpDir,
          heartbeat: { every: "0m", target: "none" },
        },
      },
      session: { store: storePath },
    };
    const sessionKey = resolveMainSessionKey(cfg);
    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: "sid",
          updatedAt: Date.now(),
          lastChannel: "telegram",
          lastProvider: "telegram",
          lastTo: "15551234567",
        },
      }),
    );
    enqueueSystemEvent("Background task completed: report is ready.", { sessionKey });
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig").mockResolvedValue({
      text: "Report is ready.",
    });

    try {
      const result = await runMainSessionOnce({
        cfg,
        sessionKey,
        reason: "background-task",
        deps: {
          getQueueSize: () => 0,
          nowMs: () => Date.UTC(2026, 3, 21, 9, 0, 0),
        },
      });

      expect(result.status).toBe("ran");
      expect(replySpy).toHaveBeenCalledTimes(1);
      const ctx = replySpy.mock.calls[0]?.[0] as { Body?: string; Provider?: string };
      expect(ctx.Provider).toBe("system-event");
      expect(ctx.Body).toContain("queued system events");
      expect(ctx.Body).not.toContain("HEARTBEAT.md");
      expect(ctx.Body).not.toContain("HEARTBEAT_OK");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

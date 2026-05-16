import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";

const note = vi.hoisted(() => vi.fn());

vi.mock("../terminal/note.js", () => ({
  note,
}));

import { checkNotebookLmMemoryHealth, noteMemoryHealth } from "./doctor-memory-health.js";

describe("doctor-memory-health", () => {
  beforeEach(() => {
    note.mockReset();
  });

  it("reports removed NotebookLM runtime when it is still enabled in config", async () => {
    const result = await checkNotebookLmMemoryHealth({
      memory: {
        notebooklm: {
          enabled: true,
        },
      },
    } as CrawClawConfig);

    expect(result.level).toBe("warn");
    expect(result.lifecycle).toBe("removed");
    expect(result.reason).toBe("notebooklm_removed");
    expect(result.recommendedAction).toContain("Disable memory.notebooklm");
  });

  it("renders memory health note with recommended actions", async () => {
    await noteMemoryHealth({} as CrawClawConfig, {
      summary: {
        overall: "warn",
        notebooklm: {
          kind: "notebooklm",
          level: "warn",
          enabled: true,
          lifecycle: "removed",
          ready: false,
          reason: "notebooklm_removed",
          profile: "default",
          recommendedAction: "crawclaw memory status",
        },
        durable: {
          kind: "durable",
          level: "ok",
          rootDir: "/tmp/durable",
          rootExists: true,
          parentWritable: true,
          rootWritable: true,
          extractionEnabled: true,
          extractionMaxNotesPerTurn: 2,
          extractionMinEligibleTurnsBetweenRuns: 1,
          extractionMaxConcurrentWorkers: 2,
          extractionWorkerIdleTtlMs: 900000,
          extractionWorkers: {
            workerCount: 0,
            runningCount: 0,
            queuedCount: 0,
            idleWorkers: 0,
            cooldownWorkers: 0,
          },
          markdownFilesScanned: 0,
          manifestReadable: true,
          parseErrors: [],
        },
        session: {
          kind: "session",
          level: "warn",
          dbPath: "/tmp/runtime.db",
          dbExists: false,
          parentWritable: true,
          storeAccessible: false,
          sessionTableAccessible: false,
          contextAssemblyTableAccessible: false,
          recommendedAction: "Run CrawClaw once to initialize /tmp/runtime.db",
        },
      },
    });

    expect(note).toHaveBeenCalledTimes(1);
    const [message, title] = note.mock.calls[0] ?? [];
    expect(title).toBe("Memory health");
    expect(String(message)).toContain("NotebookLM experience: warn");
    expect(String(message)).toContain("Durable memory: ok");
    expect(String(message)).toContain("Session memory: warn");
    expect(String(message)).toContain("Recommended actions:");
  });
});

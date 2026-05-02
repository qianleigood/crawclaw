import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";

const note = vi.hoisted(() => vi.fn());
const getNotebookLmProviderState = vi.hoisted(() => vi.fn());

vi.mock("../terminal/note.js", () => ({
  note,
}));

vi.mock("../memory/notebooklm/provider-state.ts", () => ({
  getNotebookLmProviderState,
}));

vi.mock("../memory/durable/worker-manager.ts", () => ({
  getSharedDurableExtractionWorkerManagerStatus: vi.fn(() => null),
}));

import { checkNotebookLmMemoryHealth, noteMemoryHealth } from "./doctor-memory-health.js";

describe("doctor-memory-health", () => {
  beforeEach(() => {
    note.mockReset();
    getNotebookLmProviderState.mockReset();
  });

  it("maps notebooklm provider state into doctor health", async () => {
    getNotebookLmProviderState.mockResolvedValue({
      enabled: true,
      ready: false,
      lifecycle: "expired",
      reason: "auth_expired",
      profile: "default",
      notebookId: "nb-1",
      refreshAttempted: false,
      refreshSucceeded: false,
      lastValidatedAt: "2026-04-05T00:00:00.000Z",
      recommendedAction: "crawclaw memory login",
    });

    const result = await checkNotebookLmMemoryHealth({} as CrawClawConfig);

    expect(result.level).toBe("warn");
    expect(result.lifecycle).toBe("expired");
    expect(result.reason).toBe("auth_expired");
    expect(result.recommendedAction).toBe("crawclaw memory login");
  });

  it("renders memory health note with recommended actions", async () => {
    await noteMemoryHealth({} as CrawClawConfig, {
      summary: {
        overall: "warn",
        notebooklm: {
          kind: "notebooklm",
          level: "warn",
          enabled: true,
          lifecycle: "degraded",
          ready: false,
          reason: "unknown",
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";

const loadConfig = vi.hoisted(() => vi.fn(() => ({}) as CrawClawConfig));
const resolveDefaultAgentId = vi.hoisted(() => vi.fn(() => "main"));
const resolveDoctorMemoryHealth = vi.hoisted(() =>
  vi.fn(async () => ({
    overall: "warn",
    notebooklm: {
      kind: "notebooklm",
      level: "warn",
      enabled: true,
      lifecycle: "degraded",
      ready: false,
      reason: "auth_expired",
      profile: "default",
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
      level: "ok",
      dbPath: "/tmp/runtime.db",
      dbExists: true,
      parentWritable: true,
      storeAccessible: true,
      sessionTableAccessible: true,
      contextAssemblyTableAccessible: true,
    },
  })),
);

vi.mock("../../config/config.js", () => ({
  loadConfig,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId,
}));

vi.mock("../../commands/doctor-memory-health.js", () => ({
  resolveDoctorMemoryHealth,
}));

import { doctorHandlers } from "./doctor.js";

describe("doctor.memory.status", () => {
  beforeEach(() => {
    loadConfig.mockClear();
    resolveDefaultAgentId.mockClear();
  });

  it("returns the new memory health summary", async () => {
    const respond = vi.fn();

    await doctorHandlers["doctor.memory.status"]({
      req: {} as never,
      params: {} as never,
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        agentId: "main",
        memoryHealth: expect.objectContaining({
          overall: "warn",
          notebooklm: expect.objectContaining({
            lifecycle: "degraded",
            reason: "auth_expired",
          }),
        }),
      },
      undefined,
    );
  });
});

import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../cli/deps.js";
import type { CrawClawConfig } from "../config/config.js";
import { SsrFBlockedError } from "../infra/net/ssrf.js";
import { mergeMockedModule } from "../test-utils/vitest-module-mocks.js";

const {
  enqueueSystemEventMock,
  requestHeartbeatNowMock,
  loadConfigMock,
  fetchWithSsrFGuardMock,
  runCronIsolatedAgentTurnMock,
  runMainSessionOnceMock,
} = vi.hoisted(() => ({
  enqueueSystemEventMock: vi.fn(),
  requestHeartbeatNowMock: vi.fn(),
  loadConfigMock: vi.fn(),
  fetchWithSsrFGuardMock: vi.fn(),
  runCronIsolatedAgentTurnMock: vi.fn(async () => ({ status: "ok" as const, summary: "ok" })),
  runMainSessionOnceMock: vi.fn(async () => ({ status: "ran" as const, durationMs: 1 })),
}));

function enqueueSystemEvent(...args: unknown[]) {
  return enqueueSystemEventMock(...args);
}

function requestHeartbeatNow(...args: unknown[]) {
  return requestHeartbeatNowMock(...args);
}

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent,
}));

vi.mock("../infra/heartbeat-wake.js", async (importOriginal) => {
  return await mergeMockedModule(
    await importOriginal<typeof import("../infra/heartbeat-wake.js")>(),
    () => ({
      requestHeartbeatNow,
    }),
  );
});

vi.mock("../infra/main-session-runner.js", () => ({
  requestMainSessionWake: requestHeartbeatNow,
  runMainSessionOnce: runMainSessionOnceMock,
}));

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: () => loadConfigMock(),
  };
});

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
}));

vi.mock("../cron/isolated-agent.js", () => ({
  runCronIsolatedAgentTurn: runCronIsolatedAgentTurnMock,
}));

import { buildGatewayCronService } from "./server-cron.js";

function createCronConfig(name: string): CrawClawConfig {
  const tmpDir = path.join(os.tmpdir(), `${name}-${Date.now()}`);
  return {
    session: {
      mainKey: "main",
    },
    cron: {
      store: path.join(tmpDir, "cron.json"),
    },
  } as CrawClawConfig;
}

describe("buildGatewayCronService", () => {
  beforeEach(() => {
    enqueueSystemEventMock.mockClear();
    requestHeartbeatNowMock.mockClear();
    loadConfigMock.mockClear();
    fetchWithSsrFGuardMock.mockClear();
    runCronIsolatedAgentTurnMock.mockClear();
    runMainSessionOnceMock.mockClear();
    runMainSessionOnceMock.mockResolvedValue({ status: "ran", durationMs: 1 });
  });

  it("normalizes legacy wake mode while routing main-target jobs to the scoped session", async () => {
    const cfg = createCronConfig("server-cron");
    loadConfigMock.mockReturnValue(cfg);

    const state = buildGatewayCronService({
      cfg,
      deps: {} as CliDeps,
      broadcast: () => {},
    });
    try {
      const job = await state.cron.add({
        name: "canonicalize-session-key",
        enabled: true,
        schedule: { kind: "at", at: new Date(1).toISOString() },
        sessionTarget: "main",
        wakeMode: "now",
        sessionKey: "discord:channel:ops",
        payload: { kind: "systemEvent", text: "hello" },
      });
      expect(job.wakeMode).toBe("now");

      await state.cron.run(job.id, "force");

      expect(enqueueSystemEventMock).toHaveBeenCalledWith(
        "hello",
        expect.objectContaining({
          sessionKey: "agent:main:discord:channel:ops",
        }),
      );
      expect(runMainSessionOnceMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: `cron:${job.id}`,
          sessionKey: "agent:main:discord:channel:ops",
        }),
      );
      expect(requestHeartbeatNowMock).not.toHaveBeenCalled();
    } finally {
      state.cron.stop();
    }
  });

  it("blocks private webhook URLs via SSRF-guarded fetch", async () => {
    const cfg = createCronConfig("server-cron-ssrf");
    loadConfigMock.mockReturnValue(cfg);
    fetchWithSsrFGuardMock.mockRejectedValue(
      new SsrFBlockedError("Blocked: resolves to private/internal/special-use IP address"),
    );

    const state = buildGatewayCronService({
      cfg,
      deps: {} as CliDeps,
      broadcast: () => {},
    });
    try {
      const job = await state.cron.add({
        name: "ssrf-webhook-blocked",
        enabled: true,
        schedule: { kind: "at", at: new Date(1).toISOString() },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "hello" },
        delivery: {
          mode: "webhook",
          to: "http://127.0.0.1:8080/cron-finished",
        },
      });

      await state.cron.run(job.id, "force");

      expect(fetchWithSsrFGuardMock).toHaveBeenCalledOnce();
      expect(fetchWithSsrFGuardMock).toHaveBeenCalledWith({
        url: "http://127.0.0.1:8080/cron-finished",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"action":"finished"'),
          signal: expect.any(AbortSignal),
        },
      });
    } finally {
      state.cron.stop();
    }
  });

  it("passes custom session targets through to isolated cron runs", async () => {
    const tmpDir = path.join(os.tmpdir(), `server-cron-custom-session-${Date.now()}`);
    const cfg = {
      session: {
        mainKey: "main",
      },
      cron: {
        store: path.join(tmpDir, "cron.json"),
      },
    } as CrawClawConfig;
    loadConfigMock.mockReturnValue(cfg);

    const state = buildGatewayCronService({
      cfg,
      deps: {} as CliDeps,
      broadcast: () => {},
    });
    try {
      const job = await state.cron.add({
        name: "custom-session",
        enabled: true,
        schedule: { kind: "at", at: new Date(1).toISOString() },
        sessionTarget: "session:project-alpha-monitor",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: "hello" },
      });

      await state.cron.run(job.id, "force");

      expect(runCronIsolatedAgentTurnMock).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({ id: job.id }),
          sessionKey: "project-alpha-monitor",
        }),
      );
    } finally {
      state.cron.stop();
    }
  });
});

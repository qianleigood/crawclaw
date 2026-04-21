import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
}));

function createMockChild() {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn((signal?: NodeJS.Signals | number) => {
      queueMicrotask(() => {
        (child as { exitCode: number | null; signalCode: NodeJS.Signals | null }).exitCode = 0;
        emitter.emit("exit", 0, signal);
      });
      return true;
    }),
  });
  return child;
}

describe("scrapling fetch service", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockImplementation((path: string) =>
      String(path).includes("python/scrapling_sidecar.py"),
    );
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      error: undefined,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the managed venv before starting the sidecar and stops the child process", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", ready: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", ready: true }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const child = createMockChild();
    spawnMock.mockReturnValue(child as never);
    existsSyncMock.mockImplementation((path: string) => {
      const text = String(path);
      if (text.includes("python/scrapling_sidecar.py")) {
        return true;
      }
      return text === `${stateDir}/runtimes/scrapling-fetch/venv/bin/python`;
    });

    const serviceModule = await import("./service.js");
    const service = serviceModule.createScraplingFetchPluginService();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const stateDir = "/tmp/crawclaw-scrapling-phase2";
    const ctx = {
      config: {
        plugins: {
          entries: {
            "scrapling-fetch": {
              config: {
                service: {
                  baseUrl: "http://127.0.0.1:43210",
                  command: "python3",
                  args: ["-u"],
                  bootstrap: true,
                  bootstrapPackages: ["Scrapling==0.4.4", "curl-cffi==0.15.0"],
                  startupTimeoutMs: 1_000,
                  healthcheckPath: "/health",
                  fetchPath: "/fetch",
                },
              },
            },
          },
        },
      },
      stateDir,
      logger,
    } as never;

    await service.start(ctx);

    const managedPython = `${stateDir}/runtimes/scrapling-fetch/venv/bin/python`;
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      1,
      managedPython,
      ["-c", expect.stringContaining("from scrapling.fetchers import")],
      expect.objectContaining({
        stdio: "pipe",
        windowsHide: true,
      }),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      managedPython,
      expect.arrayContaining([
        "-u",
        expect.stringContaining("extensions/scrapling-fetch/python/scrapling_sidecar.py"),
        "--host",
        "127.0.0.1",
        "--port",
        "43210",
        "--healthcheck-path",
        "/health",
        "--fetch-path",
        "/fetch",
      ]),
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }),
    );
    expect(serviceModule.getScraplingFetchServiceState(stateDir)).toMatchObject({
      baseUrl: "http://127.0.0.1:43210",
      mode: "python-http",
    });

    await service.stop?.(ctx);
    expect(child.kill).toHaveBeenCalled();
    expect(serviceModule.getScraplingFetchServiceState(stateDir)).toBeNull();
  });

  it("uses the managed runtime installed under CRAWCLAW_STATE_DIR", async () => {
    const serviceModule = await import("./service.js");
    const stateDir = "/tmp/crawclaw-scrapling-custom-state";
    const managedPython = `${stateDir}/runtimes/scrapling-fetch/venv/bin/python`;
    existsSyncMock.mockImplementation((path: string) => {
      const text = String(path);
      return text.includes("python/scrapling_sidecar.py") || text === managedPython;
    });

    const runtimeCommand = serviceModule.__testing.ensureManagedRuntimeBootstrap({
      stateDir,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
      config: {
        service: {
          bootstrap: true,
          command: "python3",
          bootstrapPackages: ["Scrapling==0.4.6"],
        },
      } as never,
    });

    expect(runtimeCommand).toBe(managedPython);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      managedPython,
      ["-c", expect.stringContaining("from scrapling.fetchers import")],
      expect.objectContaining({
        stdio: "pipe",
        windowsHide: true,
      }),
    );
  });

  it("skips managed bootstrap when disabled and launches the configured command directly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", ready: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", ready: true }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const child = createMockChild();
    spawnMock.mockReturnValue(child as never);

    const serviceModule = await import("./service.js");
    const service = serviceModule.createScraplingFetchPluginService();
    const ctx = {
      config: {
        plugins: {
          entries: {
            "scrapling-fetch": {
              config: {
                service: {
                  baseUrl: "http://127.0.0.1:43211",
                  command: "python3",
                  args: ["-u"],
                  bootstrap: false,
                  startupTimeoutMs: 1_000,
                },
              },
            },
          },
        },
      },
      stateDir: "/tmp/crawclaw-scrapling-phase2-no-bootstrap",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    } as never;

    await service.start(ctx);

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining([
        "-u",
        expect.stringContaining("extensions/scrapling-fetch/python/scrapling_sidecar.py"),
        "--port",
        "43211",
      ]),
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }),
    );

    await service.stop?.(ctx);
  });
});

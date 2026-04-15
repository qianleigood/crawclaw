import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());
const openSyncMock = vi.hoisted(() => vi.fn(() => 42));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("node:fs", () => ({
  mkdirSync: mkdirSyncMock,
  openSync: openSyncMock,
}));

describe("open-websearch daemon manager", () => {
  let ensureManagedOpenWebSearchDaemon: typeof import("./open-websearch-daemon.js").ensureManagedOpenWebSearchDaemon;
  let startManagedOpenWebSearchDaemonService: typeof import("./open-websearch-daemon.js").startManagedOpenWebSearchDaemonService;
  let stopManagedOpenWebSearchDaemonService: typeof import("./open-websearch-daemon.js").stopManagedOpenWebSearchDaemonService;
  let testing: typeof import("./open-websearch-daemon.js").__testing;

  beforeEach(async () => {
    vi.resetModules();
    spawnMock.mockReset().mockImplementation(() => {
      const exitHandlers = new Set<() => void>();
      const child: {
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: ReturnType<typeof vi.fn>;
        once: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
      } = {
        exitCode: null,
        signalCode: null,
        kill: vi.fn((signal?: NodeJS.Signals | number) => {
          child.signalCode = typeof signal === "string" ? signal : null;
          child.exitCode = 0;
          for (const handler of exitHandlers) {
            handler();
          }
          return true;
        }),
        once: vi.fn((event: string, handler: () => void) => {
          if (event === "exit") {
            exitHandlers.add(handler);
          }
          return child;
        }),
        unref: vi.fn(),
      };
      return child;
    });
    mkdirSyncMock.mockReset();
    openSyncMock.mockReset().mockReturnValue(42);
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true })),
    );
    ({
      ensureManagedOpenWebSearchDaemon,
      startManagedOpenWebSearchDaemonService,
      stopManagedOpenWebSearchDaemonService,
      __testing: testing,
    } = await import("./open-websearch-daemon.js"));
  });

  it("skips spawning when auto-start is disabled", async () => {
    const baseUrl = await ensureManagedOpenWebSearchDaemon({
      config: {
        plugins: {
          entries: {
            "open-websearch": {
              config: {
                webSearch: {
                  autoStart: false,
                  baseUrl: "http://127.0.0.1:3999",
                },
              },
            },
          },
        },
      } as never,
    });

    expect(baseUrl).toBe("http://127.0.0.1:3999");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns the managed daemon through npx when local loopback is not ready", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureManagedOpenWebSearchDaemon({
        config: {} as never,
      }),
    ).resolves.toBe("http://127.0.0.1:3210");

    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["--yes", "open-websearch@2.1.5", "serve", "--host", "127.0.0.1", "--port", "3210"],
      expect.objectContaining({
        detached: true,
        windowsHide: true,
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/status",
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("resolves the managed launch command through npx", async () => {
    expect(testing.resolveLaunchCommand()).toEqual({
      command: process.platform === "win32" ? "npx.cmd" : "npx",
      args: ["--yes", "open-websearch@2.1.5"],
    });
  });

  it("starts and stops a gateway-managed daemon through the plugin service lifecycle", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startManagedOpenWebSearchDaemonService({
        config: {} as never,
      }),
    ).resolves.toBe("http://127.0.0.1:3210");

    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["--yes", "open-websearch@2.1.5", "serve", "--host", "127.0.0.1", "--port", "3210"],
      expect.objectContaining({
        detached: false,
        windowsHide: true,
      }),
    );

    const child = spawnMock.mock.results[0]?.value as { kill: ReturnType<typeof vi.fn> };
    await expect(
      stopManagedOpenWebSearchDaemonService({
        config: {} as never,
      }),
    ).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

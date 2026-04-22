import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const homedirMock = vi.hoisted(() => vi.fn(() => "/tmp"));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: homedirMock,
  };
});

const tempRoots: string[] = [];

function makeRuntimeBin(): {
  env: NodeJS.ProcessEnv;
  launch: { command: string; args: string[] };
} {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-open-websearch-"));
  tempRoots.push(stateDir);
  const packageRoot = path.join(
    stateDir,
    "runtimes",
    "open-websearch",
    "node_modules",
    "open-websearch",
  );
  const entrypoint = path.join(packageRoot, "dist", "cli.js");
  const binPath =
    process.platform === "win32"
      ? path.join(
          stateDir,
          "runtimes",
          "open-websearch",
          "node_modules",
          ".bin",
          "open-websearch.cmd",
        )
      : path.join(stateDir, "runtimes", "open-websearch", "node_modules", ".bin", "open-websearch");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
  fs.writeFileSync(binPath, "", "utf8");
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ bin: { "open-websearch": "dist/cli.js" } }),
    "utf8",
  );
  fs.writeFileSync(entrypoint, "", "utf8");
  return {
    env: { ...process.env, CRAWCLAW_STATE_DIR: stateDir },
    launch:
      process.platform === "win32"
        ? { command: process.execPath, args: [entrypoint] }
        : { command: binPath, args: [] },
  };
}

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
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-open-websearch-home-"));
    tempRoots.push(homeDir);
    homedirMock.mockReset().mockReturnValue(homeDir);
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

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  it("spawns the managed daemon runtime when local loopback is not ready", async () => {
    const { env, launch } = makeRuntimeBin();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureManagedOpenWebSearchDaemon({
        config: {} as never,
        env,
      }),
    ).resolves.toBe("http://127.0.0.1:3210");

    expect(spawnMock).toHaveBeenCalledWith(
      launch.command,
      [...launch.args, "serve", "--host", "127.0.0.1", "--port", "3210"],
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

  it("resolves the managed launch command from CRAWCLAW_STATE_DIR", async () => {
    const { env, launch } = makeRuntimeBin();
    expect(testing.resolveLaunchCommand(env)).toMatchObject(launch);
  });

  it("starts and stops a gateway-managed daemon through the plugin service lifecycle", async () => {
    const { env, launch } = makeRuntimeBin();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startManagedOpenWebSearchDaemonService({
        config: {} as never,
        env,
      }),
    ).resolves.toBe("http://127.0.0.1:3210");

    expect(spawnMock).toHaveBeenCalledWith(
      launch.command,
      [...launch.args, "serve", "--host", "127.0.0.1", "--port", "3210"],
      expect.objectContaining({
        detached: false,
        windowsHide: true,
      }),
    );

    const child = spawnMock.mock.results[0]?.value as { kill: ReturnType<typeof vi.fn> };
    await expect(
      stopManagedOpenWebSearchDaemonService({
        config: {} as never,
        env,
      }),
    ).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  ensureManagedPinchTabService,
  resolvePinchTabConnectionConfig,
  stopManagedPinchTabService,
} from "./pinchtab-managed-service.js";

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill(signal?: NodeJS.Signals) {
    this.signalCode = signal ?? "SIGTERM";
    this.emit("exit", 0, this.signalCode);
    return true;
  }

  once(event: "exit", listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }
}

const tempRoots: string[] = [];

function makePinchTabCmdShimFixture(): { binPath: string; entrypoint: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-pinchtab-runtime-"));
  tempRoots.push(root);
  const packageRoot = path.join(root, "node_modules", "pinchtab");
  const entrypoint = path.join(packageRoot, "dist", "cli.js");
  const binPath = path.join(root, "node_modules", ".bin", "pinchtab.cmd");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
  fs.writeFileSync(binPath, "@ECHO off\r\n", "utf8");
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ bin: { pinchtab: "dist/cli.js" } }),
    "utf8",
  );
  fs.writeFileSync(entrypoint, "", "utf8");
  return { binPath, entrypoint };
}

afterEach(async () => {
  await stopManagedPinchTabService();
  __testing.setDepsForTest(null);
  __testing.resetState();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pinchtab-managed-service", () => {
  it("uses the managed local PinchTab endpoint when no explicit baseUrl is configured", () => {
    expect(resolvePinchTabConnectionConfig({ browser: { provider: "pinchtab" } })).toEqual({
      enabled: true,
      baseUrl: "http://127.0.0.1:9867",
      token: undefined,
      managed: true,
    });
  });

  it("falls back to the gateway auth token when no explicit PinchTab token is configured", () => {
    expect(
      resolvePinchTabConnectionConfig({
        gateway: {
          auth: {
            mode: "token",
            token: "gateway-secret",
          },
        },
        browser: { provider: "pinchtab" },
      }),
    ).toEqual({
      enabled: true,
      baseUrl: "http://127.0.0.1:9867",
      token: "gateway-secret",
      managed: true,
    });
  });

  it("prefers the managed PinchTab server token for local managed startup", () => {
    __testing.setDepsForTest({
      readFileSyncImpl: vi.fn(() =>
        JSON.stringify({ server: { token: "pinchtab-server-secret" } }),
      ) as never,
    });

    expect(
      resolvePinchTabConnectionConfig({
        gateway: {
          auth: {
            mode: "token",
            token: "gateway-secret",
          },
        },
        browser: { provider: "pinchtab" },
      }),
    ).toEqual({
      enabled: true,
      baseUrl: "http://127.0.0.1:9867",
      token: "pinchtab-server-secret",
      managed: true,
    });
  });

  it("treats explicit baseUrl as externally managed and skips managed startup", async () => {
    const spawnImpl = vi.fn();
    __testing.setDepsForTest({ spawnImpl: spawnImpl as never });
    const result = await ensureManagedPinchTabService({
      config: {
        browser: {
          provider: "pinchtab",
          pinchtab: { baseUrl: "http://pinchtab.example:9999", token: "secret" },
        },
      },
    });

    expect(result).toEqual({
      enabled: true,
      baseUrl: "http://pinchtab.example:9999",
      token: "secret",
      managed: false,
    });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("spawns the managed PinchTab runtime and waits for health", async () => {
    const child = new FakeChildProcess();
    let stage: "pre" | "post" = "pre";
    const spawnImpl = vi.fn(() => {
      stage = "post";
      return child as never;
    });
    const health = vi.fn(async () => {
      if (stage === "pre") {
        throw new Error("offline");
      }
      return { ok: true };
    });
    __testing.setDepsForTest({
      spawnImpl: spawnImpl as never,
      existsSyncImpl: vi.fn(() => true),
      resolveBrowserRuntimeBinImpl: vi.fn(() => "/tmp/pinchtab"),
      createClientImpl: vi.fn(() => ({ health })) as never,
    });

    const result = await ensureManagedPinchTabService({
      config: { browser: { provider: "pinchtab" } },
    });

    expect(result.baseUrl).toBe("http://127.0.0.1:9867");
    expect(result.managed).toBe(true);
    expect(spawnImpl).toHaveBeenCalledWith(
      "/tmp/pinchtab",
      [],
      expect.objectContaining({
        stdio: "pipe",
        env: expect.objectContaining({
          BRIDGE_BIND: "127.0.0.1",
          BRIDGE_PORT: "9867",
        }),
      }),
    );
    expect(health.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("passes the resolved token to both legacy and PinchTab-native auth env vars", async () => {
    const child = new FakeChildProcess();
    let stage: "pre" | "post" = "pre";
    const spawnImpl = vi.fn(() => {
      stage = "post";
      return child as never;
    });
    const health = vi.fn(async () => {
      if (stage === "pre") {
        throw new Error("offline");
      }
      return { ok: true };
    });
    __testing.setDepsForTest({
      spawnImpl: spawnImpl as never,
      existsSyncImpl: vi.fn(() => true),
      resolveBrowserRuntimeBinImpl: vi.fn(() => "/tmp/pinchtab"),
      createClientImpl: vi.fn(() => ({ health })) as never,
    });

    await ensureManagedPinchTabService({
      config: {
        gateway: {
          auth: {
            mode: "token",
            token: "gateway-secret",
          },
        },
        browser: { provider: "pinchtab" },
      },
    });

    expect(spawnImpl).toHaveBeenCalledWith(
      "/tmp/pinchtab",
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          BRIDGE_TOKEN: "gateway-secret",
          PINCHTAB_TOKEN: "gateway-secret",
        }),
      }),
    );
  });

  it("resolves Windows PinchTab cmd shims to the package Node entrypoint", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const { binPath, entrypoint } = makePinchTabCmdShimFixture();
    const child = new FakeChildProcess();
    let stage: "pre" | "post" = "pre";
    const spawnImpl = vi.fn(() => {
      stage = "post";
      return child as never;
    });
    const health = vi.fn(async () => {
      if (stage === "pre") {
        throw new Error("offline");
      }
      return { ok: true };
    });
    __testing.setDepsForTest({
      spawnImpl: spawnImpl as never,
      existsSyncImpl: vi.fn(() => true),
      resolveBrowserRuntimeBinImpl: vi.fn(() => binPath),
      createClientImpl: vi.fn(() => ({ health })) as never,
    });

    try {
      await ensureManagedPinchTabService({
        config: { browser: { provider: "pinchtab" } },
      });

      expect(spawnImpl).toHaveBeenCalledWith(
        process.execPath,
        [entrypoint],
        expect.objectContaining({
          stdio: "pipe",
          windowsHide: true,
        }),
      );
    } finally {
      platformSpy.mockRestore();
    }
  });
});

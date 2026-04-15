import { EventEmitter } from "node:events";
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

afterEach(async () => {
  await stopManagedPinchTabService();
  __testing.setDepsForTest(null);
  __testing.resetState();
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
});

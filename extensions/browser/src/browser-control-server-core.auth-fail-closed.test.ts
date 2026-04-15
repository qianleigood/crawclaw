import { describe, expect, it, vi } from "vitest";
import { createBrowserControlServerController } from "./browser-control-server-core.js";

describe("browser control server core", () => {
  it("logs generated auth token bootstrap and starts the runtime", async () => {
    const runtimeState = {
      port: 18789,
      resolved: { enabled: true, controlPort: 18789, profiles: {} },
      profiles: new Map(),
    } as never;
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const deps = {
      loadConfig: vi.fn(() => ({ browser: { enabled: true } })),
      isDefaultBrowserPluginEnabled: vi.fn(() => true),
      resolveBrowserConfig: vi.fn(() => ({
        enabled: true,
        controlPort: 18789,
      })),
      resolveBrowserControlAuth: vi.fn(() => ({})),
      ensureBrowserControlAuth: vi.fn(async () => ({
        auth: { token: "generated-token" },
        generatedToken: "generated-token",
      })),
      installBrowserCommonMiddleware: vi.fn(),
      installBrowserAuthMiddleware: vi.fn(),
      createBrowserRouteContext: vi.fn(() => ({})),
      registerBrowserRoutes: vi.fn(),
      createBrowserRuntimeState: vi.fn(async () => runtimeState),
      stopBrowserRuntime: vi.fn(async () => {}),
    };
    const controller = createBrowserControlServerController({
      deps,
      log,
    });

    controller.__testing.setDepsForTest({
      listen: vi.fn(async () => ({ close: vi.fn() }) as never),
    });

    const started = await controller.start();

    expect(started).toBe(runtimeState);
    expect(deps.installBrowserCommonMiddleware).toHaveBeenCalledTimes(1);
    expect(deps.installBrowserAuthMiddleware).toHaveBeenCalledWith(expect.anything(), {
      token: "generated-token",
    });
    expect(deps.createBrowserRuntimeState).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 18789,
      }),
    );
    expect(log.info).toHaveBeenCalledWith(
      "No browser auth configured; generated gateway.auth.token automatically.",
    );
    expect(log.info).toHaveBeenCalledWith(
      "Browser control listening on http://127.0.0.1:18789/ (auth=token)",
    );
  });

  it("fails closed when auth bootstrap throws and no auth is configured", async () => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const controller = createBrowserControlServerController({
      deps: {
        loadConfig: vi.fn(() => ({ browser: { enabled: true } })),
        isDefaultBrowserPluginEnabled: vi.fn(() => true),
        resolveBrowserConfig: vi.fn(() => ({
          enabled: true,
          controlPort: 18789,
        })),
        resolveBrowserControlAuth: vi.fn(() => ({})),
        ensureBrowserControlAuth: vi.fn(async () => {
          throw new Error("read-only config");
        }),
        installBrowserCommonMiddleware: vi.fn(),
        installBrowserAuthMiddleware: vi.fn(),
        createBrowserRouteContext: vi.fn(() => ({})),
        registerBrowserRoutes: vi.fn(),
        createBrowserRuntimeState: vi.fn(),
        stopBrowserRuntime: vi.fn(async () => {}),
      },
      log,
    });

    controller.__testing.setDepsForTest({
      listen: vi.fn(async () => {
        throw new Error("listen should not be called");
      }),
    });

    const started = await controller.start();

    expect(started).toBeNull();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "failed to auto-configure browser auth: Error: read-only config",
    );
    expect(log.error).toHaveBeenCalledWith(
      "browser control startup aborted: authentication bootstrap failed and no fallback auth is configured.",
    );
  });

  it("returns null when loopback bind fails and does not create a runtime", async () => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const deps = {
      loadConfig: vi.fn(() => ({ browser: { enabled: true } })),
      isDefaultBrowserPluginEnabled: vi.fn(() => true),
      resolveBrowserConfig: vi.fn(() => ({
        enabled: true,
        controlPort: 18789,
      })),
      resolveBrowserControlAuth: vi.fn(() => ({ token: "browser-token" })),
      ensureBrowserControlAuth: vi.fn(async () => ({
        auth: { token: "browser-token" },
      })),
      installBrowserCommonMiddleware: vi.fn(),
      installBrowserAuthMiddleware: vi.fn(),
      createBrowserRouteContext: vi.fn(() => ({})),
      registerBrowserRoutes: vi.fn(),
      createBrowserRuntimeState: vi.fn(
        async () =>
          ({
            port: 18789,
            resolved: { enabled: true, controlPort: 18789, profiles: {} },
            profiles: new Map(),
          }) as never,
      ),
      stopBrowserRuntime: vi.fn(async () => {}),
    };
    const controller = createBrowserControlServerController({
      deps,
      log,
    });

    controller.__testing.setDepsForTest({
      listen: vi.fn(async () => {
        throw new Error("EPERM");
      }),
    });

    const started = await controller.start();

    expect(started).toBeNull();
    expect(deps.createBrowserRuntimeState).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      "crawclaw browser server failed to bind 127.0.0.1:18789: Error: EPERM",
    );
  });
});

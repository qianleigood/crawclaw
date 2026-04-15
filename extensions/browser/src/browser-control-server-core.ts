import type { Server } from "node:http";
import express from "express";
import type { BrowserRouteRegistrar } from "./browser/routes/types.js";
import type { BrowserServerState } from "./browser/server-context.types.js";

type BrowserControlAuth = {
  token?: string;
  password?: string;
};

type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

type BrowserControlServerDeps = {
  loadConfig: (...args: any[]) => any;
  isDefaultBrowserPluginEnabled: (...args: any[]) => boolean;
  resolveBrowserConfig: (...args: any[]) => {
    enabled: boolean;
    controlPort: number;
    profiles?: Record<string, unknown>;
  };
  resolveBrowserControlAuth: (...args: any[]) => BrowserControlAuth;
  ensureBrowserControlAuth: (...args: any[]) => Promise<{
    auth: BrowserControlAuth;
    generatedToken?: string;
  }>;
  installBrowserCommonMiddleware: (...args: any[]) => void;
  installBrowserAuthMiddleware: (...args: any[]) => void;
  createBrowserRouteContext: (opts: {
    getState: () => BrowserServerState | null;
    refreshConfigFromDisk: boolean;
  }) => any;
  registerBrowserRoutes: (...args: any[]) => void;
  createBrowserRuntimeState: (...args: any[]) => Promise<BrowserServerState>;
  stopBrowserRuntime: (params: {
    current: BrowserServerState | null;
    getState: () => BrowserServerState | null;
    clearState: () => void;
    closeServer?: boolean;
    onWarn: (message: string) => void;
  }) => Promise<void>;
};

type ListenFn = (app: ReturnType<typeof express>, port: number, host: string) => Promise<Server>;

function defaultListen(app: ReturnType<typeof express>, port: number, host: string) {
  return new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.once("error", reject);
  });
}

export function createBrowserControlServerController(params: {
  deps: BrowserControlServerDeps;
  log: Logger;
}) {
  let state: BrowserServerState | null = null;
  let listen: ListenFn = defaultListen;

  return {
    __testing: {
      setDepsForTest(
        overrides: Partial<{
          listen: ListenFn;
        }> | null,
      ) {
        listen = overrides?.listen ?? defaultListen;
      },
    },
    async start(): Promise<BrowserServerState | null> {
      if (state) {
        return state;
      }

      const cfg = params.deps.loadConfig();
      if (!params.deps.isDefaultBrowserPluginEnabled(cfg)) {
        return null;
      }
      const resolved = params.deps.resolveBrowserConfig(
        (cfg as { browser?: unknown }).browser,
        cfg,
      );
      if (!resolved.enabled) {
        return null;
      }

      let browserAuth = params.deps.resolveBrowserControlAuth(cfg);
      let browserAuthBootstrapFailed = false;
      try {
        const ensured = await params.deps.ensureBrowserControlAuth({ cfg });
        browserAuth = ensured.auth;
        if (ensured.generatedToken) {
          params.log.info(
            "No browser auth configured; generated gateway.auth.token automatically.",
          );
        }
      } catch (err) {
        params.log.warn(`failed to auto-configure browser auth: ${String(err)}`);
        browserAuthBootstrapFailed = true;
      }

      if (browserAuthBootstrapFailed && !browserAuth.token && !browserAuth.password) {
        params.log.error(
          "browser control startup aborted: authentication bootstrap failed and no fallback auth is configured.",
        );
        return null;
      }

      const app = express();
      params.deps.installBrowserCommonMiddleware(app);
      params.deps.installBrowserAuthMiddleware(app, browserAuth);

      const ctx = params.deps.createBrowserRouteContext({
        getState: () => state,
        refreshConfigFromDisk: true,
      });
      params.deps.registerBrowserRoutes(app as unknown as BrowserRouteRegistrar, ctx);

      const port = resolved.controlPort;
      const server = await listen(app, port, "127.0.0.1").catch((err) => {
        params.log.error(
          `crawclaw browser server failed to bind 127.0.0.1:${port}: ${String(err)}`,
        );
        return null;
      });

      if (!server) {
        return null;
      }

      state = await params.deps.createBrowserRuntimeState({
        server,
        port,
        resolved,
        onWarn: (message: string) => params.log.warn(message),
      });

      const authMode = browserAuth.token ? "token" : browserAuth.password ? "password" : "off";
      params.log.info(`Browser control listening on http://127.0.0.1:${port}/ (auth=${authMode})`);
      return state;
    },
    async stop(): Promise<void> {
      const current = state;
      await params.deps.stopBrowserRuntime({
        current,
        getState: () => state,
        clearState: () => {
          state = null;
        },
        closeServer: true,
        onWarn: (message) => params.log.warn(message),
      });
    },
  };
}

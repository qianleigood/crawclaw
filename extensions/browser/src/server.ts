import { createBrowserControlServerController } from "./browser-control-server-core.js";
import { resolveBrowserConfig } from "./browser/config.js";
import { ensureBrowserControlAuth, resolveBrowserControlAuth } from "./browser/control-auth.js";
import { registerBrowserRoutes } from "./browser/routes/index.js";
import { createBrowserRuntimeState, stopBrowserRuntime } from "./browser/runtime-lifecycle.js";
import { createBrowserRouteContext } from "./browser/server-context.js";
import {
  installBrowserAuthMiddleware,
  installBrowserCommonMiddleware,
} from "./browser/server-middleware.js";
import { loadConfig } from "./config/config.js";
import { createSubsystemLogger } from "./logging/subsystem.js";
import { isDefaultBrowserPluginEnabled } from "./plugin-enabled.js";

const log = createSubsystemLogger("browser");
const logServer = log.child("server");

const controller = createBrowserControlServerController({
  deps: {
    loadConfig,
    isDefaultBrowserPluginEnabled,
    resolveBrowserConfig,
    resolveBrowserControlAuth,
    ensureBrowserControlAuth,
    installBrowserCommonMiddleware,
    installBrowserAuthMiddleware,
    createBrowserRouteContext,
    registerBrowserRoutes,
    createBrowserRuntimeState,
    stopBrowserRuntime,
  },
  log: logServer,
});

export const __testing = controller.__testing;

export async function startBrowserControlServerFromConfig() {
  return await controller.start();
}

export async function stopBrowserControlServer() {
  await controller.stop();
}

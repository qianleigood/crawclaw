import { createBrowserControlServerController } from "./browser-control-server-core.js";
import { resolveBrowserConfig } from "./browser/config.js";
import { ensureBrowserControlAuth, resolveBrowserControlAuth } from "./browser/control-auth.js";
import { createPinchTabBrowserRouteContext } from "./browser/pinchtab-route-context.js";
import {
  createPinchTabBrowserRuntimeState,
  stopPinchTabBrowserRuntime,
} from "./browser/pinchtab-runtime-lifecycle.js";
import { registerBrowserRoutes } from "./browser/routes/index.js";
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
    createBrowserRouteContext: createPinchTabBrowserRouteContext,
    registerBrowserRoutes,
    createBrowserRuntimeState: createPinchTabBrowserRuntimeState,
    stopBrowserRuntime: stopPinchTabBrowserRuntime,
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

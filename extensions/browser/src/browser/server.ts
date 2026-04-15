import { createBrowserControlServerController } from "../browser-control-server-core.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isDefaultBrowserPluginEnabled } from "../plugin-enabled.js";
import { resolveBrowserConfig } from "./config.js";
import { ensureBrowserControlAuth, resolveBrowserControlAuth } from "./control-auth.js";
import { createPinchTabBrowserRouteContext } from "./pinchtab-route-context.js";
import {
  createPinchTabBrowserRuntimeState,
  stopPinchTabBrowserRuntime,
} from "./pinchtab-runtime-lifecycle.js";
import { registerBrowserRoutes } from "./routes/index.js";
import {
  installBrowserAuthMiddleware,
  installBrowserCommonMiddleware,
} from "./server-middleware.js";

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

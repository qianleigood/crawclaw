import { createBrowserControlServerController } from "../browser-control-server-core.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isDefaultBrowserPluginEnabled } from "../plugin-enabled.js";
import { resolveBrowserConfig } from "./config.js";
import { ensureBrowserControlAuth, resolveBrowserControlAuth } from "./control-auth.js";
import { registerBrowserRoutes } from "./routes/index.js";
import { createBrowserRuntimeState, stopBrowserRuntime } from "./runtime-lifecycle.js";
import { createBrowserRouteContext } from "./server-context.js";
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

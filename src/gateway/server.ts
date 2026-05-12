import "./ts-gateway-runtime-guard.js";

export { truncateCloseReason } from "./server/close-reason.js";
export type { GatewayServer, GatewayServerOptions } from "./server.impl.js";
export { __resetModelCatalogCacheForTest } from "./server-model-catalog.js";

export async function startGatewayServer(
  ...args: Parameters<typeof import("./server.impl.js").startGatewayServer>
): Promise<Awaited<ReturnType<typeof import("./server.impl.js").startGatewayServer>>> {
  const impl = await import("./server.impl.js");
  return await impl.startGatewayServer(...args);
}

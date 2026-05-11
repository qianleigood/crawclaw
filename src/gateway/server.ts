if (process.env.VITEST !== "1" && process.env.CRAWCLAW_ALLOW_TS_GATEWAY !== "1") {
  throw new Error(
    "The TypeScript Gateway server runtime is disabled. Use the Rust crawclaw-gateway binary.",
  );
}

export { truncateCloseReason } from "./server/close-reason.js";
export type { GatewayServer, GatewayServerOptions } from "./server.impl.js";
export { __resetModelCatalogCacheForTest } from "./server-model-catalog.js";

export async function startGatewayServer(
  ...args: Parameters<typeof import("./server.impl.js").startGatewayServer>
): Promise<Awaited<ReturnType<typeof import("./server.impl.js").startGatewayServer>>> {
  const impl = await import("./server.impl.js");
  return await impl.startGatewayServer(...args);
}

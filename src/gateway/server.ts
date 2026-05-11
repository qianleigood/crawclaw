if (process.env.VITEST !== "1" && process.env.CRAWCLAW_ALLOW_TS_GATEWAY !== "1") {
  throw new Error(
    "The TypeScript Gateway server runtime is disabled. Use the Rust crawclaw-gateway binary.",
  );
}

export { truncateCloseReason } from "./server/close-reason.js";
export type { GatewayServer, GatewayServerOptions } from "./server.impl.js";
export { __resetModelCatalogCacheForTest, startGatewayServer } from "./server.impl.js";

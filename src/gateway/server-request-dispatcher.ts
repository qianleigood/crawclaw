import type { GatewayRequestHandlers, GatewayRequestOptions } from "./request-types.js";

export type GatewayRequestDispatcher = (
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
) => Promise<void>;

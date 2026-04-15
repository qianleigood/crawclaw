import type { Server } from "node:http";
import type { BrowserServerState } from "./server-context.types.js";

export async function createPinchTabBrowserRuntimeState(params: {
  resolved: BrowserServerState["resolved"];
  port: number;
  server?: Server | null;
  onWarn: (message: string) => void;
}): Promise<BrowserServerState> {
  void params.onWarn;
  return {
    server: params.server ?? null,
    port: params.port,
    resolved: params.resolved,
    profiles: new Map(),
  };
}

export async function stopPinchTabBrowserRuntime(params: {
  current: BrowserServerState | null;
  getState: () => BrowserServerState | null;
  clearState: () => void;
  closeServer?: boolean;
  onWarn: (message: string) => void;
}): Promise<void> {
  void params.getState;
  void params.onWarn;
  if (!params.current) {
    return;
  }
  if (params.closeServer && params.current.server) {
    await new Promise<void>((resolve) => {
      params.current?.server?.close(() => resolve());
    });
  }
  params.clearState();
}

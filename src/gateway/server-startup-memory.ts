import type { CrawClawConfig } from "../config/config.js";

export async function startGatewayMemoryBackend(params: {
  cfg: CrawClawConfig;
  log: { info?: (msg: string) => void; warn: (msg: string) => void };
}): Promise<void> {
  void params;
}

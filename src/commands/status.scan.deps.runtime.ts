import type { CrawClawConfig } from "../config/config.js";
import { getTailnetHostname } from "../infra/tailscale.js";
import type { MemoryProviderStatus } from "../memory/search/types.js";

export { getTailnetHostname };

type StatusMemoryManager = {
  probeVectorAvailability(): Promise<boolean>;
  status(): MemoryProviderStatus;
  close?(): Promise<void>;
};

export async function getMemorySearchManager(params: {
  cfg: CrawClawConfig;
  agentId: string;
  purpose: "status";
}): Promise<{ manager: StatusMemoryManager | null }> {
  void params;
  return { manager: null };
}

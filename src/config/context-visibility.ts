import type { CrawClawConfig } from "./config.js";
import type { ContextVisibilityMode } from "./types.base.js";

export function resolveDefaultContextVisibility(
  _cfg: Record<string, unknown>,
): ContextVisibilityMode | undefined {
  return undefined;
}

export function resolveChannelContextVisibilityMode(params: {
  cfg: CrawClawConfig;
  channel: string;
  accountId?: string | null;
  configuredContextVisibility?: ContextVisibilityMode;
}): ContextVisibilityMode {
  if (params.configuredContextVisibility) {
    return params.configuredContextVisibility;
  }
  void params.cfg;
  void params.channel;
  void params.accountId;
  return "all";
}

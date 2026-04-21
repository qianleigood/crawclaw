import type { DreamingConfig } from "../types/config.ts";

export type DreamClosedLoopReason = "active" | "disabled" | "scope_unresolved";

export interface DreamClosedLoopStatus {
  closedLoopActive: boolean;
  closedLoopReason: DreamClosedLoopReason;
}

export function resolveDreamClosedLoopStatus(params: {
  config: Pick<DreamingConfig, "enabled">;
  scopeKey?: string | null;
  requireScope?: boolean;
}): DreamClosedLoopStatus {
  if (!params.config.enabled) {
    return {
      closedLoopActive: false,
      closedLoopReason: "disabled",
    };
  }
  if (params.requireScope !== false && !params.scopeKey?.trim()) {
    return {
      closedLoopActive: false,
      closedLoopReason: "scope_unresolved",
    };
  }
  return {
    closedLoopActive: true,
    closedLoopReason: "active",
  };
}

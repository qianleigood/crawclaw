import {
  resolveSessionStoreTargets,
  type SessionStoreSelectionOptions,
  type SessionStoreTarget,
} from "../config/sessions.js";
import type { CrawClawConfig } from "../config/types.crawclaw.js";
import type { RuntimeEnv } from "../runtime.js";
export { resolveSessionStoreTargets, type SessionStoreSelectionOptions, type SessionStoreTarget };

export function resolveSessionStoreTargetsOrExit(params: {
  cfg: CrawClawConfig;
  opts: SessionStoreSelectionOptions;
  runtime: RuntimeEnv;
}): SessionStoreTarget[] | null {
  try {
    return resolveSessionStoreTargets(params.cfg, params.opts);
  } catch (error) {
    params.runtime.error(error instanceof Error ? error.message : String(error));
    params.runtime.exit(1);
    return null;
  }
}

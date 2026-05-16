import { loadConfig } from "../config/config.js";
import { CronService } from "../cron/service.js";
import { resolveCronStorePath } from "../cron/store.js";

export type GatewayCronState = {
  cron: CronService;
  storePath: string;
  cronEnabled: boolean;
};

export function buildGatewayCronService(params: {
  cfg: ReturnType<typeof loadConfig>;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayCronState {
  void params.broadcast;

  const storePath = resolveCronStorePath(params.cfg.cron?.store);
  const cronEnabled = process.env.CRAWCLAW_SKIP_CRON !== "1" && params.cfg.cron?.enabled !== false;
  const cron = new CronService({ storePath, cronEnabled });

  return { cron, storePath, cronEnabled };
}

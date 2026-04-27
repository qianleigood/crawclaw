import os from "node:os";
import path from "node:path";

/** Resolve the CrawClaw state directory (mirrors core logic in src/infra). */
export function resolveStateDir(): string {
  return process.env.CRAWCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".crawclaw");
}

import type { RuntimeEnv } from "../runtime.js";
import { scanStatus } from "./status.scan.js";
import type { StatusScanResult } from "./status.types.js";

export async function scanStatusJsonFast(
  opts: { timeoutMs?: number; all?: boolean; deep?: boolean },
  runtime?: RuntimeEnv,
): Promise<StatusScanResult> {
  return scanStatus({ ...opts, json: true }, runtime);
}

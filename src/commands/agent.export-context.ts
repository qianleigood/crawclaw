import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime, writeRuntimeJson } from "../runtime.js";
import { loadConfig } from "../config/config.js";
import { resolveSharedContextArchiveService } from "../agents/context-archive/runtime.js";
import { exportContextArchiveSnapshot } from "../agents/context-archive/export.js";

export type AgentExportContextOptions = {
  runId?: string;
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  out?: string;
  json?: boolean;
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasLookupTarget(opts: AgentExportContextOptions): boolean {
  return Boolean(
    normalizeOptionalString(opts.runId) ||
      normalizeOptionalString(opts.taskId) ||
      normalizeOptionalString(opts.sessionId) ||
      normalizeOptionalString(opts.agentId),
  );
}

export async function agentExportContextCommand(
  opts: AgentExportContextOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  if (!hasLookupTarget(opts)) {
    runtime.error("Pass --run-id, --task-id, --session-id, or --agent-id.");
    runtime.exit(1);
    return undefined;
  }
  const archive = await resolveSharedContextArchiveService(loadConfig());
  if (!archive) {
    runtime.error("Context Archive is disabled.");
    runtime.exit(1);
    return undefined;
  }
  const snapshot = await exportContextArchiveSnapshot({
    archive,
    ...(normalizeOptionalString(opts.runId) ? { runId: normalizeOptionalString(opts.runId) } : {}),
    ...(normalizeOptionalString(opts.taskId) ? { taskId: normalizeOptionalString(opts.taskId) } : {}),
    ...(normalizeOptionalString(opts.sessionId)
      ? { sessionId: normalizeOptionalString(opts.sessionId) }
      : {}),
    ...(normalizeOptionalString(opts.agentId)
      ? { agentId: normalizeOptionalString(opts.agentId) }
      : {}),
    hydratePayload: true,
  });
  if (snapshot.runs.length === 0) {
    runtime.error("No matching context archive runs found.");
    runtime.exit(1);
    return undefined;
  }
  if (opts.out) {
    await fs.mkdir(path.dirname(opts.out), { recursive: true, mode: 0o700 });
    await fs.writeFile(opts.out, JSON.stringify(snapshot, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  if (opts.json || !opts.out) {
    writeRuntimeJson(runtime, snapshot);
  } else {
    runtime.log(`Exported ${snapshot.runs.length} archive run(s) to ${opts.out}`);
  }
  return snapshot;
}

import { writeJsonAtomic, writeTextAtomic } from "../../infra/json-files.js";
import type { ContextArchiveService } from "./service.js";
import type {
  ContextArchiveBlobRecord,
  ContextArchiveEventRecord,
  ContextArchiveRunRefs,
  ContextArchiveRunRecord,
} from "./types.js";

type ContextArchiveExportService = Pick<
  ContextArchiveService,
  "describeRun" | "findRuns" | "listBlobs" | "readEvents" | "readRun"
>;

export type ContextArchiveExportedRunRecord = {
  version: 1;
  exportedAt: number;
  run: ContextArchiveRunRecord;
  refs: ContextArchiveRunRefs;
  blobs: ContextArchiveBlobRecord[];
  eventCount: number;
};

export type ContextArchiveExportSummary = {
  runs: ContextArchiveExportedRunRecord[];
};

function renderJsonLines(records: ContextArchiveEventRecord[]): string {
  if (records.length === 0) {
    return "";
  }
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export async function exportContextArchiveRun(params: {
  archive: ContextArchiveExportService;
  runId: string;
  hydratePayload?: boolean;
}): Promise<ContextArchiveExportedRunRecord | null> {
  const runId = params.runId.trim();
  if (!runId) {
    return null;
  }
  const [run, described, blobs, events] = await Promise.all([
    params.archive.readRun(runId),
    params.archive.describeRun(runId),
    params.archive.listBlobs(runId),
    params.archive.readEvents(runId, {
      hydratePayload: params.hydratePayload === true,
      limit: 10_000,
    }),
  ]);
  if (!run || !described) {
    return null;
  }
  const exported: ContextArchiveExportedRunRecord = {
    version: 1,
    exportedAt: Date.now(),
    run,
    refs: described.refs,
    blobs,
    eventCount: events.length,
  };
  await Promise.all([
    writeJsonAtomic(described.refs.runRef, exported, { mode: 0o600, trailingNewline: true }),
    writeTextAtomic(described.refs.eventsRef, renderJsonLines(events), { mode: 0o600 }),
  ]);
  return exported;
}

export async function exportContextArchiveSnapshot(params: {
  archive: ContextArchiveExportService;
  runId?: string;
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  limit?: number;
  hydratePayload?: boolean;
}): Promise<ContextArchiveExportSummary> {
  const runs = await params.archive.findRuns({
    ...(params.runId?.trim() ? { runId: params.runId.trim() } : {}),
    ...(params.taskId?.trim() ? { taskId: params.taskId.trim() } : {}),
    ...(params.sessionId?.trim() ? { sessionId: params.sessionId.trim() } : {}),
    ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
    ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
  });
  const exportedRuns = await Promise.all(
    runs.map(async (run) =>
      exportContextArchiveRun({
        archive: params.archive,
        runId: run.id,
        hydratePayload: params.hydratePayload,
      }),
    ),
  );
  return {
    runs: exportedRuns.filter((run): run is ContextArchiveExportedRunRecord => run != null),
  };
}

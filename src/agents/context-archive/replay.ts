import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "../../infra/json-files.js";
import { createContextArchiveBlobStore } from "./blob-store.js";
import {
  resolveContextArchiveEventPath,
  resolveContextArchiveRunPath,
  resolveContextArchiveRunRefs,
} from "./archive-id.js";
import type {
  ContextArchiveBlobRecord,
  ContextArchiveEventRecord,
  ContextArchiveRunRecord,
} from "./types.js";
import type { ContextArchiveExportedRunRecord } from "./export.js";

export type ContextArchiveReplayRecord = {
  manifest: ContextArchiveExportedRunRecord;
  run: ContextArchiveRunRecord;
  refs: ContextArchiveExportedRunRecord["refs"];
  blobs: ContextArchiveBlobRecord[];
  events: ContextArchiveEventRecord[];
};

function resolveReplayRootDir(params: {
  rootDir?: string;
  runRef?: string;
  eventsRef?: string;
}): string | null {
  if (params.rootDir?.trim()) {
    return path.resolve(params.rootDir);
  }
  if (params.runRef?.trim()) {
    return path.dirname(path.dirname(path.resolve(params.runRef)));
  }
  if (params.eventsRef?.trim()) {
    return path.dirname(path.dirname(path.resolve(params.eventsRef)));
  }
  return null;
}

function parseJsonLines(text: string): ContextArchiveEventRecord[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ContextArchiveEventRecord);
}

async function hydrateEventPayloads(params: {
  rootDir: string;
  events: ContextArchiveEventRecord[];
}): Promise<ContextArchiveEventRecord[]> {
  const blobStore = createContextArchiveBlobStore({ rootDir: params.rootDir });
  return await Promise.all(
    params.events.map(async (event) => {
      if (event.payload !== undefined || !event.payloadBlobHash) {
        return event;
      }
      const payload = event.payloadContentType?.startsWith("application/json")
        ? await blobStore.readBlobJson<unknown>(event.payloadBlobHash)
        : await blobStore.readBlobText(event.payloadBlobHash);
      return payload === null ? event : { ...event, payload };
    }),
  );
}

export async function replayContextArchiveRun(params: {
  rootDir?: string;
  runId?: string;
  runRef?: string;
  eventsRef?: string;
  hydratePayload?: boolean;
}): Promise<ContextArchiveReplayRecord | null> {
  const rootDir = resolveReplayRootDir(params);
  const requestedRunId = params.runId?.trim();
  const runRef =
    params.runRef?.trim() ||
    (rootDir && requestedRunId ? resolveContextArchiveRunPath(rootDir, requestedRunId) : null);
  if (!rootDir || !runRef) {
    return null;
  }

  const manifest = await readJsonFile<ContextArchiveExportedRunRecord>(runRef);
  if (!manifest?.run || !Array.isArray(manifest.blobs)) {
    return null;
  }
  const resolvedRunId = manifest.run.id;
  const eventsRef =
    params.eventsRef?.trim() || resolveContextArchiveEventPath(rootDir, resolvedRunId);

  const eventFile = await fs.readFile(eventsRef, "utf8").catch(() => null);
  if (eventFile == null) {
    return null;
  }
  const parsedEvents = parseJsonLines(eventFile);
  const events =
    params.hydratePayload === true
      ? await hydrateEventPayloads({ rootDir, events: parsedEvents })
      : parsedEvents;
  const refs =
    manifest.refs ??
    resolveContextArchiveRunRefs({
      rootDir,
      runId: manifest.run.id,
      blobHashes: manifest.blobs.map((blob) => blob.sha256),
    });
  return {
    manifest,
    run: manifest.run,
    refs,
    blobs: manifest.blobs,
    events,
  };
}

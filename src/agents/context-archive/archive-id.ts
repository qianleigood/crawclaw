import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

export function newContextArchiveId(prefix = "car"): string {
  const normalizedPrefix = prefix.trim() || "car";
  return `${normalizedPrefix}_${randomUUID()}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function resolveContextArchiveRootDir(params?: {
  rootDir?: string;
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  if (params?.rootDir?.trim()) {
    return path.resolve(params.rootDir);
  }
  if (params?.baseDir?.trim()) {
    return path.join(path.resolve(params.baseDir), "context-archive");
  }
  return path.join(resolveStateDir(params?.env), "context-archive");
}

export function resolveContextArchiveBlobDir(rootDir: string): string {
  return path.join(rootDir, "blobs");
}

export function resolveContextArchiveRunDir(rootDir: string): string {
  return path.join(rootDir, "runs");
}

export function resolveContextArchiveEventDir(rootDir: string): string {
  return path.join(rootDir, "events");
}

export function resolveContextArchiveBlobPath(rootDir: string, sha256: string): string {
  return path.join(resolveContextArchiveBlobDir(rootDir), `${sha256}.blob`);
}

export function resolveContextArchiveBlobMetaPath(rootDir: string, sha256: string): string {
  return path.join(resolveContextArchiveBlobDir(rootDir), `${sha256}.json`);
}

export function resolveContextArchiveRunPath(rootDir: string, runId: string): string {
  return path.join(resolveContextArchiveRunDir(rootDir), `${runId}.json`);
}

export function resolveContextArchiveEventPath(rootDir: string, runId: string): string {
  return path.join(resolveContextArchiveEventDir(rootDir), `${runId}.jsonl`);
}

export function resolveContextArchiveRunRefs(params: {
  rootDir: string;
  runId: string;
  blobHashes?: string[];
}): {
  runRef: string;
  eventsRef: string;
  blobRefs: string[];
} {
  const blobRefs = [...new Set(params.blobHashes ?? [])]
    .filter((blobHash) => Boolean(blobHash.trim()))
    .map((blobHash) => resolveContextArchiveBlobPath(params.rootDir, blobHash));
  return {
    runRef: resolveContextArchiveRunPath(params.rootDir, params.runId),
    eventsRef: resolveContextArchiveEventPath(params.rootDir, params.runId),
    blobRefs,
  };
}

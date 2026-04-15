import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { createAsyncLock, writeJsonAtomic } from "../../infra/json-files.js";
import { newContextArchiveId, sha256Hex } from "./archive-id.js";
import type {
  ContextArchiveBlobEncoding,
  ContextArchiveBlobInput,
  ContextArchiveStoredBlob,
} from "./types.js";

type BlobMetaFile = {
  version: 1;
  blobId: string;
  sha256: string;
  contentType: string;
  encoding: ContextArchiveBlobEncoding;
  sizeBytes: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) {
    return value;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry, seen));
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new Error("unsupported archive blob value");
  }
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (!isPlainObject(value)) {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
  if (seen.has(value)) {
    throw new Error("cyclic archive blob value");
  }
  seen.add(value);
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    const entry = value[key];
    if (entry === undefined) {
      continue;
    }
    normalized[key] = normalizeJsonValue(entry, seen);
  }
  seen.delete(value);
  return normalized;
}

function serializeArchiveBlobContent(input: unknown): {
  bytes: Buffer;
  contentType: string;
  encoding: ContextArchiveBlobEncoding;
} {
  if (typeof input === "string") {
    return {
      bytes: Buffer.from(input, "utf8"),
      contentType: "text/plain; charset=utf-8",
      encoding: "utf8",
    };
  }
  if (input instanceof Uint8Array) {
    return {
      bytes: Buffer.from(input),
      contentType: "application/octet-stream",
      encoding: "base64",
    };
  }
  const normalized = normalizeJsonValue(input);
  return {
    bytes: Buffer.from(JSON.stringify(normalized), "utf8"),
    contentType: "application/json; charset=utf-8",
    encoding: "utf8",
  };
}

async function writeBufferAtomic(filePath: string, bytes: Buffer): Promise<void> {
  const tmpPath = `${filePath}.${newContextArchiveId("tmp")}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(tmpPath, bytes, { mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

async function readBlobMeta(metaPath: string): Promise<BlobMetaFile | null> {
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as BlobMetaFile;
    if (parsed?.version !== 1 || typeof parsed.sha256 !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type ContextArchiveBlobStore = ReturnType<typeof createContextArchiveBlobStore>;

export function createContextArchiveBlobStore(
  params?: { rootDir?: string; env?: NodeJS.ProcessEnv },
) {
  const rootDir = path.resolve(
    params?.rootDir?.trim() || path.join(resolveStateDir(params?.env), "context-archive"),
  );
  const blobDir = path.join(rootDir, "blobs");
  const withLock = createAsyncLock();

  async function putBlob(input: ContextArchiveBlobInput): Promise<ContextArchiveStoredBlob> {
    return withLock(async () => {
      const createdAt = input.createdAt ?? Date.now();
      const serialized = serializeArchiveBlobContent(input.content);
      const bytes = serialized.bytes;
      const contentType = input.contentType?.trim() || serialized.contentType;
      const sha256 = sha256Hex(bytes);
      const blobId = `blob_${sha256.slice(0, 16)}`;
      const blobPath = path.join(blobDir, `${sha256}.blob`);
      const metaPath = path.join(blobDir, `${sha256}.json`);
      const existingMeta = await readBlobMeta(metaPath);
      if (existingMeta) {
        return {
          blobId: existingMeta.blobId,
          sha256: existingMeta.sha256,
          contentType: existingMeta.contentType,
          encoding: existingMeta.encoding,
          sizeBytes: existingMeta.sizeBytes,
          createdAt: existingMeta.createdAt,
          path: blobPath,
          metaPath,
          ...(existingMeta.metadata ? { metadata: existingMeta.metadata } : {}),
        };
      }

      await writeBufferAtomic(blobPath, bytes);
      const meta: BlobMetaFile = {
        version: 1,
        blobId,
        sha256,
        contentType,
        encoding: serialized.encoding,
        sizeBytes: bytes.byteLength,
        createdAt,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
      await writeJsonAtomic(metaPath, meta, { mode: 0o600 });
      return {
        blobId,
        sha256,
        contentType,
        encoding: serialized.encoding,
        sizeBytes: bytes.byteLength,
        createdAt,
        path: blobPath,
        metaPath,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
    });
  }

  async function readBlobRecord(sha256: string): Promise<ContextArchiveStoredBlob | null> {
    const blobPath = path.join(blobDir, `${sha256}.blob`);
    const metaPath = path.join(blobDir, `${sha256}.json`);
    const meta = await readBlobMeta(metaPath);
    if (meta) {
      return {
        blobId: meta.blobId,
        sha256: meta.sha256,
        contentType: meta.contentType,
        encoding: meta.encoding,
        sizeBytes: meta.sizeBytes,
        createdAt: meta.createdAt,
        path: blobPath,
        metaPath,
        ...(meta.metadata ? { metadata: meta.metadata } : {}),
      };
    }
    const stat = await fs.stat(blobPath).catch(() => null);
    if (!stat?.isFile()) {
      return null;
    }
    return {
      blobId: `blob_${sha256.slice(0, 16)}`,
      sha256,
      contentType: "application/octet-stream",
      encoding: "base64",
      sizeBytes: stat.size,
      createdAt: Math.floor(stat.mtimeMs),
      path: blobPath,
      metaPath,
    };
  }

  async function readBlobBytes(sha256: string): Promise<Buffer | null> {
    const record = await readBlobRecord(sha256);
    if (!record) {
      return null;
    }
    return fs.readFile(record.path);
  }

  async function readBlobText(sha256: string): Promise<string | null> {
    const bytes = await readBlobBytes(sha256);
    if (!bytes) {
      return null;
    }
    return bytes.toString("utf8");
  }

  async function readBlobJson<T>(sha256: string): Promise<T | null> {
    const text = await readBlobText(sha256);
    if (text == null) {
      return null;
    }
    return JSON.parse(text) as T;
  }

  async function deleteBlob(sha256: string): Promise<void> {
    const blobPath = path.join(blobDir, `${sha256}.blob`);
    const metaPath = path.join(blobDir, `${sha256}.json`);
    await Promise.all([
      fs.rm(blobPath, { force: true }).catch(() => undefined),
      fs.rm(metaPath, { force: true }).catch(() => undefined),
    ]);
  }

  return {
    rootDir,
    blobDir,
    putBlob,
    readBlobRecord,
    readBlobBytes,
    readBlobText,
    readBlobJson,
    deleteBlob,
  };
}

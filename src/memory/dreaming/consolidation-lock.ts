import fs from "node:fs/promises";
import path from "node:path";
import { resolveDurableMemoryScopeDir, type DurableMemoryScope } from "../durable/scope.ts";

export const DREAM_CONSOLIDATION_LOCK_FILE = ".consolidate-lock";

type LockFileState = "running" | "idle";

type LockFilePayload = {
  state?: LockFileState;
  owner?: string;
  pid?: number;
  acquiredAt?: number;
  consolidatedAt?: number;
};

export type DreamConsolidationStatus = {
  exists: boolean;
  lockPath: string;
  lastConsolidatedAt: number | null;
  lockOwner: string | null;
  lockAcquiredAt: number | null;
  lockActive: boolean;
  lockStale: boolean;
};

export type DreamConsolidationLock = {
  lockPath: string;
  owner: string;
  acquiredAt: number;
  previousContent: string | null;
  previousMtimeMs: number | null;
};

function resolveLockPath(scope: DurableMemoryScope): string {
  return path.join(resolveDurableMemoryScopeDir(scope), DREAM_CONSOLIDATION_LOCK_FILE);
}

function parseLockPayload(raw: string | null): LockFilePayload {
  if (!raw?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as LockFilePayload) : {};
  } catch {
    return {};
  }
}

async function readLockFile(lockPath: string): Promise<{
  content: string | null;
  mtimeMs: number | null;
  payload: LockFilePayload;
}> {
  try {
    const [stat, content] = await Promise.all([fs.stat(lockPath), fs.readFile(lockPath, "utf8")]);
    return {
      content,
      mtimeMs: stat.mtimeMs,
      payload: parseLockPayload(content),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { content: null, mtimeMs: null, payload: {} };
    }
    throw error;
  }
}

function isPidAlive(pid: number | undefined): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRunningLockActive(params: {
  payload: LockFilePayload;
  mtimeMs: number | null;
  staleAfterMs: number;
  now: number;
}): boolean {
  if (params.payload.state !== "running") {
    return false;
  }
  const acquiredAt =
    typeof params.payload.acquiredAt === "number" && Number.isFinite(params.payload.acquiredAt)
      ? params.payload.acquiredAt
      : params.mtimeMs;
  if (acquiredAt == null) {
    return false;
  }
  const staleAfterMs = Math.max(1, params.staleAfterMs);
  if (params.now - acquiredAt >= staleAfterMs) {
    return false;
  }
  return params.payload.pid ? isPidAlive(params.payload.pid) : true;
}

async function writeLockPayload(params: {
  lockPath: string;
  payload: LockFilePayload;
  mtimeMs: number;
  exclusive?: boolean;
}): Promise<void> {
  await fs.mkdir(path.dirname(params.lockPath), { recursive: true });
  await fs.writeFile(params.lockPath, `${JSON.stringify(params.payload)}\n`, {
    flag: params.exclusive ? "wx" : "w",
  });
  const mtime = new Date(params.mtimeMs);
  await fs.utimes(params.lockPath, mtime, mtime);
}

export async function readDreamConsolidationStatus(params: {
  scope: DurableMemoryScope;
  staleAfterMs: number;
  now?: number;
}): Promise<DreamConsolidationStatus> {
  const lockPath = resolveLockPath(params.scope);
  const now = params.now ?? Date.now();
  const current = await readLockFile(lockPath);
  const lockActive = isRunningLockActive({
    payload: current.payload,
    mtimeMs: current.mtimeMs,
    staleAfterMs: params.staleAfterMs,
    now,
  });
  const acquiredAt =
    typeof current.payload.acquiredAt === "number" && Number.isFinite(current.payload.acquiredAt)
      ? current.payload.acquiredAt
      : null;
  return {
    exists: current.mtimeMs != null,
    lockPath,
    lastConsolidatedAt: current.mtimeMs,
    lockOwner: lockActive ? (current.payload.owner ?? null) : null,
    lockAcquiredAt: lockActive ? acquiredAt : null,
    lockActive,
    lockStale:
      current.payload.state === "running" &&
      !lockActive &&
      current.mtimeMs != null &&
      now - current.mtimeMs >= Math.max(1, params.staleAfterMs),
  };
}

export async function tryAcquireDreamConsolidationLock(params: {
  scope: DurableMemoryScope;
  owner: string;
  staleAfterMs: number;
  now?: number;
}): Promise<
  | { acquired: false; status: DreamConsolidationStatus }
  | { acquired: true; lock: DreamConsolidationLock }
> {
  const lockPath = resolveLockPath(params.scope);
  const now = params.now ?? Date.now();
  const payload: LockFilePayload = {
    state: "running",
    owner: params.owner,
    pid: process.pid,
    acquiredAt: now,
  };
  try {
    await writeLockPayload({
      lockPath,
      payload,
      mtimeMs: now,
      exclusive: true,
    });
    return {
      acquired: true,
      lock: {
        lockPath,
        owner: params.owner,
        acquiredAt: now,
        previousContent: null,
        previousMtimeMs: null,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  const previous = await readLockFile(lockPath);
  const active = isRunningLockActive({
    payload: previous.payload,
    mtimeMs: previous.mtimeMs,
    staleAfterMs: params.staleAfterMs,
    now,
  });
  if (active && previous.payload.owner !== params.owner) {
    return {
      acquired: false,
      status: await readDreamConsolidationStatus({
        scope: params.scope,
        staleAfterMs: params.staleAfterMs,
        now,
      }),
    };
  }

  await writeLockPayload({
    lockPath,
    payload,
    mtimeMs: now,
  });
  return {
    acquired: true,
    lock: {
      lockPath,
      owner: params.owner,
      acquiredAt: now,
      previousContent: previous.content,
      previousMtimeMs: previous.mtimeMs,
    },
  };
}

export async function markDreamConsolidationSucceeded(lock: DreamConsolidationLock): Promise<void> {
  await writeLockPayload({
    lockPath: lock.lockPath,
    payload: {
      state: "idle",
      consolidatedAt: lock.acquiredAt,
    },
    mtimeMs: lock.acquiredAt,
  });
}

export async function rollbackDreamConsolidationLock(lock: DreamConsolidationLock): Promise<void> {
  if (lock.previousMtimeMs == null) {
    await fs.rm(lock.lockPath, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(lock.lockPath), { recursive: true });
  await fs.writeFile(lock.lockPath, lock.previousContent ?? "");
  const previous = new Date(lock.previousMtimeMs);
  await fs.utimes(lock.lockPath, previous, previous);
}

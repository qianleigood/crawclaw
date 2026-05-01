import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComfyApiPrompt,
  ComfyGraphDiagnostic,
  ComfyGraphIr,
  ComfyMediaKind,
  ComfyOutputArtifact,
} from "./graph-ir.js";

export type ComfyWorkflowMeta = {
  goal: string;
  baseUrl: string;
  catalogFingerprint: string;
  mediaKind: ComfyMediaKind;
  diagnostics: ComfyGraphDiagnostic[];
  createdAt?: string;
  updatedAt?: string;
  promptId?: string;
  outputs?: ComfyOutputArtifact[];
};

export type SavedWorkflowArtifacts = {
  workflowId: string;
  irPath: string;
  promptPath: string;
  metaPath: string;
};

export type ComfyRunStatus = "queued" | "running" | "success" | "failed" | "timed_out" | "unknown";

export type ComfyRunRecord = {
  workflowId: string;
  promptId: string;
  status: ComfyRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  outputs?: ComfyOutputArtifact[];
};

export type ComfyWorkflowPaths = {
  irPath: string;
  promptPath: string;
  metaPath: string;
};

export type ComfyWorkflowSummary = {
  workflowId: string;
  goal: string;
  baseUrl: string;
  catalogFingerprint: string;
  mediaKind: ComfyMediaKind;
  diagnosticsCount: number;
  createdAt?: string;
  updatedAt?: string;
  promptId?: string;
  outputCount: number;
  lastRun?: ComfyRunRecord;
  paths: ComfyWorkflowPaths;
};

export type ComfyWorkflowDetail = {
  workflowId: string;
  ir: ComfyGraphIr;
  prompt: ComfyApiPrompt;
  meta: ComfyWorkflowMeta;
  paths: ComfyWorkflowPaths;
};

export type ComfyOutputSummary = ComfyOutputArtifact & {
  workflowId: string;
  promptId: string;
  status: ComfyRunStatus;
  createdAt?: string;
};

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
  return slug || "comfyui-workflow";
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateWorkflowId(workflowId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(workflowId)) {
    throw new Error(`Invalid ComfyUI workflow id: ${workflowId}`);
  }
}

function isInvalidWorkflowIdError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Invalid ComfyUI workflow id");
}

function workflowPaths(workflowsDir: string, workflowId: string): ComfyWorkflowPaths {
  validateWorkflowId(workflowId);
  const prefix = path.join(workflowsDir, workflowId);
  return {
    irPath: `${prefix}.ir.json`,
    promptPath: `${prefix}.prompt.json`,
    metaPath: `${prefix}.meta.json`,
  };
}

function runsPath(workflowsDir: string, workflowId: string): string {
  validateWorkflowId(workflowId);
  return path.join(workflowsDir, `${workflowId}.runs.jsonl`);
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isComfyOutputKind(value: unknown): value is ComfyOutputArtifact["kind"] {
  return value === "image" || value === "video" || value === "audio" || value === "unknown";
}

function isComfyMediaKind(value: unknown): value is ComfyMediaKind {
  return value === "image" || value === "video" || value === "audio" || value === "mixed";
}

function parseOutputArtifact(value: unknown): ComfyOutputArtifact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const artifact = value as Partial<ComfyOutputArtifact>;
  if (
    !isComfyOutputKind(artifact.kind) ||
    typeof artifact.nodeId !== "string" ||
    typeof artifact.filename !== "string" ||
    !isOptionalString(artifact.subfolder) ||
    !isOptionalString(artifact.type) ||
    !isOptionalString(artifact.mime) ||
    !isOptionalString(artifact.localPath)
  ) {
    return null;
  }
  return {
    kind: artifact.kind,
    nodeId: artifact.nodeId,
    filename: artifact.filename,
    subfolder: artifact.subfolder,
    type: artifact.type,
    mime: artifact.mime,
    localPath: artifact.localPath,
  };
}

function parseRunRecord(value: unknown): ComfyRunRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<ComfyRunRecord>;
  if (
    typeof record.workflowId !== "string" ||
    typeof record.promptId !== "string" ||
    typeof record.startedAt !== "string"
  ) {
    return null;
  }
  try {
    validateWorkflowId(record.workflowId);
  } catch {
    return null;
  }
  const status: ComfyRunStatus =
    record.status === "queued" ||
    record.status === "running" ||
    record.status === "success" ||
    record.status === "failed" ||
    record.status === "timed_out" ||
    record.status === "unknown"
      ? record.status
      : "unknown";
  return {
    workflowId: record.workflowId,
    promptId: record.promptId,
    status,
    startedAt: record.startedAt,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
    outputs: Array.isArray(record.outputs)
      ? record.outputs.flatMap((output) => {
          const artifact = parseOutputArtifact(output);
          return artifact ? [artifact] : [];
        })
      : undefined,
  };
}

function newestTimestamp(record: Pick<ComfyRunRecord, "startedAt" | "completedAt">): number {
  const timestamp = Date.parse(record.startedAt);
  if (!Number.isNaN(timestamp)) {
    return timestamp;
  }
  const completed = record.completedAt ? Date.parse(record.completedAt) : NaN;
  return Number.isNaN(completed) ? 0 : completed;
}

function workflowSortTimestamp(summary: ComfyWorkflowSummary): number {
  const value = summary.lastRun?.startedAt ?? summary.updatedAt ?? summary.createdAt;
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export async function saveWorkflowArtifacts(params: {
  workflowsDir: string;
  ir: ComfyGraphIr;
  prompt: ComfyApiPrompt;
  meta: ComfyWorkflowMeta;
  now?: () => Date;
}): Promise<SavedWorkflowArtifacts> {
  const workflowId = slugify(params.ir.goal);
  const { irPath, promptPath, metaPath } = workflowPaths(params.workflowsDir, workflowId);
  await writeJson(irPath, params.ir);
  await writeJson(promptPath, params.prompt);
  await writeJson(metaPath, {
    ...params.meta,
    createdAt: params.meta.createdAt ?? (params.now ?? (() => new Date()))().toISOString(),
  });
  return { workflowId, irPath, promptPath, metaPath };
}

export async function loadWorkflowArtifacts(params: {
  workflowsDir: string;
  workflowId: string;
}): Promise<{ ir: ComfyGraphIr; prompt: ComfyApiPrompt; meta: ComfyWorkflowMeta }> {
  const { irPath, promptPath, metaPath } = workflowPaths(params.workflowsDir, params.workflowId);
  const [ir, prompt, meta] = await Promise.all([
    readFile(irPath, "utf8"),
    readFile(promptPath, "utf8"),
    readFile(metaPath, "utf8"),
  ]);
  return {
    ir: parseJson<ComfyGraphIr>(ir),
    prompt: parseJson<ComfyApiPrompt>(prompt),
    meta: parseJson<ComfyWorkflowMeta>(meta),
  };
}

export async function loadWorkflowDetail(params: {
  workflowsDir: string;
  workflowId: string;
}): Promise<ComfyWorkflowDetail> {
  const artifacts = await loadWorkflowArtifacts(params);
  return {
    workflowId: params.workflowId,
    ...artifacts,
    paths: workflowPaths(params.workflowsDir, params.workflowId),
  };
}

export async function appendWorkflowRunRecord(params: {
  workflowsDir: string;
  workflowId: string;
  record: ComfyRunRecord;
}): Promise<void> {
  const filePath = runsPath(params.workflowsDir, params.workflowId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(
    filePath,
    `${JSON.stringify({ ...params.record, workflowId: params.workflowId })}\n`,
    "utf8",
  );
}

export async function listWorkflowRunRecords(params: {
  workflowsDir: string;
  workflowId?: string;
  limit?: number;
}): Promise<ComfyRunRecord[]> {
  const limit = params.limit ?? 50;
  if (limit <= 0) {
    return [];
  }
  let runFiles: string[];
  if (params.workflowId) {
    runFiles = [runsPath(params.workflowsDir, params.workflowId)];
  } else {
    try {
      const entries = await readdir(params.workflowsDir);
      runFiles = entries
        .filter((entry) => entry.endsWith(".runs.jsonl"))
        .flatMap((entry) => {
          const workflowId = entry.slice(0, -".runs.jsonl".length);
          try {
            return [runsPath(params.workflowsDir, workflowId)];
          } catch (error) {
            if (isInvalidWorkflowIdError(error)) {
              return [];
            }
            throw error;
          }
        });
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
  }

  const records: ComfyRunRecord[] = [];
  for (const filePath of runFiles) {
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        continue;
      }
      throw error;
    }
    for (const line of text.split(/\r?\n/u)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const record = parseRunRecord(JSON.parse(line));
        if (record && (!params.workflowId || record.workflowId === params.workflowId)) {
          records.push(record);
        }
      } catch {
        // Skip malformed JSONL lines so one bad write does not hide older runs.
      }
    }
  }

  return records
    .sort((left, right) => newestTimestamp(right) - newestTimestamp(left))
    .slice(0, limit);
}

export async function listWorkflowArtifacts(params: {
  workflowsDir: string;
  limit?: number;
}): Promise<ComfyWorkflowSummary[]> {
  const limit = params.limit ?? 100;
  if (limit <= 0) {
    return [];
  }
  let entries: string[];
  try {
    entries = await readdir(params.workflowsDir);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }

  const summaries: ComfyWorkflowSummary[] = [];
  for (const entry of entries.filter((value) => value.endsWith(".meta.json"))) {
    const workflowId = entry.slice(0, -".meta.json".length);
    let paths: ComfyWorkflowPaths;
    try {
      paths = workflowPaths(params.workflowsDir, workflowId);
      const meta = parseJson<ComfyWorkflowMeta>(await readFile(paths.metaPath, "utf8"));
      if (
        typeof meta.goal !== "string" ||
        typeof meta.baseUrl !== "string" ||
        typeof meta.catalogFingerprint !== "string" ||
        !isComfyMediaKind(meta.mediaKind) ||
        !Array.isArray(meta.diagnostics)
      ) {
        continue;
      }
      const lastRun = (
        await listWorkflowRunRecords({ workflowsDir: params.workflowsDir, workflowId, limit: 1 })
      )[0];
      summaries.push({
        workflowId,
        goal: meta.goal,
        baseUrl: meta.baseUrl,
        catalogFingerprint: meta.catalogFingerprint,
        mediaKind: meta.mediaKind,
        diagnosticsCount: meta.diagnostics.length,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        promptId: lastRun?.promptId ?? meta.promptId,
        outputCount: lastRun?.outputs?.length ?? meta.outputs?.length ?? 0,
        lastRun,
        paths,
      });
    } catch (error) {
      if (isMissingFile(error)) {
        continue;
      }
      if (error instanceof SyntaxError) {
        continue;
      }
      if (isInvalidWorkflowIdError(error)) {
        continue;
      }
      throw error;
    }
  }

  return summaries
    .sort((left, right) => workflowSortTimestamp(right) - workflowSortTimestamp(left))
    .slice(0, limit);
}

export async function listWorkflowOutputSummaries(params: {
  workflowsDir: string;
  workflowId?: string;
  limit?: number;
}): Promise<ComfyOutputSummary[]> {
  const limit = params.limit ?? 50;
  if (limit <= 0) {
    return [];
  }
  const runs = await listWorkflowRunRecords({
    workflowsDir: params.workflowsDir,
    workflowId: params.workflowId,
    limit: Number.MAX_SAFE_INTEGER,
  });
  return runs
    .flatMap((run) =>
      (run.outputs ?? []).map((output) => ({
        ...output,
        workflowId: run.workflowId,
        promptId: run.promptId,
        status: run.status,
        createdAt: run.startedAt,
      })),
    )
    .slice(0, limit);
}

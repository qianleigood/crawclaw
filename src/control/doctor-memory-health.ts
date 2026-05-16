import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readdirSync,
  readFileSync,
  type Dirent,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "@photostructure/sqlite";
import type { CrawClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { formatCliCommand } from "../terminal/command-format.js";
import { note } from "../terminal/note.js";

export type DoctorMemoryHealthLevel = "ok" | "warn" | "error";

export interface DoctorNotebookLmMemoryHealth {
  kind: "notebooklm";
  level: DoctorMemoryHealthLevel;
  enabled: boolean;
  lifecycle: "disabled" | "removed";
  ready: boolean;
  reason: "notebooklm_removed" | null;
  profile: string;
  notebookId?: string;
  lastValidatedAt?: string;
  nextAllowedRefreshAt?: string;
  recommendedAction?: string;
  details?: string;
}

export interface DoctorDurableMemoryHealth {
  kind: "durable";
  level: DoctorMemoryHealthLevel;
  rootDir: string;
  rootExists: boolean;
  parentWritable: boolean;
  rootWritable: boolean;
  extractionEnabled: boolean;
  extractionMaxNotesPerTurn: number;
  extractionMinEligibleTurnsBetweenRuns: number;
  extractionMaxConcurrentWorkers: number;
  extractionWorkerIdleTtlMs: number;
  extractionWorkers: {
    workerCount: number;
    runningCount: number;
    queuedCount: number;
    idleWorkers: number;
    cooldownWorkers: number;
  };
  markdownFilesScanned: number;
  manifestReadable: boolean;
  parseErrors: string[];
  details?: string;
  recommendedAction?: string;
}

export interface DoctorSessionMemoryHealth {
  kind: "session";
  level: DoctorMemoryHealthLevel;
  dbPath: string;
  dbExists: boolean;
  parentWritable: boolean;
  storeAccessible: boolean;
  sessionTableAccessible: boolean;
  contextAssemblyTableAccessible: boolean;
  details?: string;
  recommendedAction?: string;
}

export interface DoctorMemoryHealthSummary {
  overall: DoctorMemoryHealthLevel;
  notebooklm: DoctorNotebookLmMemoryHealth;
  durable: DoctorDurableMemoryHealth;
  session: DoctorSessionMemoryHealth;
}

function maxLevel(levels: DoctorMemoryHealthLevel[]): DoctorMemoryHealthLevel {
  if (levels.includes("error")) {
    return "error";
  }
  if (levels.includes("warn")) {
    return "warn";
  }
  return "ok";
}

function checkWritableDir(targetDir: string): boolean {
  try {
    accessSync(targetDir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveHome(input: string): string {
  if (input === "~") {
    return osHomeDir();
  }
  if (input.startsWith("~/")) {
    return path.join(osHomeDir(), input.slice(2));
  }
  return input;
}

function osHomeDir(): string {
  return process.env.HOME || process.cwd();
}

function resolveStateDir(): string {
  return path.resolve(
    process.env.CRAWCLAW_STATE_DIR?.trim() || path.join(osHomeDir(), ".crawclaw"),
  );
}

function resolveDurableMemoryRootDir(): string {
  const override = process.env.CRAWCLAW_DURABLE_MEMORY_DIR?.trim();
  return override ? path.resolve(override) : path.join(resolveStateDir(), "durable-memory");
}

function parseMarkdownFrontmatter(text: string): void {
  if (!text.startsWith("---\n")) {
    return;
  }
  const close = text.indexOf("\n---", 4);
  if (close === -1) {
    throw new Error("frontmatter is not closed");
  }
}

function readConfigRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveMemoryHealthConfig(cfg: CrawClawConfig) {
  const memory = readConfigRecord(cfg.memory);
  const runtimeStore = readConfigRecord(memory.runtimeStore);
  const durableExtraction = readConfigRecord(memory.durableExtraction);
  return {
    runtimeStore: {
      dbPath:
        typeof runtimeStore.dbPath === "string" && runtimeStore.dbPath.trim()
          ? runtimeStore.dbPath.trim()
          : "~/.crawclaw/memory-runtime.db",
    },
    durableExtraction: {
      enabled: readBoolean(durableExtraction.enabled, true),
      maxNotesPerTurn: readNumber(durableExtraction.maxNotesPerTurn, 2),
      minEligibleTurnsBetweenRuns: readNumber(durableExtraction.minEligibleTurnsBetweenRuns, 1),
      maxConcurrentWorkers: readNumber(durableExtraction.maxConcurrentWorkers, 2),
      workerIdleTtlMs: readNumber(durableExtraction.workerIdleTtlMs, 15 * 60_000),
    },
  };
}

function listMarkdownFiles(rootDir: string, limit = 50): string[] {
  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0 && files.length < limit) {
    const next = stack.pop();
    if (!next) {
      break;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(next, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryName = entry.name;
      const absolute = path.join(next, entryName);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile() && /\.md$/i.test(entryName)) {
        files.push(absolute);
        if (files.length >= limit) {
          break;
        }
      }
    }
  }
  return files;
}

export async function checkNotebookLmMemoryHealth(
  cfg: CrawClawConfig,
): Promise<DoctorNotebookLmMemoryHealth> {
  const enabled = readConfigRecord(readConfigRecord(cfg.memory).notebooklm).enabled === true;
  return {
    kind: "notebooklm",
    level: enabled ? "warn" : "ok",
    enabled,
    lifecycle: enabled ? "removed" : "disabled",
    ready: false,
    reason: enabled ? "notebooklm_removed" : null,
    profile: "default",
    recommendedAction: enabled
      ? "Disable memory.notebooklm; NotebookLM runtime was removed"
      : undefined,
    details: enabled
      ? "NotebookLM TS runtime integration has been removed from the production runtime."
      : undefined,
  };
}

export async function checkDurableMemoryHealth(
  cfg: CrawClawConfig,
): Promise<DoctorDurableMemoryHealth> {
  const memoryConfig = resolveMemoryHealthConfig(cfg);
  const rootDir = resolveDurableMemoryRootDir();
  const rootExists = existsSync(rootDir);
  const parentDir = path.dirname(rootDir);
  const parentWritable = checkWritableDir(parentDir);
  const rootWritable = rootExists ? checkWritableDir(rootDir) : false;
  const parseErrors: string[] = [];
  let manifestReadable = true;
  let markdownFilesScanned = 0;
  if (rootExists) {
    const markdownFiles = listMarkdownFiles(rootDir);
    markdownFilesScanned = markdownFiles.length;
    for (const filePath of markdownFiles) {
      try {
        const text = readFileSync(filePath, "utf8");
        parseMarkdownFrontmatter(text);
      } catch (error) {
        parseErrors.push(
          `${path.relative(rootDir, filePath)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } else {
    manifestReadable = false;
  }

  let level: DoctorMemoryHealthLevel = "ok";
  let details: string | undefined;
  let recommendedAction: string | undefined;

  if (!rootExists) {
    level = parentWritable ? "warn" : "error";
    details = parentWritable
      ? "Durable memory root has not been created yet."
      : "Durable memory root parent is not writable.";
    recommendedAction = parentWritable
      ? `Maintain durable notes via ${formatCliCommand("memory_manifest_read")}, ${formatCliCommand("memory_note_read")}, ${formatCliCommand("memory_note_write")}, ${formatCliCommand("memory_note_edit")}, and ${formatCliCommand("memory_note_delete")}`
      : `Check permissions for ${parentDir}`;
  } else if (!rootWritable) {
    level = "error";
    details = "Durable memory root is not writable.";
    recommendedAction = `Check permissions for ${rootDir}`;
  } else if (parseErrors.length > 0) {
    level = "warn";
    details = "Some durable memory markdown files could not be parsed cleanly.";
    recommendedAction = `Inspect durable notes under ${rootDir}`;
  }

  return {
    kind: "durable",
    level,
    rootDir,
    rootExists,
    parentWritable,
    rootWritable,
    extractionEnabled: memoryConfig.durableExtraction.enabled,
    extractionMaxNotesPerTurn: memoryConfig.durableExtraction.maxNotesPerTurn,
    extractionMinEligibleTurnsBetweenRuns:
      memoryConfig.durableExtraction.minEligibleTurnsBetweenRuns,
    extractionMaxConcurrentWorkers: memoryConfig.durableExtraction.maxConcurrentWorkers,
    extractionWorkerIdleTtlMs: memoryConfig.durableExtraction.workerIdleTtlMs,
    extractionWorkers: {
      workerCount: 0,
      runningCount: 0,
      queuedCount: 0,
      idleWorkers: 0,
      cooldownWorkers: 0,
    },
    markdownFilesScanned,
    manifestReadable,
    parseErrors,
    details,
    recommendedAction,
  };
}

export async function checkSessionMemoryHealth(
  cfg: CrawClawConfig,
): Promise<DoctorSessionMemoryHealth> {
  const memoryConfig = resolveMemoryHealthConfig(cfg);
  const dbPath = resolveHome(memoryConfig.runtimeStore.dbPath);
  const dbExists = existsSync(dbPath);
  const parentDir = path.dirname(dbPath);
  const parentWritable = checkWritableDir(parentDir);
  let storeAccessible = false;
  let sessionTableAccessible = false;
  let contextAssemblyTableAccessible = false;
  let details: string | undefined;
  let recommendedAction: string | undefined;

  if (dbExists) {
    try {
      const db = new DatabaseSync(dbPath);
      try {
        db.prepare("SELECT 1 FROM gm_session_summary_state LIMIT 1").get();
        sessionTableAccessible = true;
      } catch {
        sessionTableAccessible = false;
      }
      try {
        db.prepare("SELECT 1 FROM gm_context_assembly_audits LIMIT 1").get();
        contextAssemblyTableAccessible = true;
      } catch {
        contextAssemblyTableAccessible = false;
      }
      storeAccessible = true;
      db.close();
    } catch (error) {
      details = error instanceof Error ? error.message : String(error);
    }
  }

  let level: DoctorMemoryHealthLevel = "ok";
  if (!dbExists) {
    level = parentWritable ? "warn" : "error";
    details = parentWritable
      ? "Session runtime database has not been created yet."
      : "Session runtime database parent directory is not writable.";
    recommendedAction = parentWritable
      ? `Run CrawClaw once to initialize ${dbPath}`
      : `Check permissions for ${parentDir}`;
  } else if (!storeAccessible) {
    level = "error";
    details = details ?? "Session runtime database could not be opened.";
    recommendedAction = `Inspect ${dbPath}`;
  } else if (!sessionTableAccessible || !contextAssemblyTableAccessible) {
    level = "error";
    details = "Session runtime database is missing required memory tables.";
    recommendedAction = `Rebuild or repair ${dbPath}`;
  }

  return {
    kind: "session",
    level,
    dbPath,
    dbExists,
    parentWritable,
    storeAccessible,
    sessionTableAccessible,
    contextAssemblyTableAccessible,
    details,
    recommendedAction,
  };
}

export async function resolveDoctorMemoryHealth(
  cfg: CrawClawConfig,
): Promise<DoctorMemoryHealthSummary> {
  const [notebooklm, durable, session] = await Promise.all([
    checkNotebookLmMemoryHealth(cfg),
    checkDurableMemoryHealth(cfg),
    checkSessionMemoryHealth(cfg),
  ]);
  return {
    overall: maxLevel([notebooklm.level, durable.level, session.level]),
    notebooklm,
    durable,
    session,
  };
}

function formatLevel(level: DoctorMemoryHealthLevel): string {
  switch (level) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "error":
      return "error";
  }
  return level satisfies never;
}

export async function noteMemoryHealth(
  cfg: CrawClawConfig,
  opts?: {
    summary?: DoctorMemoryHealthSummary;
  },
): Promise<DoctorMemoryHealthSummary> {
  const summary = opts?.summary ?? (await resolveDoctorMemoryHealth(cfg));
  const lines = [
    `NotebookLM experience: ${formatLevel(summary.notebooklm.level)} (${summary.notebooklm.lifecycle}${summary.notebooklm.reason ? `, ${summary.notebooklm.reason}` : ""})`,
    `Durable memory: ${formatLevel(summary.durable.level)} (${summary.durable.rootExists ? "root ready" : "root missing"}; extraction ${summary.durable.extractionEnabled ? "enabled" : "disabled"}; workers ${summary.durable.extractionWorkers.runningCount}/${summary.durable.extractionWorkers.workerCount} running)`,
    `Session memory: ${formatLevel(summary.session.level)} (${summary.session.dbExists ? "runtime db ready" : "runtime db missing"})`,
  ];
  const actions = [
    summary.notebooklm.recommendedAction,
    summary.durable.recommendedAction,
    summary.session.recommendedAction,
  ].filter(
    (value, index, list): value is string => Boolean(value) && list.indexOf(value) === index,
  );
  if (actions.length > 0) {
    lines.push("", "Recommended actions:");
    for (const action of actions) {
      lines.push(`- ${action}`);
    }
  }
  note(lines.join("\n"), "Memory health");
  return summary;
}

export async function doctorMemoryCommand(
  runtime: RuntimeEnv,
  params: {
    cfg: CrawClawConfig;
    json?: boolean;
  },
): Promise<void> {
  const summary = await resolveDoctorMemoryHealth(params.cfg);
  if (params.json) {
    runtime.log(JSON.stringify(summary, null, 2));
    return;
  }
  await noteMemoryHealth(params.cfg, { summary });
}

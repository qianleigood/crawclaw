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
import { formatCliCommand } from "../cli/command-format.js";
import type { CrawClawConfig } from "../config/config.js";
import {
  getNotebookLmProviderState,
  getSharedDurableExtractionWorkerManagerStatus,
  normalizeNotebookLmConfig,
  parseMarkdownFrontmatter,
  resolveDurableMemoryRootDir,
  resolveHome,
  resolveMemoryConfig,
  type NotebookLmProviderState,
} from "../memory/command-api.js";
import type { RuntimeEnv } from "../runtime.js";
import { note } from "../terminal/note.js";

export type DoctorMemoryHealthLevel = "ok" | "warn" | "error";

export interface DoctorNotebookLmMemoryHealth {
  kind: "notebooklm";
  level: DoctorMemoryHealthLevel;
  enabled: boolean;
  lifecycle: NotebookLmProviderState["lifecycle"];
  ready: boolean;
  reason: NotebookLmProviderState["reason"];
  profile: string;
  notebookId?: string;
  lastValidatedAt?: string;
  nextAllowedRefreshAt?: string;
  recommendedAction?: NotebookLmProviderState["recommendedAction"];
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
  extractionRecentMessageLimit: number;
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
  if (levels.includes("error")) {return "error";}
  if (levels.includes("warn")) {return "warn";}
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

function listMarkdownFiles(rootDir: string, limit = 50): string[] {
  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0 && files.length < limit) {
    const next = stack.pop();
    if (!next) {break;}
    let entries: Dirent[];
    try {
      entries = readdirSync(next, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryName = String(entry.name);
      const absolute = path.join(next, entryName);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile() && /\.md$/i.test(entryName)) {
        files.push(absolute);
        if (files.length >= limit) {break;}
      }
    }
  }
  return files;
}

export async function checkNotebookLmMemoryHealth(
  cfg: CrawClawConfig,
): Promise<DoctorNotebookLmMemoryHealth> {
  const notebooklm = normalizeNotebookLmConfig(cfg.memory?.notebooklm ?? {});
  const state = await getNotebookLmProviderState({
    config: notebooklm,
    mode: "query",
  });
  return {
    kind: "notebooklm",
    level: state.ready ? "ok" : "warn",
    enabled: state.enabled,
    lifecycle: state.lifecycle,
    ready: state.ready,
    reason: state.reason,
    profile: state.profile,
    notebookId: state.notebookId,
    lastValidatedAt: state.lastValidatedAt,
    nextAllowedRefreshAt: state.nextAllowedRefreshAt,
    recommendedAction: state.recommendedAction,
    details: state.details,
  };
}

export async function checkDurableMemoryHealth(
  cfg: CrawClawConfig,
): Promise<DoctorDurableMemoryHealth> {
  const memoryConfig = resolveMemoryConfig({
    notebooklm: cfg.memory?.notebooklm ?? {},
    durableExtraction: (cfg.memory as { durableExtraction?: Record<string, unknown> } | undefined)?.durableExtraction ?? {},
  });
  const rootDir = resolveDurableMemoryRootDir();
  const rootExists = existsSync(rootDir);
  const parentDir = path.dirname(rootDir);
  const parentWritable = checkWritableDir(parentDir);
  const rootWritable = rootExists ? checkWritableDir(rootDir) : false;
  const parseErrors: string[] = [];
  let manifestReadable = true;
  let markdownFilesScanned = 0;
  const workerStatus = getSharedDurableExtractionWorkerManagerStatus();

  if (rootExists) {
    const markdownFiles = listMarkdownFiles(rootDir);
    markdownFilesScanned = markdownFiles.length;
    for (const filePath of markdownFiles) {
      try {
        const text = readFileSync(filePath, "utf8");
        parseMarkdownFrontmatter(text);
      } catch (error) {
        parseErrors.push(`${path.relative(rootDir, filePath)}: ${error instanceof Error ? error.message : String(error)}`);
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
    extractionRecentMessageLimit: memoryConfig.durableExtraction.recentMessageLimit,
    extractionMaxNotesPerTurn: memoryConfig.durableExtraction.maxNotesPerTurn,
    extractionMinEligibleTurnsBetweenRuns: memoryConfig.durableExtraction.minEligibleTurnsBetweenRuns,
    extractionMaxConcurrentWorkers: memoryConfig.durableExtraction.maxConcurrentWorkers,
    extractionWorkerIdleTtlMs: memoryConfig.durableExtraction.workerIdleTtlMs,
    extractionWorkers: {
      workerCount: workerStatus?.workerCount ?? 0,
      runningCount: workerStatus?.runningCount ?? 0,
      queuedCount: workerStatus?.queuedCount ?? 0,
      idleWorkers: workerStatus?.idleWorkers ?? 0,
      cooldownWorkers: workerStatus?.cooldownWorkers ?? 0,
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
  const memoryConfig = resolveMemoryConfig({
    notebooklm: cfg.memory?.notebooklm ?? {},
  });
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
}

export async function noteMemoryHealth(
  cfg: CrawClawConfig,
  opts?: {
    summary?: DoctorMemoryHealthSummary;
  },
): Promise<DoctorMemoryHealthSummary> {
  const summary = opts?.summary ?? (await resolveDoctorMemoryHealth(cfg));
  const lines = [
    `NotebookLM knowledge: ${formatLevel(summary.notebooklm.level)} (${summary.notebooklm.lifecycle}${summary.notebooklm.reason ? `, ${summary.notebooklm.reason}` : ""})`,
    `Durable memory: ${formatLevel(summary.durable.level)} (${summary.durable.rootExists ? "root ready" : "root missing"}; extraction ${summary.durable.extractionEnabled ? "enabled" : "disabled"}; workers ${summary.durable.extractionWorkers.runningCount}/${summary.durable.extractionWorkers.workerCount} running)`,
    `Session memory: ${formatLevel(summary.session.level)} (${summary.session.dbExists ? "runtime db ready" : "runtime db missing"})`,
  ];
  const actions = [
    summary.notebooklm.recommendedAction,
    summary.durable.recommendedAction,
    summary.session.recommendedAction,
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
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

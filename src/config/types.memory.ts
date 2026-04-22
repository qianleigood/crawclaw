import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd";
export type MemoryQmdSearchMode = "query" | "search" | "vsearch";
export type MemoryContextArchiveMode = "off" | "replay" | "full";

export type MemoryConfig = {
  backend?: MemoryBackend;
  qmd?: MemoryQmdConfig;
  notebooklm?: Record<string, unknown>;
  experience?: Record<string, unknown>;
  durableExtraction?: Record<string, unknown>;
  dreaming?: Record<string, unknown>;
  sessionSummary?: Record<string, unknown>;
  contextArchive?: MemoryContextArchiveConfig;
};

export type MemoryContextArchiveConfig = {
  enabled?: boolean;
  mode?: MemoryContextArchiveMode;
  rootDir?: string;
  compress?: boolean;
  redactSecrets?: boolean;
  retentionDays?: number;
  maxBlobBytes?: number;
  maxTotalBytes?: number;
};

export type MemoryQmdConfig = {
  command?: string;
  mcporter?: MemoryQmdMcporterConfig;
  searchMode?: MemoryQmdSearchMode;
  searchTool?: string;
  includeDefaultMemory?: boolean;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};

export type MemoryQmdMcporterConfig = {
  /**
   * Route QMD searches through mcporter (MCP runtime) instead of spawning `qmd` per query.
   * Requires:
   * - `mcporter` installed and on PATH
   * - A configured mcporter server that runs `qmd mcp` with `lifecycle: keep-alive`
   */
  enabled?: boolean;
  /** mcporter server name (defaults to "qmd") */
  serverName?: string;
  /** Start the mcporter daemon automatically (defaults to true when enabled). */
  startDaemon?: boolean;
};

export type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};

export type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  waitForBootSync?: boolean;
  embedInterval?: string;
  commandTimeoutMs?: number;
  updateTimeoutMs?: number;
  embedTimeoutMs?: number;
};

export type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};

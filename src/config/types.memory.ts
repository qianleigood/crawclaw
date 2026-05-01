export type MemoryContextArchiveMode = "off" | "replay" | "full";

export type MemoryConfig = {
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

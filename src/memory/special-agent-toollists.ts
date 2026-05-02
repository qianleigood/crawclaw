export const MEMORY_FILE_MUTATING_TOOL_ALLOWLIST = [
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
] as const;

export const MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST = [
  "memory_manifest_read",
  "memory_note_read",
  ...MEMORY_FILE_MUTATING_TOOL_ALLOWLIST,
] as const;

export const DREAM_MEMORY_MAINTENANCE_TOOL_ALLOWLIST = [
  "read",
  "exec",
  "write",
  "edit",
  ...MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST,
] as const;

export const EXPERIENCE_MEMORY_MAINTENANCE_TOOL_ALLOWLIST = ["write_experience_note"] as const;

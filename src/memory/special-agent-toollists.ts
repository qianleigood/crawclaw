export const MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST = [
  "memory_manifest_read",
  "memory_note_read",
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
] as const;

export const DREAM_MEMORY_MAINTENANCE_TOOL_ALLOWLIST = [
  ...MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST,
  "memory_transcript_search",
] as const;

CREATE TABLE IF NOT EXISTS gm_context_assembly_audits (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  prompt TEXT,
  raw_message_count INTEGER NOT NULL,
  compacted_message_count INTEGER NOT NULL,
  raw_message_tokens INTEGER NOT NULL,
  compacted_message_tokens INTEGER NOT NULL,
  session_summary_tokens INTEGER,
  recall_tokens INTEGER,
  system_prompt_addition_tokens INTEGER,
  preserved_tail_start_turn INTEGER,
  compaction_state_present INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_context_assembly_audits_session_created
ON gm_context_assembly_audits(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_context_assembly_audits_created
ON gm_context_assembly_audits(created_at DESC);

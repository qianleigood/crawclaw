CREATE TABLE IF NOT EXISTS gm_compaction_audits (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  trigger TEXT,
  reason TEXT,
  token_budget INTEGER,
  current_token_count INTEGER,
  tokens_before INTEGER,
  tokens_after INTEGER,
  preserved_tail_start_turn INTEGER,
  summarized_messages INTEGER,
  kept_messages INTEGER,
  rewritten_entries INTEGER,
  bytes_freed INTEGER,
  skipped_already_compacted INTEGER,
  skipped_short INTEGER,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_compaction_audits_session_created
ON gm_compaction_audits(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_compaction_audits_kind_created
ON gm_compaction_audits(kind, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_session_compaction_state (
  session_id TEXT PRIMARY KEY,
  preserved_tail_start_turn INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_session_compaction_state_updated
ON gm_session_compaction_state(updated_at DESC);

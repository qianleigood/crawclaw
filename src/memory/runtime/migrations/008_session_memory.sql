CREATE TABLE IF NOT EXISTS gm_session_memory (
  session_id TEXT PRIMARY KEY,
  summary_text TEXT NOT NULL,
  last_summarized_turn INTEGER NOT NULL,
  last_summarized_message_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_session_memory_updated
ON gm_session_memory(updated_at DESC);

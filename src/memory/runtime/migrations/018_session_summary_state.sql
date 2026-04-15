CREATE TABLE IF NOT EXISTS gm_session_summary_state (
  session_id TEXT PRIMARY KEY,
  last_summarized_message_id TEXT,
  last_summary_updated_at INTEGER,
  tokens_at_last_summary INTEGER NOT NULL DEFAULT 0,
  summary_in_progress INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gm_session_summary_state_updated_at
  ON gm_session_summary_state(updated_at DESC);

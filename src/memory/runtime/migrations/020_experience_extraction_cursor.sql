CREATE TABLE IF NOT EXISTS gm_experience_extraction_cursor (
  session_id TEXT PRIMARY KEY,
  session_key TEXT,
  last_extracted_turn INTEGER NOT NULL DEFAULT 0,
  last_extracted_message_id TEXT,
  last_run_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_experience_extraction_cursor_session_key
  ON gm_experience_extraction_cursor(session_key);

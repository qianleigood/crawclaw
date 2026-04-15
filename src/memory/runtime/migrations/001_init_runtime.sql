CREATE TABLE IF NOT EXISTS gm_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  conversation_uid TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  extracted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_messages_session_turn
ON gm_messages(session_id, turn_index);

CREATE TABLE IF NOT EXISTS gm_extraction_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  conversation_uid TEXT NOT NULL,
  start_turn INTEGER NOT NULL,
  end_turn INTEGER NOT NULL,
  window_hash TEXT,
  trigger_reason TEXT,
  stage TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  heartbeat_at INTEGER,
  claimed_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_extraction_jobs_status_created
ON gm_extraction_jobs(status, created_at);

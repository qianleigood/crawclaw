CREATE TABLE IF NOT EXISTS gm_context_archive_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  conversation_uid TEXT NOT NULL,
  run_kind TEXT NOT NULL,
  archive_mode TEXT NOT NULL DEFAULT 'replay',
  status TEXT NOT NULL DEFAULT 'pending',
  turn_index INTEGER,
  task_id TEXT,
  agent_id TEXT,
  parent_agent_id TEXT,
  summary_json TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_context_archive_runs_session_created
  ON gm_context_archive_runs(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_context_archive_runs_conversation_created
  ON gm_context_archive_runs(conversation_uid, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_context_archive_runs_task_created
  ON gm_context_archive_runs(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_context_archive_runs_agent_created
  ON gm_context_archive_runs(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_context_archive_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES gm_context_archive_runs(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  turn_index INTEGER,
  payload_json TEXT NOT NULL,
  payload_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_context_archive_events_run_sequence
  ON gm_context_archive_events(run_id, sequence ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS ix_gm_context_archive_events_kind_created
  ON gm_context_archive_events(event_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_context_archive_blobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES gm_context_archive_runs(id) ON DELETE CASCADE,
  blob_key TEXT NOT NULL,
  blob_hash TEXT NOT NULL,
  blob_kind TEXT,
  storage_path TEXT,
  content_type TEXT,
  byte_length INTEGER,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, blob_key)
);

CREATE INDEX IF NOT EXISTS ix_gm_context_archive_blobs_run_created
  ON gm_context_archive_blobs(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_context_archive_blobs_hash
  ON gm_context_archive_blobs(blob_hash);

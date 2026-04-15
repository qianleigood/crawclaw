CREATE TABLE IF NOT EXISTS gm_raw_events (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  session_id TEXT,
  conversation_uid TEXT,
  turn_index INTEGER,
  content_text TEXT NOT NULL DEFAULT '',
  content_blocks_json TEXT,
  has_media INTEGER NOT NULL DEFAULT 0,
  primary_media_id TEXT,
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_raw_events_status_created
ON gm_raw_events(status, created_at);

CREATE INDEX IF NOT EXISTS ix_gm_raw_events_session_turn
ON gm_raw_events(session_id, turn_index);

CREATE TABLE IF NOT EXISTS gm_media_assets (
  media_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  original_url TEXT,
  local_path TEXT,
  vault_path TEXT,
  mime_type TEXT,
  file_name TEXT,
  sha256 TEXT,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  alt TEXT,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_media_assets_sha256
ON gm_media_assets(sha256);

CREATE INDEX IF NOT EXISTS ix_gm_media_assets_status_updated
ON gm_media_assets(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS gm_message_media_refs (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  role TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(message_id) REFERENCES gm_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(media_id) REFERENCES gm_media_assets(media_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_gm_message_media_refs_message_ordinal
ON gm_message_media_refs(message_id, ordinal);

CREATE INDEX IF NOT EXISTS ix_gm_message_media_refs_media
ON gm_message_media_refs(media_id);

CREATE TABLE IF NOT EXISTS gm_pipeline_jobs (
  id TEXT PRIMARY KEY,
  job_kind TEXT NOT NULL,
  target_ref TEXT,
  status TEXT NOT NULL,
  payload_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_pipeline_jobs_status_created
ON gm_pipeline_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS gm_dead_letters (
  id TEXT PRIMARY KEY,
  source_job_id TEXT,
  job_kind TEXT NOT NULL,
  payload_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_dead_letters_created
ON gm_dead_letters(created_at DESC);

CREATE TABLE IF NOT EXISTS gm_recall_feedback (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  used_in_answer INTEGER NOT NULL DEFAULT 0,
  followup_supported INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(trace_id) REFERENCES gm_recall_traces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_gm_recall_feedback_trace_rank
ON gm_recall_feedback(trace_id, rank);

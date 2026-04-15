CREATE TABLE IF NOT EXISTS gm_maintenance_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  scope TEXT,
  trigger_source TEXT,
  summary TEXT,
  metrics_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS ix_gm_maintenance_runs_kind_created
ON gm_maintenance_runs(kind, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_merge_audits (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  canonical_node_id TEXT NOT NULL,
  merged_node_ids_json TEXT NOT NULL,
  score REAL,
  reason TEXT,
  mode TEXT NOT NULL,
  before_snapshot_json TEXT,
  after_snapshot_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_merge_audits_run_created
ON gm_merge_audits(run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_recall_traces (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  mode TEXT NOT NULL,
  memory_layer TEXT NOT NULL,
  trace_json TEXT NOT NULL,
  top_results_json TEXT,
  source TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_recall_traces_query_hash_created
ON gm_recall_traces(query_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_extraction_windows (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_turn INTEGER NOT NULL,
  end_turn INTEGER NOT NULL,
  window_hash TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_extraction_windows_session_created
ON gm_extraction_windows(session_id, created_at DESC);

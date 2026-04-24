CREATE TABLE IF NOT EXISTS gm_observation_runs (
  trace_id TEXT PRIMARY KEY,
  root_span_id TEXT,
  run_id TEXT,
  task_id TEXT,
  session_id TEXT,
  session_key TEXT,
  agent_id TEXT,
  parent_agent_id TEXT,
  workflow_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  started_at INTEGER,
  ended_at INTEGER,
  last_event_at INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  sources_json TEXT NOT NULL DEFAULT '[]',
  refs_json TEXT,
  summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_observation_runs_run
  ON gm_observation_runs(run_id);

CREATE INDEX IF NOT EXISTS ix_gm_observation_runs_task
  ON gm_observation_runs(task_id);

CREATE INDEX IF NOT EXISTS ix_gm_observation_runs_session
  ON gm_observation_runs(session_id, last_event_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_observation_runs_agent
  ON gm_observation_runs(agent_id, last_event_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_observation_runs_status
  ON gm_observation_runs(status, last_event_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_observation_runs_last_event
  ON gm_observation_runs(last_event_at DESC, trace_id DESC);

CREATE TABLE IF NOT EXISTS gm_observation_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  trace_id TEXT NOT NULL REFERENCES gm_observation_runs(trace_id) ON DELETE CASCADE,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  run_id TEXT,
  task_id TEXT,
  session_id TEXT,
  session_key TEXT,
  agent_id TEXT,
  parent_agent_id TEXT,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  phase TEXT,
  status TEXT,
  decision_code TEXT,
  summary TEXT NOT NULL DEFAULT '',
  observation_json TEXT NOT NULL,
  metrics_json TEXT,
  refs_json TEXT,
  payload_ref_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_observation_events_trace_created
  ON gm_observation_events(trace_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS ix_gm_observation_events_span
  ON gm_observation_events(trace_id, span_id);

CREATE INDEX IF NOT EXISTS ix_gm_observation_events_run
  ON gm_observation_events(run_id, created_at ASC);

CREATE INDEX IF NOT EXISTS ix_gm_observation_events_task
  ON gm_observation_events(task_id, created_at ASC);

CREATE INDEX IF NOT EXISTS ix_gm_observation_events_source_created
  ON gm_observation_events(source, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_observation_backfill_checkpoints (
  source TEXT PRIMARY KEY,
  cursor TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

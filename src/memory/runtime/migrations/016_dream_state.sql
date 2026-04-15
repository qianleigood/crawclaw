CREATE TABLE IF NOT EXISTS gm_session_scope (
  session_id TEXT PRIMARY KEY,
  session_key TEXT,
  scope_key TEXT NOT NULL,
  agent_id TEXT,
  channel TEXT,
  user_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gm_session_scope_scope_key
  ON gm_session_scope(scope_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS gm_dream_state (
  scope_key TEXT PRIMARY KEY,
  last_success_at INTEGER,
  last_attempt_at INTEGER,
  last_failure_at INTEGER,
  lock_owner TEXT,
  lock_acquired_at INTEGER,
  last_run_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gm_dream_state_lock_owner
  ON gm_dream_state(lock_owner);

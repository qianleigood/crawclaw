CREATE TABLE IF NOT EXISTS gm_promotion_candidates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_promotion_candidates_status_created
ON gm_promotion_candidates(status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_promotion_candidates_session_created
ON gm_promotion_candidates(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_promotion_decisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_note TEXT,
  reason TEXT,
  decision_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES gm_promotion_candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_gm_promotion_decisions_candidate_created
ON gm_promotion_decisions(candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_knowledge_sync_state (
  id TEXT PRIMARY KEY,
  note_path TEXT NOT NULL UNIQUE,
  note_id TEXT,
  content_hash TEXT,
  indexed_at INTEGER NOT NULL,
  last_error TEXT,
  source_write_audit_id TEXT,
  sync_json TEXT,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_knowledge_sync_state_status_indexed
ON gm_knowledge_sync_state(status, indexed_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_knowledge_sync_state_note_id
ON gm_knowledge_sync_state(note_id);

CREATE TABLE IF NOT EXISTS gm_knowledge_write_audits (
  id TEXT PRIMARY KEY,
  candidate_id TEXT,
  decision_id TEXT,
  action TEXT NOT NULL,
  note_path TEXT NOT NULL,
  target_note TEXT,
  requested_mode TEXT,
  effective_mode TEXT,
  before_hash TEXT,
  after_hash TEXT,
  before_snapshot_json TEXT,
  write_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES gm_promotion_candidates(id) ON DELETE SET NULL,
  FOREIGN KEY(decision_id) REFERENCES gm_promotion_decisions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_knowledge_write_audits_candidate_created
ON gm_knowledge_write_audits(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_knowledge_write_audits_note_created
ON gm_knowledge_write_audits(note_path, created_at DESC);

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

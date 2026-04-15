CREATE TABLE IF NOT EXISTS gm_knowledge_writeback_runs (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  review_id TEXT,
  status TEXT NOT NULL,
  note_path TEXT,
  write_audit_id TEXT,
  summary TEXT,
  error TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY(candidate_id) REFERENCES gm_promotion_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY(decision_id) REFERENCES gm_promotion_decisions(id) ON DELETE CASCADE,
  FOREIGN KEY(review_id) REFERENCES gm_promotion_reviews(id) ON DELETE SET NULL,
  FOREIGN KEY(write_audit_id) REFERENCES gm_knowledge_write_audits(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_knowledge_writeback_runs_candidate_created
ON gm_knowledge_writeback_runs(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_knowledge_writeback_runs_status_created
ON gm_knowledge_writeback_runs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_knowledge_writeback_runs_decision_created
ON gm_knowledge_writeback_runs(decision_id, created_at DESC);

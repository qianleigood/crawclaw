CREATE TABLE IF NOT EXISTS gm_promotion_reviews (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  decision_action TEXT,
  target_note TEXT,
  reason TEXT,
  review_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(candidate_id) REFERENCES gm_promotion_candidates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_gm_promotion_reviews_candidate_created
ON gm_promotion_reviews(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_gm_promotion_reviews_action_created
ON gm_promotion_reviews(action, created_at DESC);

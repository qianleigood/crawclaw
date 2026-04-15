DROP INDEX IF EXISTS ix_gm_formal_writeback_runs_candidate_created;
DROP INDEX IF EXISTS ix_gm_formal_writeback_runs_status_created;
DROP INDEX IF EXISTS ix_gm_formal_writeback_runs_decision_created;
DROP INDEX IF EXISTS ix_gm_promotion_reviews_candidate_created;
DROP INDEX IF EXISTS ix_gm_promotion_reviews_action_created;
DROP INDEX IF EXISTS ix_gm_obsidian_write_audits_candidate_created;
DROP INDEX IF EXISTS ix_gm_obsidian_write_audits_note_created;

DROP TABLE IF EXISTS gm_formal_writeback_runs;
DROP TABLE IF EXISTS gm_promotion_reviews;
DROP TABLE IF EXISTS gm_obsidian_write_audits;
DROP TABLE IF EXISTS gm_promotion_decisions;

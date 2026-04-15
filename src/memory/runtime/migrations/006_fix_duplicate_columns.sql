-- Migration 006: Rebuild gm_messages with the canonical schema.
-- Older local databases may have ended up with stray bot_id/user_id columns.
-- This migration rewrites gm_messages back to the runtime store contract.

-- Step 1: Rename existing table
ALTER TABLE gm_messages RENAME TO gm_messages_old;

-- Step 2: Recreate gm_messages with canonical schema
CREATE TABLE gm_messages (
  id              TEXT    PRIMARY KEY,
  session_id      TEXT    NOT NULL,
  conversation_uid TEXT    NOT NULL,
  role            TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  turn_index      INTEGER NOT NULL,
  extracted       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

-- Step 3: Copy data back
INSERT INTO gm_messages
  (id, session_id, conversation_uid, role, content, turn_index, extracted, created_at)
SELECT
  id, session_id, conversation_uid, role, content, turn_index, extracted, created_at
FROM gm_messages_old;

-- Step 4: Drop old table
DROP TABLE gm_messages_old;

-- Step 5: Recreate canonical index and remove legacy one if present
DROP INDEX IF EXISTS ix_gm_messages_bot_user;
CREATE INDEX IF NOT EXISTS ix_gm_messages_session_turn ON gm_messages(session_id, turn_index);

CREATE TABLE IF NOT EXISTS gm_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  conversation_uid TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  extracted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_gm_messages_session_turn
ON gm_messages(session_id, turn_index);

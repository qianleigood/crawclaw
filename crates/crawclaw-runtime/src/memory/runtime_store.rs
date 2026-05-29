use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use super::helpers::now_millis;

#[derive(Clone, Debug)]
pub struct RuntimeStore {
    db_path: PathBuf,
}

impl RuntimeStore {
    pub fn new(db_path: impl Into<PathBuf>) -> Self {
        Self { db_path: db_path.into() }
    }

    pub fn init(&self) -> Result<(), String> {
        if let Some(parent) = self.db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create db dir: {e}"))?;
        }
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("failed to open db: {e}"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS gm_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                session_key TEXT,
                message_index INTEGER NOT NULL,
                role TEXT,
                content TEXT,
                raw_json TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_gm_messages_session ON gm_messages(session_id);

            CREATE TABLE IF NOT EXISTS gm_session_compaction_state (
                session_id TEXT PRIMARY KEY,
                compacted_through_message_id TEXT,
                first_kept_message_id TEXT,
                tail_start_message_id TEXT,
                tail_start_message_index INTEGER DEFAULT 0,
                updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS gm_session_summary_state (
                session_id TEXT PRIMARY KEY,
                last_summarized_message_id TEXT,
                last_summary_updated_at INTEGER,
                tokens_at_last_summary INTEGER DEFAULT 0,
                summary_in_progress INTEGER DEFAULT 0,
                updated_at INTEGER
            );",
        )
        .map_err(|e| format!("failed to create tables: {e}"))?;
        Ok(())
    }

    pub fn append_message(
        &self,
        session_id: &str,
        session_key: Option<&str>,
        index: i64,
        message: &Value,
    ) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("failed to open db: {e}"))?;
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        let content = serde_json::to_string(message).unwrap_or_default();
        conn.execute(
            "INSERT INTO gm_messages (session_id, session_key, message_index, role, content, raw_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![session_id, session_key, index, role, content, content, now_millis() as i64],
        )
        .map_err(|e| format!("failed to insert message: {e}"))?;
        Ok(())
    }

    pub fn list_messages(&self, session_id: &str, limit: usize) -> Result<Vec<Value>, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("failed to open db: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT raw_json FROM gm_messages WHERE session_id = ?1 ORDER BY message_index ASC LIMIT ?2")
            .map_err(|e| format!("failed to prepare query: {e}"))?;
        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                let raw: String = row.get(0)?;
                Ok(raw)
            })
            .map_err(|e| format!("failed to query messages: {e}"))?;
        let mut messages = Vec::new();
        for row in rows {
            let raw = row.map_err(|e| format!("failed to read row: {e}"))?;
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                messages.push(v);
            }
        }
        Ok(messages)
    }

    pub fn upsert_session_compaction_state(
        &self,
        session_id: &str,
        tail_start_index: i64,
    ) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("failed to open db: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO gm_session_compaction_state (session_id, tail_start_message_index, updated_at)
             VALUES (?1, ?2, ?3)",
            params![session_id, tail_start_index, now_millis() as i64],
        )
        .map_err(|e| format!("failed to upsert compaction state: {e}"))?;
        Ok(())
    }

    pub fn upsert_session_summary_state(
        &self,
        session_id: &str,
        tokens_at_last_summary: i64,
    ) -> Result<(), String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("failed to open db: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO gm_session_summary_state (session_id, tokens_at_last_summary, updated_at)
             VALUES (?1, ?2, ?3)",
            params![session_id, tokens_at_last_summary, now_millis() as i64],
        )
        .map_err(|e| format!("failed to upsert summary state: {e}"))?;
        Ok(())
    }

    pub fn session_summary_state(&self, session_id: &str) -> Result<Option<Value>, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("failed to open db: {e}"))?;
        let result: Option<String> = conn
            .query_row(
                "SELECT json_object(
                    'sessionId', session_id,
                    'lastSummarizedMessageId', last_summarized_message_id,
                    'lastSummaryUpdatedAt', last_summary_updated_at,
                    'tokensAtLastSummary', tokens_at_last_summary,
                    'summaryInProgress', summary_in_progress,
                    'updatedAt', updated_at
                ) FROM gm_session_summary_state WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("failed to query summary state: {e}"))?;
        match result {
            Some(json_str) => {
                let v: Value = serde_json::from_str(&json_str)
                    .map_err(|e| format!("failed to parse summary state: {e}"))?;
                Ok(Some(v))
            }
            None => Ok(None),
        }
    }
}

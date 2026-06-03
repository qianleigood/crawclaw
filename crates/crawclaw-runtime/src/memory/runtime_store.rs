use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::helpers::now_millis;

#[derive(Clone, Debug)]
pub struct RuntimeStore {
    db_path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryJobEnqueue {
    pub job_id: String,
    pub enqueued: bool,
    pub status: String,
}

impl RuntimeStore {
    pub fn new(db_path: impl Into<PathBuf>) -> Self {
        Self {
            db_path: db_path.into(),
        }
    }

    pub fn init(&self) -> Result<(), String> {
        if let Some(parent) = self.db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("failed to create db dir: {e}"))?;
        }
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS gm_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                session_key TEXT,
                message_id TEXT,
                message_index INTEGER NOT NULL,
                role TEXT,
                content TEXT,
                raw_json TEXT,
                created_at INTEGER NOT NULL
            );

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
            );

            CREATE TABLE IF NOT EXISTS gm_memory_outbox (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                layer TEXT,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_gm_memory_outbox_status
                ON gm_memory_outbox(status, created_at);

            CREATE TABLE IF NOT EXISTS gm_memory_activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
        )
        .map_err(|e| format!("failed to create tables: {e}"))?;
        ensure_column(&conn, "gm_messages", "message_id", "message_id TEXT")?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_gm_messages_session ON gm_messages(session_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_messages_message_id
                ON gm_messages(session_id, message_id)
                WHERE message_id IS NOT NULL AND message_id != '';
            CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_messages_replay
                ON gm_messages(session_id, message_index, role, raw_json);",
        )
        .map_err(|e| format!("failed to create message indexes: {e}"))?;
        Ok(())
    }

    pub fn append_message(
        &self,
        session_id: &str,
        session_key: Option<&str>,
        index: i64,
        message: &Value,
    ) -> Result<bool, String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        let message_id = message
            .get("id")
            .or_else(|| message.get("messageId"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        let content = serde_json::to_string(message).unwrap_or_default();
        let changed = conn.execute(
            "INSERT OR IGNORE INTO gm_messages (session_id, session_key, message_id, message_index, role, content, raw_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session_id,
                session_key,
                message_id,
                index,
                role,
                content,
                content,
                now_millis() as i64
            ],
        )
        .map_err(|e| format!("failed to insert message: {e}"))?;
        Ok(changed > 0)
    }

    pub fn list_messages(&self, session_id: &str, limit: usize) -> Result<Vec<Value>, String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
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
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO gm_session_compaction_state (session_id, tail_start_message_index, updated_at)
             VALUES (?1, ?2, ?3)",
            params![session_id, tail_start_index, now_millis() as i64],
        )
        .map_err(|e| format!("failed to upsert compaction state: {e}"))?;
        Ok(())
    }

    pub fn enqueue_memory_job(
        &self,
        session_id: &str,
        kind: &str,
        layer: Option<&str>,
        payload: Value,
    ) -> Result<MemoryJobEnqueue, String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        let payload_json = serde_json::to_string(&payload)
            .map_err(|e| format!("failed to encode memory outbox payload: {e}"))?;
        let job_id = memory_job_id(session_id, kind, layer, &payload_json);
        let now = now_millis() as i64;
        let changed = conn
            .execute(
                "INSERT OR IGNORE INTO gm_memory_outbox (id, session_id, kind, layer, payload_json, status, attempts, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6, ?6)",
                params![job_id, session_id, kind, layer, payload_json, now],
            )
            .map_err(|e| format!("failed to enqueue memory job: {e}"))?;
        let status = conn
            .query_row(
                "SELECT status FROM gm_memory_outbox WHERE id = ?1",
                params![job_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| format!("failed to read memory job status: {e}"))?;
        Ok(MemoryJobEnqueue {
            job_id,
            enqueued: changed > 0,
            status,
        })
    }

    pub fn list_outbox_jobs(
        &self,
        status: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Value>, String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        let sql = if status.is_some() {
            "SELECT id, session_id, kind, layer, payload_json, status, attempts, last_error, created_at, updated_at
             FROM gm_memory_outbox WHERE status = ?1 ORDER BY created_at ASC LIMIT ?2"
        } else {
            "SELECT id, session_id, kind, layer, payload_json, status, attempts, last_error, created_at, updated_at
             FROM gm_memory_outbox ORDER BY created_at ASC LIMIT ?1"
        };
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("failed to prepare outbox query: {e}"))?;
        let rows = if let Some(status) = status {
            stmt.query_map(params![status, limit as i64], outbox_row_to_json)
                .map_err(|e| format!("failed to query outbox jobs: {e}"))?
        } else {
            stmt.query_map(params![limit as i64], outbox_row_to_json)
                .map_err(|e| format!("failed to query outbox jobs: {e}"))?
        };
        collect_json_rows(rows)
    }

    pub fn update_memory_job_status(
        &self,
        job_id: &str,
        status: &str,
        last_error: Option<&str>,
    ) -> Result<(), String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        let changed = conn
            .execute(
                "UPDATE gm_memory_outbox
                 SET status = ?2, attempts = attempts + 1, last_error = ?3, updated_at = ?4
                 WHERE id = ?1",
                params![job_id, status, last_error, now_millis() as i64],
            )
            .map_err(|e| format!("failed to update memory job status: {e}"))?;
        if changed == 0 {
            return Err(format!("memory job not found: {job_id}"));
        }
        Ok(())
    }

    pub fn memory_outbox_summary(&self) -> Result<Value, String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT status, COUNT(*) FROM gm_memory_outbox GROUP BY status")
            .map_err(|e| format!("failed to prepare outbox summary query: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("failed to query outbox summary: {e}"))?;
        let mut counts = serde_json::Map::new();
        let mut total = 0_i64;
        for row in rows {
            let (status, count) = row.map_err(|e| format!("failed to read outbox summary: {e}"))?;
            total += count;
            counts.insert(status, json!(count));
        }
        Ok(json!({
            "total": total,
            "statusCounts": counts,
        }))
    }

    pub fn record_memory_activity(
        &self,
        session_id: Option<&str>,
        kind: &str,
        status: &str,
        payload: Value,
    ) -> Result<(), String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        let payload_json = serde_json::to_string(&payload)
            .map_err(|e| format!("failed to encode memory activity payload: {e}"))?;
        conn.execute(
            "INSERT INTO gm_memory_activity (session_id, kind, status, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session_id, kind, status, payload_json, now_millis() as i64],
        )
        .map_err(|e| format!("failed to record memory activity: {e}"))?;
        Ok(())
    }

    pub fn list_memory_activity(
        &self,
        session_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Value>, String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        let sql = if session_id.is_some() {
            "SELECT id, session_id, kind, status, payload_json, created_at
             FROM gm_memory_activity WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2"
        } else {
            "SELECT id, session_id, kind, status, payload_json, created_at
             FROM gm_memory_activity ORDER BY id DESC LIMIT ?1"
        };
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| format!("failed to prepare memory activity query: {e}"))?;
        let rows = if let Some(session_id) = session_id {
            stmt.query_map(params![session_id, limit as i64], activity_row_to_json)
                .map_err(|e| format!("failed to query memory activity: {e}"))?
        } else {
            stmt.query_map(params![limit as i64], activity_row_to_json)
                .map_err(|e| format!("failed to query memory activity: {e}"))?
        };
        collect_json_rows(rows)
    }

    pub fn upsert_session_summary_state(
        &self,
        session_id: &str,
        tokens_at_last_summary: i64,
    ) -> Result<(), String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO gm_session_summary_state (session_id, tokens_at_last_summary, updated_at)
             VALUES (?1, ?2, ?3)",
            params![session_id, tokens_at_last_summary, now_millis() as i64],
        )
        .map_err(|e| format!("failed to upsert summary state: {e}"))?;
        Ok(())
    }

    pub fn session_summary_state(&self, session_id: &str) -> Result<Option<Value>, String> {
        let conn =
            Connection::open(&self.db_path).map_err(|e| format!("failed to open db: {e}"))?;
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

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    column_sql: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| format!("failed to inspect table {table}: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("failed to inspect table {table}: {e}"))?;
    for row in rows {
        if row.map_err(|e| format!("failed to inspect column: {e}"))? == column {
            return Ok(());
        }
    }
    conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column_sql}"), [])
        .map_err(|e| format!("failed to add column {column} to {table}: {e}"))?;
    Ok(())
}

fn memory_job_id(session_id: &str, kind: &str, layer: Option<&str>, payload_json: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    session_id.hash(&mut hasher);
    kind.hash(&mut hasher);
    layer.hash(&mut hasher);
    payload_json.hash(&mut hasher);
    format!("memory-job-{:016x}", hasher.finish())
}

fn outbox_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let payload_raw: String = row.get(4)?;
    let payload = serde_json::from_str(&payload_raw).unwrap_or(Value::Null);
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "sessionId": row.get::<_, String>(1)?,
        "kind": row.get::<_, String>(2)?,
        "layer": row.get::<_, Option<String>>(3)?,
        "payload": payload,
        "status": row.get::<_, String>(5)?,
        "attempts": row.get::<_, i64>(6)?,
        "lastError": row.get::<_, Option<String>>(7)?,
        "createdAt": row.get::<_, i64>(8)?,
        "updatedAt": row.get::<_, i64>(9)?,
    }))
}

fn activity_row_to_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let payload_raw: String = row.get(4)?;
    let payload = serde_json::from_str(&payload_raw).unwrap_or(Value::Null);
    Ok(json!({
        "id": row.get::<_, i64>(0)?,
        "sessionId": row.get::<_, Option<String>>(1)?,
        "kind": row.get::<_, String>(2)?,
        "status": row.get::<_, String>(3)?,
        "payload": payload,
        "createdAt": row.get::<_, i64>(5)?,
    }))
}

fn collect_json_rows<I>(rows: I) -> Result<Vec<Value>, String>
where
    I: IntoIterator<Item = rusqlite::Result<Value>>,
{
    let mut values = Vec::new();
    for row in rows {
        values.push(row.map_err(|e| format!("failed to read row: {e}"))?);
    }
    Ok(values)
}

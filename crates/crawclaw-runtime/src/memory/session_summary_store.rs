use std::path::PathBuf;

use serde_json::{json, Value};

use super::helpers::normalize_scope;

#[derive(Clone, Debug)]
pub struct SessionSummaryStore {
    runtime_root: PathBuf,
}

impl SessionSummaryStore {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        Self {
            runtime_root: runtime_root.into(),
        }
    }

    pub fn status(&self, scope: &str) -> Result<Value, String> {
        let path = self.summary_file(scope)?;
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "exists": path.exists(),
            "bytes": std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        }))
    }

    pub fn read(&self, scope: &str) -> Result<Value, String> {
        let path = self.summary_file(scope)?;
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "content": content,
        }))
    }


    pub fn edit(&self, scope: &str, content: &str) -> Result<Value, String> {
        let path = self.summary_file(scope)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create session summary dir: {e}"))?;
        }
        std::fs::write(&path, content)
            .map_err(|e| format!("failed to write session summary: {e}"))?;
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "bytesWritten": content.len(),
        }))
    }

    pub fn refresh(&self, scope: &str, content: &str) -> Result<Value, String> {
        let body = if content.trim().is_empty() {
            "# Session summary\n\nNo new session summary content was provided.\n".to_string()
        } else {
            format!("# Session summary\n\n{}\n", content.trim())
        };
        let path = self.summary_file(scope)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create session summary dir: {e}"))?;
        }
        std::fs::write(&path, &body)
            .map_err(|e| format!("failed to write session summary: {e}"))?;
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "bytesWritten": body.len(),
        }))
    }

    pub fn write_compaction_cursor(
        &self,
        scope: &str,
        compacted_through_message_id: Option<&str>,
        first_kept_message_id: Option<&str>,
        tail_start_message_id: Option<&str>,
        tail_start_message_index: usize,
    ) -> Result<Value, String> {
        let path = self.compaction_state_file(scope)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create session summary state dir: {e}"))?;
        }
        let body = serde_json::to_vec_pretty(&json!({
            "scope": normalize_scope(scope)?,
            "compactedThroughMessageId": compacted_through_message_id,
            "firstKeptMessageId": first_kept_message_id,
            "tailStartMessageId": tail_start_message_id,
            "tailStartMessageIndex": tail_start_message_index,
            "updatedAt": super::helpers::now_millis(),
        }))
        .map_err(|e| format!("failed to encode compaction cursor: {e}"))?;
        std::fs::write(&path, &body)
            .map_err(|e| format!("failed to write compaction cursor: {e}"))?;
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "bytesWritten": body.len(),
        }))
    }

    fn summary_file(&self, scope: &str) -> Result<PathBuf, String> {
        Ok(self
            .runtime_root
            .join("memory")
            .join("session-summary")
            .join(format!("{}.md", normalize_scope(scope)?)))
    }

    fn compaction_state_file(&self, scope: &str) -> Result<PathBuf, String> {
        Ok(self
            .runtime_root
            .join("memory")
            .join("session-summary")
            .join(format!("{}.state.json", normalize_scope(scope)?)))
    }
}

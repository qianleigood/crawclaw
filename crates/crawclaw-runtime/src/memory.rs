use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::special_agents::find_special_agent;
use crate::{
    AgentModelSelection, AgentRunRequest, AgentRuntime, ChannelChatType, ChannelInboundEnvelope,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRuntimeInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub owns_compaction: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRuntimeConfig {
    pub runtime_store: RuntimeStoreConfig,
    pub durable_extraction: EnabledConfig,
    pub experience: ExperienceConfig,
    pub dreaming: DreamingConfig,
    pub session_summary: SessionSummaryConfig,
    pub notebooklm: NotebookLmConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStoreConfig {
    pub db_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EnabledConfig {
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperienceConfig {
    pub enabled: bool,
    pub recent_message_limit: u32,
    pub max_notes_per_turn: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamingConfig {
    pub enabled: bool,
    pub min_hours: u32,
    pub min_sessions: u32,
    pub scan_throttle_ms: u64,
    pub lock_stale_after_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryConfig {
    pub enabled: bool,
    pub root_dir: String,
    pub min_tokens_to_init: u32,
    pub min_tokens_between_updates: u32,
    pub tool_calls_between_updates: u32,
    pub max_wait_ms: u64,
    pub max_turns: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLmConfig {
    pub enabled: bool,
    pub auth: NotebookLmAuthConfig,
    pub cli: NotebookLmCliConfig,
    pub write: NotebookLmWriteConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLmAuthConfig {
    pub profile: String,
    pub cookie_file: String,
    pub status_ttl_ms: u64,
    pub degraded_cooldown_ms: u64,
    pub refresh_cooldown_ms: u64,
    pub heartbeat: NotebookLmHeartbeatConfig,
    pub auto_login: NotebookLmAutoLoginConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NotebookLmHeartbeatConfig {
    pub enabled: bool,
    pub min_interval_ms: u64,
    pub max_interval_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLmAutoLoginConfig {
    pub enabled: bool,
    pub interval_ms: u64,
    pub provider: String,
    pub cdp_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLmCliConfig {
    pub enabled: bool,
    pub command: String,
    pub args: Vec<String>,
    pub timeout_ms: u64,
    pub limit: u32,
    pub notebook_id: String,
    pub query_instruction: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLmWriteConfig {
    pub command: String,
    pub args: Vec<String>,
    pub timeout_ms: u64,
    pub notebook_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookLmProviderState {
    pub enabled: bool,
    pub ready: bool,
    pub lifecycle: String,
    pub reason: Option<String>,
    pub recommended_action: String,
    pub profile: String,
    pub notebook_id: Option<String>,
    pub refresh_attempted: bool,
    pub refresh_succeeded: bool,
    pub auth_source: Option<String>,
    pub last_validated_at: String,
    pub details: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedRecallItem {
    pub id: String,
    pub source: String,
    pub title: String,
    pub summary: String,
    pub content: Option<String>,
    pub memory_kind: String,
    pub retrieval_score: f64,
    pub importance: f64,
    pub canonical_key: String,
    pub source_ref: Option<String>,
    pub metadata: Value,
}

#[derive(Clone, Debug)]
pub struct RustMemoryRuntime {
    runtime_root: PathBuf,
    config: MemoryRuntimeConfig,
}

impl RustMemoryRuntime {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        let runtime_root = runtime_root.into();
        let config = MemoryRuntimeConfig::load(&runtime_root);
        Self {
            runtime_root,
            config,
        }
    }

    pub fn with_config(runtime_root: impl Into<PathBuf>, config: MemoryRuntimeConfig) -> Self {
        Self {
            runtime_root: runtime_root.into(),
            config,
        }
    }

    pub fn info(&self) -> MemoryRuntimeInfo {
        MemoryRuntimeInfo {
            id: "rust-native-memory".to_string(),
            name: "Rust native memory runtime".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            owns_compaction: true,
        }
    }

    pub fn config(&self) -> &MemoryRuntimeConfig {
        &self.config
    }

    pub fn store(&self) -> RuntimeStore {
        RuntimeStore::new(expand_user_path(&self.config.runtime_store.db_path))
    }

    pub fn bootstrap(&self, session_id: &str, session_key: Option<&str>) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        store.upsert_session_compaction_state(session_id, 0)?;
        Ok(json!({
            "bootstrapped": true,
            "sessionId": session_id,
            "sessionKey": session_key
        }))
    }

    pub fn ingest_batch(
        &self,
        session_id: &str,
        session_key: Option<&str>,
        messages: &[Value],
    ) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        for (index, message) in messages.iter().enumerate() {
            store.append_message(session_id, session_key, index as i64, message)?;
        }
        Ok(json!({ "ingestedCount": messages.len() }))
    }

    pub fn assemble(
        &self,
        session_id: &str,
        messages: Vec<Value>,
        prompt: Option<&str>,
    ) -> Result<Value, String> {
        let durable = self.durable_manifest("main")?;
        let session_summary = self.session_summary_store().read(session_id)?;
        let experience = self.query_notebooklm(prompt.unwrap_or(session_id), None)?;
        Ok(json!({
            "messages": messages,
            "estimatedTokens": estimate_json_tokens(&durable) + estimate_json_tokens(&session_summary),
            "systemContextSections": [
                { "title": "Durable memory", "content": durable },
                { "title": "Session summary", "content": session_summary },
                { "title": "Experience memory", "content": experience }
            ],
            "diagnostics": {
                "memoryRecall": {
                    "implementation": "rust-native",
                    "sessionId": session_id
                }
            }
        }))
    }

    pub fn after_turn(
        &self,
        session_id: &str,
        session_key: Option<&str>,
        messages: &[Value],
        pre_prompt_message_count: usize,
    ) -> Result<Value, String> {
        let new_messages = messages
            .iter()
            .skip(pre_prompt_message_count)
            .cloned()
            .collect::<Vec<_>>();
        let ingest = self.ingest_batch(session_id, session_key, &new_messages)?;
        Ok(json!({
            "status": "ok",
            "ingest": ingest,
            "durableExtraction": self.config.durable_extraction.enabled,
            "experienceExtraction": self.config.experience.enabled,
            "sessionSummary": self.config.session_summary.enabled
        }))
    }

    pub async fn compact_with_agent_runtime(
        &self,
        session_id: &str,
        force: bool,
    ) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        let messages = store.list_messages(session_id, 10_000)?;
        if !force && messages.len() < 64 {
            return Ok(json!({
                "ok": true,
                "compacted": false,
                "reason": "below_threshold"
            }));
        }
        let transcript = serde_json::to_string_pretty(&messages)
            .map_err(|error| format!("failed to serialize compact transcript: {error}"))?;
        let definition = find_special_agent("session-summary")
            .ok_or_else(|| "missing session-summary special agent".to_string())?;
        let run_id = format!(
            "memory-compact-{}-{}",
            normalize_scope(session_id)?,
            now_millis()
        );
        let session_key = format!("memory:compact:{session_id}");
        let mut options = BTreeMap::new();
        options.insert(
            "specialAgent".to_string(),
            json!({
                "kind": definition.id,
                "spawnSource": definition.spawn_source,
                "executionMode": definition.execution_mode,
                "transcriptPolicy": definition.transcript_policy,
                "parentContextPolicy": definition.parent_context_policy,
                "timeoutSeconds": definition.timeout_seconds,
                "maxTurns": definition.max_turns
            }),
        );
        let result = AgentRuntime::new(self.runtime_root.clone())
            .run_turn(AgentRunRequest {
                run_id: run_id.clone(),
                agent_id: definition.id.to_string(),
                session_key: session_key.clone(),
                inbound: ChannelInboundEnvelope {
                    channel: "memory".to_string(),
                    account_id: Some("rust-runtime".to_string()),
                    from: "memory.compact".to_string(),
                    to: format!("agent:{}", definition.id),
                    chat_type: ChannelChatType::Direct,
                    body: format!(
                        "Compact session {session_id} into a concise, durable session summary.\n\n{transcript}"
                    ),
                    raw_body: None,
                    message_id: Some(format!("{run_id}:input")),
                    thread_id: Some(session_key),
                    media_urls: Vec::new(),
                    metadata: BTreeMap::new(),
                },
                model: AgentModelSelection {
                    provider: "configured".to_string(),
                    model: "configured".to_string(),
                    reasoning_level: None,
                },
                enabled_tools: definition
                    .tool_allowlist
                    .iter()
                    .map(|tool| (*tool).to_string())
                    .collect(),
                options,
            })
            .await
            .map_err(|error| format!("{}: {}", error.code(), error.message()))?;
        let summary = result.assistant_text;
        self.session_summary_store().refresh(session_id, &summary)?;
        store.upsert_session_compaction_state(session_id, messages.len() as i64)?;
        let tokens_before = estimate_json_tokens(&json!(&messages));
        let tokens_after = estimate_text_tokens(&summary);
        Ok(json!({
            "ok": true,
            "compacted": true,
            "result": {
                "summary": summary,
                "firstKeptEntryId": messages.last().and_then(|message| message.get("id")).and_then(Value::as_str).unwrap_or(session_id),
                "tokensBefore": tokens_before,
                "tokensAfter": tokens_after,
                "runId": result.run_id,
                "implementation": "rust-native-agent-runtime"
            }
        }))
    }

    pub fn prepare_subagent_spawn(
        &self,
        parent_session_key: &str,
        child_session_key: &str,
    ) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        store.upsert_session_compaction_state(child_session_key, 0)?;
        let event = json!({
            "status": "ok",
            "event": "subagent_spawn_registered",
            "parentSessionKey": parent_session_key,
            "childSessionKey": child_session_key,
            "state": "running",
            "createdAtMillis": now_millis()
        });
        self.append_subagent_event(event.clone())?;
        self.upsert_subagent_state(parent_session_key, child_session_key, "running", None)?;
        Ok(event)
    }

    pub fn on_subagent_ended(
        &self,
        child_session_key: &str,
        reason: &str,
    ) -> Result<Value, String> {
        let parent_session_key = self
            .subagent_parent(child_session_key)?
            .unwrap_or_else(|| "unknown".to_string());
        let event = json!({
            "status": "ok",
            "event": "subagent_ended",
            "parentSessionKey": parent_session_key,
            "childSessionKey": child_session_key,
            "reason": reason,
            "state": "ended",
            "createdAtMillis": now_millis()
        });
        self.append_subagent_event(event.clone())?;
        self.upsert_subagent_state(
            &parent_session_key,
            child_session_key,
            "ended",
            Some(reason),
        )?;
        Ok(event)
    }

    fn append_subagent_event(&self, event: Value) -> Result<(), String> {
        let path = self.runtime_root.join("memory").join("subagents.json");
        let mut events = read_json_array(&path)?;
        events.push(event);
        write_json_array(&path, &events)
    }

    fn subagent_state_file(&self) -> PathBuf {
        self.runtime_root.join("memory").join("subagent-state.json")
    }

    fn subagent_parent(&self, child_session_key: &str) -> Result<Option<String>, String> {
        let states = read_json_array(&self.subagent_state_file())?;
        Ok(states.into_iter().find_map(|entry| {
            (entry.get("childSessionKey").and_then(Value::as_str) == Some(child_session_key)).then(
                || {
                    entry
                        .get("parentSessionKey")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string()
                },
            )
        }))
    }

    fn upsert_subagent_state(
        &self,
        parent_session_key: &str,
        child_session_key: &str,
        state: &str,
        reason: Option<&str>,
    ) -> Result<(), String> {
        let path = self.subagent_state_file();
        let mut states = read_json_array(&path)?;
        let now = now_millis();
        let mut updated = false;
        for entry in &mut states {
            if entry.get("childSessionKey").and_then(Value::as_str) == Some(child_session_key) {
                if let Some(object) = entry.as_object_mut() {
                    object.insert("state".to_string(), Value::String(state.to_string()));
                    object.insert("updatedAtMillis".to_string(), json!(now));
                    if let Some(reason) = reason {
                        object.insert("reason".to_string(), Value::String(reason.to_string()));
                        object.insert("endedAtMillis".to_string(), json!(now));
                    }
                }
                updated = true;
            }
        }
        if !updated {
            states.push(json!({
                "parentSessionKey": parent_session_key,
                "childSessionKey": child_session_key,
                "state": state,
                "reason": reason,
                "createdAtMillis": now,
                "updatedAtMillis": now
            }));
        }
        write_json_array(&path, &states)
    }

    pub fn status(&self) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        Ok(json!({
            "status": "ok",
            "implementation": "rust-native",
            "runtime": self.info(),
            "config": {
                "runtimeStore": self.config.runtime_store,
                "durableExtraction": self.config.durable_extraction,
                "experience": self.config.experience,
                "dreaming": self.config.dreaming,
                "sessionSummary": self.config.session_summary,
                "notebooklm": {
                    "enabled": self.config.notebooklm.enabled,
                    "cli": {
                        "enabled": self.config.notebooklm.cli.enabled,
                        "command": self.config.notebooklm.cli.command,
                        "limit": self.config.notebooklm.cli.limit,
                        "notebookId": self.config.notebooklm.cli.notebook_id
                    },
                    "write": {
                        "command": self.config.notebooklm.write.command,
                        "notebookId": self.config.notebooklm.write.notebook_id
                    }
                }
            },
            "notebooklm": self.notebooklm_status("query")?
        }))
    }

    pub fn refresh_notebooklm(&self) -> Result<NotebookLmProviderState, String> {
        self.run_notebooklm_provider_check("refresh")
    }

    pub fn login_notebooklm(&self) -> Result<NotebookLmProviderState, String> {
        self.run_notebooklm_provider_check("login")
    }

    pub fn notebooklm_status(&self, mode: &str) -> Result<NotebookLmProviderState, String> {
        self.run_notebooklm_provider_check(mode)
    }

    pub fn query_notebooklm(&self, query: &str, limit: Option<u32>) -> Result<Value, String> {
        let notebooklm = &self.config.notebooklm;
        if !notebooklm.enabled || !notebooklm.cli.enabled || query.trim().is_empty() {
            return Ok(json!({ "status": "ok", "items": [] }));
        }
        let command = resolved_notebooklm_command(&notebooklm.cli.command);
        if command.trim().is_empty() {
            return Ok(json!({ "status": "ok", "items": [] }));
        }
        let state = self.notebooklm_status("query")?;
        if !state.ready {
            return Ok(json!({ "status": "skipped", "reason": state.reason, "items": [] }));
        }
        let limit = limit.unwrap_or(notebooklm.cli.limit).clamp(1, 10);
        let notebook_id = state
            .notebook_id
            .clone()
            .unwrap_or_else(|| notebooklm.cli.notebook_id.clone());
        let rendered_query = build_notebooklm_query(query, &notebooklm.cli.query_instruction);
        let args = notebooklm
            .cli
            .args
            .iter()
            .map(|arg| {
                render_notebooklm_template(
                    arg,
                    &rendered_query,
                    limit,
                    &notebook_id,
                    &notebooklm.auth.profile,
                )
            })
            .collect::<Vec<_>>();
        let output = run_command(&command, &args, notebooklm.cli.timeout_ms)?;
        let payload: Value = serde_json::from_str(&output)
            .map_err(|error| format!("NotebookLM query returned invalid JSON: {error}"))?;
        let items = notebooklm_entries(&payload)
            .into_iter()
            .enumerate()
            .flat_map(|(index, entry)| notebooklm_hit_variants(entry, index))
            .take(limit as usize)
            .collect::<Vec<_>>();
        Ok(json!({ "status": "ok", "items": items }))
    }

    pub fn write_notebooklm_experience(&self, entry: &Value) -> Result<Value, String> {
        let notebooklm = &self.config.notebooklm;
        if !notebooklm.enabled {
            return Err("NotebookLM is disabled".to_string());
        }
        let state = self.notebooklm_status("write")?;
        if !state.ready {
            return Err(format!(
                "NotebookLM provider not ready: {}",
                state.reason.unwrap_or_else(|| "unknown".to_string())
            ));
        }
        let notebook_id = state
            .notebook_id
            .clone()
            .unwrap_or_else(|| notebooklm.write.notebook_id.clone());
        let title =
            string_value(entry, &["title"]).unwrap_or_else(|| "Experience note".to_string());
        let body = string_value(entry, &["body", "content", "summary"]).unwrap_or_default();
        let payload = json!({
            "notebookId": notebook_id,
            "title": title,
            "content": body,
            "type": string_value(entry, &["type"]).unwrap_or_else(|| "experience".to_string()),
            "summary": string_value(entry, &["summary"]).unwrap_or_default()
        });
        let payload_file = write_temp_json("crawclaw-notebooklm-write", &payload)?;
        let command = if notebooklm.write.command.trim().is_empty() {
            resolved_notebooklm_command("nlm")
        } else {
            resolved_notebooklm_command(&notebooklm.write.command)
        };
        let args = if notebooklm.write.command.trim().is_empty() {
            let mut next = vec![
                "source".to_string(),
                "add".to_string(),
                notebook_id.clone(),
                "--text".to_string(),
                body,
                "--title".to_string(),
                title.clone(),
                "--wait".to_string(),
            ];
            if notebooklm.auth.profile != "default" {
                next.push("--profile".to_string());
                next.push(notebooklm.auth.profile.clone());
            }
            next
        } else {
            notebooklm
                .write
                .args
                .iter()
                .map(|arg| {
                    arg.replace("{payloadFile}", &payload_file)
                        .replace("{notebookId}", &notebook_id)
                        .replace("{title}", &title)
                        .replace("{type}", "experience")
                })
                .collect::<Vec<_>>()
        };
        let output = run_command(&command, &args, notebooklm.write.timeout_ms)?;
        Ok(json!({
            "status": "ok",
            "title": title,
            "notebookId": notebook_id,
            "payloadFile": payload_file,
            "raw": parse_json_or_string(&output)
        }))
    }

    pub fn delete_notebooklm_experience(
        &self,
        notebook_id: &str,
        note_id: &str,
    ) -> Result<Value, String> {
        let notebooklm = &self.config.notebooklm;
        let command = if notebooklm.write.command.trim().is_empty() {
            resolved_notebooklm_command("nlm")
        } else {
            resolved_notebooklm_command(&notebooklm.write.command)
        };
        let args = if notebooklm.write.command.trim().is_empty() {
            vec![
                "source".to_string(),
                "delete".to_string(),
                note_id.trim().to_string(),
                "--confirm".to_string(),
            ]
        } else {
            vec![
                "delete".to_string(),
                note_id.trim().to_string(),
                notebook_id.trim().to_string(),
                notebooklm.auth.profile.clone(),
            ]
        };
        let output = run_command(&command, &args, notebooklm.write.timeout_ms)?;
        Ok(json!({
            "status": "ok",
            "action": "delete",
            "noteId": note_id.trim(),
            "notebookId": notebook_id.trim(),
            "raw": parse_json_or_string(&output)
        }))
    }

    pub fn sync_experience_outbox(&self) -> Result<Value, String> {
        let store = self.experience_store();
        let entries = store.list()?;
        let mut retained = Vec::new();
        let mut flushed = 0usize;
        let mut errors = Vec::new();
        for entry in entries {
            let status = entry
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            if status != "pending" {
                retained.push(entry);
                continue;
            }
            match self.write_notebooklm_experience(&entry) {
                Ok(_) => flushed += 1,
                Err(error) => {
                    errors.push(json!({
                        "id": entry.get("id").cloned().unwrap_or(Value::Null),
                        "error": error
                    }));
                    retained.push(entry);
                }
            }
        }
        store.replace_all(&retained)?;
        Ok(json!({
            "status": if errors.is_empty() { "ok" } else { "partial" },
            "flushed": flushed,
            "errors": errors,
            "remaining": retained.len()
        }))
    }

    pub fn durable_manifest(&self, scope: &str) -> Result<Value, String> {
        DurableMemoryStore::new(self.runtime_root.clone()).manifest(scope)
    }

    pub fn durable_index_list(&self, scope: &str, limit: usize) -> Result<Value, String> {
        let manifest = DurableMemoryStore::new(self.runtime_root.clone()).manifest(scope)?;
        let docs = manifest
            .get("entries")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .take(limit)
            .collect::<Vec<_>>();
        Ok(json!({ "status": "ok", "documents": docs }))
    }

    pub fn durable_index_get(&self, scope: &str, id: &str) -> Result<Value, String> {
        let store = DurableMemoryStore::new(self.runtime_root.clone());
        store.read_note(scope, id)
    }

    pub fn dream_store(&self) -> DreamStore {
        DreamStore::new(self.runtime_root.clone())
    }

    pub fn session_summary_store(&self) -> SessionSummaryStore {
        SessionSummaryStore::new(self.runtime_root.clone())
    }

    pub fn experience_store(&self) -> ExperienceStore {
        ExperienceStore::new(self.runtime_root.clone())
    }

    fn run_notebooklm_provider_check(&self, mode: &str) -> Result<NotebookLmProviderState, String> {
        let config = &self.config.notebooklm;
        if !config.enabled {
            return Ok(notebooklm_state(
                config,
                false,
                "degraded",
                Some("disabled"),
                None,
                false,
                false,
            ));
        }
        if mode == "query" && !config.cli.enabled {
            return Ok(notebooklm_state(
                config,
                false,
                "degraded",
                Some("disabled"),
                None,
                false,
                false,
            ));
        }
        let notebook_id = notebooklm_notebook_id(config, mode);
        if notebook_id.is_empty() {
            return Ok(notebooklm_state(
                config,
                false,
                "degraded",
                Some("missing_notebook_id"),
                None,
                false,
                false,
            ));
        }
        let command = resolved_notebooklm_command(&config.cli.command);
        if command.trim().is_empty() && config.write.command.trim().is_empty() {
            return Ok(notebooklm_state(
                config,
                false,
                "degraded",
                Some("missing_command"),
                None,
                false,
                false,
            ));
        }
        let (program, args) = notebooklm_status_command(config, mode, &notebook_id);
        match run_command(
            &program,
            &args,
            config
                .cli
                .timeout_ms
                .max(config.write.timeout_ms)
                .max(5_000),
        ) {
            Ok(output) => {
                let parsed = parse_json_or_string(&output);
                let ready = parsed
                    .get("ready")
                    .and_then(Value::as_bool)
                    .unwrap_or_else(|| {
                        output.contains("Authentication valid") || output.trim().is_empty()
                    });
                Ok(notebooklm_state(
                    config,
                    ready,
                    if ready { "ready" } else { "degraded" },
                    if ready { None } else { Some("unknown") },
                    Some(parsed),
                    mode == "refresh" || mode == "login",
                    ready && (mode == "refresh" || mode == "login"),
                ))
            }
            Err(error) => Ok(notebooklm_state(
                config,
                false,
                if error.contains("auth") || error.contains("401") || error.contains("403") {
                    "expired"
                } else {
                    "degraded"
                },
                Some(classify_notebooklm_error(&error)),
                Some(Value::String(error)),
                mode == "refresh" || mode == "login",
                false,
            )),
        }
    }
}

pub async fn execute_memory_runtime_operation(
    runtime_root: &Path,
    operation: &str,
    input: Value,
) -> Result<Value, String> {
    let runtime = RustMemoryRuntime::new(runtime_root.to_path_buf());
    match operation {
        "memory.bootstrap" | "memory_bootstrap" => Ok(json!({
            "bootstrapped": true,
            "importedMessages": 0,
            "runtime": runtime.info()
        })),
        "memory.ingestBatch" | "memory_ingest_batch" => {
            let session_id = required_input_string(&input, &["sessionId", "sessionKey"])?;
            let session_key = string_value(&input, &["sessionKey"]);
            let messages = input
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            runtime.ingest_batch(&session_id, session_key.as_deref(), &messages)
        }
        "memory.assemble" | "memory_assemble" => {
            let session_id = required_input_string(&input, &["sessionId", "sessionKey"])?;
            let messages = input
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let prompt = string_value(&input, &["prompt"]);
            runtime.assemble(&session_id, messages, prompt.as_deref())
        }
        "memory.compact" | "memory_compact" => {
            let session_id = required_input_string(&input, &["sessionId", "sessionKey"])?;
            let force = input.get("force").and_then(Value::as_bool).unwrap_or(true);
            runtime.compact_with_agent_runtime(&session_id, force).await
        }
        "memory.afterTurn" | "memory_after_turn" => {
            let session_id = required_input_string(&input, &["sessionId", "sessionKey"])?;
            let session_key = string_value(&input, &["sessionKey"]);
            let messages = input
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let pre_prompt_message_count = input
                .get("prePromptMessageCount")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            runtime.after_turn(
                &session_id,
                session_key.as_deref(),
                &messages,
                pre_prompt_message_count,
            )
        }
        "memory.prepareSubagentSpawn" | "memory_prepare_subagent_spawn" => {
            let parent_session_key = required_input_string(&input, &["parentSessionKey"])?;
            let child_session_key = required_input_string(&input, &["childSessionKey"])?;
            runtime.prepare_subagent_spawn(&parent_session_key, &child_session_key)
        }
        "memory.onSubagentEnded" | "memory_on_subagent_ended" => {
            let child_session_key = required_input_string(&input, &["childSessionKey"])?;
            let reason =
                string_value(&input, &["reason"]).unwrap_or_else(|| "completed".to_string());
            runtime.on_subagent_ended(&child_session_key, &reason)
        }
        _ => Err(format!("unsupported memory runtime operation: {operation}")),
    }
}

impl MemoryRuntimeConfig {
    pub fn load(runtime_root: &Path) -> Self {
        let raw = read_active_config()
            .and_then(|config| config.get("memory").cloned())
            .unwrap_or(Value::Null);
        Self::from_value(&raw, runtime_root)
    }

    pub fn from_value(raw: &Value, runtime_root: &Path) -> Self {
        let object = raw.as_object();
        let runtime_store = object
            .and_then(|obj| obj.get("runtimeStore"))
            .unwrap_or(&Value::Null);
        let runtime_store_db = string_value(runtime_store, &["dbPath"])
            .unwrap_or_else(|| "~/.crawclaw/memory-runtime.db".to_string());
        Self {
            runtime_store: RuntimeStoreConfig {
                db_path: runtime_store_db,
            },
            durable_extraction: EnabledConfig {
                enabled: bool_value(
                    object.and_then(|obj| obj.get("durableExtraction")),
                    "enabled",
                    true,
                ),
            },
            experience: ExperienceConfig {
                enabled: bool_value(
                    object.and_then(|obj| obj.get("experience")),
                    "enabled",
                    true,
                ),
                recent_message_limit: u32_value(
                    object.and_then(|obj| obj.get("experience")),
                    "recentMessageLimit",
                    24,
                ),
                max_notes_per_turn: u32_value(
                    object.and_then(|obj| obj.get("experience")),
                    "maxNotesPerTurn",
                    2,
                ),
            },
            dreaming: DreamingConfig {
                enabled: bool_value(object.and_then(|obj| obj.get("dreaming")), "enabled", true),
                min_hours: u32_value(object.and_then(|obj| obj.get("dreaming")), "minHours", 24),
                min_sessions: u32_value(
                    object.and_then(|obj| obj.get("dreaming")),
                    "minSessions",
                    5,
                ),
                scan_throttle_ms: u64_value(
                    object.and_then(|obj| obj.get("dreaming")),
                    "scanThrottleMs",
                    600_000,
                ),
                lock_stale_after_ms: u64_value(
                    object.and_then(|obj| obj.get("dreaming")),
                    "lockStaleAfterMs",
                    3_600_000,
                ),
            },
            session_summary: SessionSummaryConfig {
                enabled: bool_value(
                    object.and_then(|obj| obj.get("sessionSummary")),
                    "enabled",
                    true,
                ),
                root_dir: string_value(
                    object
                        .and_then(|obj| obj.get("sessionSummary"))
                        .unwrap_or(&Value::Null),
                    &["rootDir"],
                )
                .unwrap_or_else(|| runtime_root.to_string_lossy().to_string()),
                min_tokens_to_init: u32_value(
                    object.and_then(|obj| obj.get("sessionSummary")),
                    "minTokensToInit",
                    10_000,
                ),
                min_tokens_between_updates: u32_value(
                    object.and_then(|obj| obj.get("sessionSummary")),
                    "minTokensBetweenUpdates",
                    5_000,
                ),
                tool_calls_between_updates: u32_value(
                    object.and_then(|obj| obj.get("sessionSummary")),
                    "toolCallsBetweenUpdates",
                    3,
                ),
                max_wait_ms: u64_value(
                    object.and_then(|obj| obj.get("sessionSummary")),
                    "maxWaitMs",
                    15_000,
                ),
                max_turns: u32_value(
                    object.and_then(|obj| obj.get("sessionSummary")),
                    "maxTurns",
                    5,
                ),
            },
            notebooklm: NotebookLmConfig::from_value(
                object
                    .and_then(|obj| obj.get("notebooklm"))
                    .unwrap_or(&Value::Null),
            ),
        }
    }
}

impl NotebookLmConfig {
    pub fn from_value(raw: &Value) -> Self {
        let auth = raw.get("auth").unwrap_or(&Value::Null);
        let heartbeat = auth.get("heartbeat").unwrap_or(&Value::Null);
        let auto_login = auth.get("autoLogin").unwrap_or(&Value::Null);
        let cli = raw.get("cli").unwrap_or(&Value::Null);
        let write = raw.get("write").unwrap_or(&Value::Null);
        Self {
            enabled: raw.get("enabled").and_then(Value::as_bool).unwrap_or(false),
            auth: NotebookLmAuthConfig {
                profile: string_value(auth, &["profile"]).unwrap_or_else(|| "default".to_string()),
                cookie_file: string_value(auth, &["cookieFile"]).unwrap_or_default(),
                status_ttl_ms: u64_value(Some(auth), "statusTtlMs", 300_000),
                degraded_cooldown_ms: u64_value(Some(auth), "degradedCooldownMs", 900_000),
                refresh_cooldown_ms: u64_value(Some(auth), "refreshCooldownMs", 1_800_000),
                heartbeat: NotebookLmHeartbeatConfig {
                    enabled: heartbeat
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    min_interval_ms: u64_value(Some(heartbeat), "minIntervalMs", 720_000),
                    max_interval_ms: u64_value(Some(heartbeat), "maxIntervalMs", 1_440_000),
                },
                auto_login: NotebookLmAutoLoginConfig {
                    enabled: auto_login
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    interval_ms: u64_value(Some(auto_login), "intervalMs", 86_400_000),
                    provider: string_value(auto_login, &["provider"])
                        .unwrap_or_else(|| "nlm_profile".to_string()),
                    cdp_url: string_value(auto_login, &["cdpUrl"]).unwrap_or_default(),
                },
            },
            cli: NotebookLmCliConfig {
                enabled: cli.get("enabled").and_then(Value::as_bool).unwrap_or(false),
                command: string_value(cli, &["command"]).unwrap_or_default(),
                args: string_vec_value(cli.get("args"))
                    .unwrap_or_else(default_notebooklm_query_args),
                timeout_ms: u64_value(Some(cli), "timeoutMs", 130_000),
                limit: u32_value(Some(cli), "limit", 8),
                notebook_id: string_value(cli, &["notebookId"]).unwrap_or_default(),
                query_instruction: string_value(cli, &["queryInstruction"])
                    .unwrap_or_else(default_query_instruction),
            },
            write: NotebookLmWriteConfig {
                command: string_value(write, &["command"]).unwrap_or_default(),
                args: string_vec_value(write.get("args"))
                    .unwrap_or_else(|| vec!["{payloadFile}".to_string()]),
                timeout_ms: u64_value(Some(write), "timeoutMs", 60_000),
                notebook_id: string_value(write, &["notebookId"]).unwrap_or_default(),
            },
        }
    }
}

#[derive(Clone, Debug)]
pub struct RuntimeStore {
    db_path: PathBuf,
}

impl RuntimeStore {
    pub fn new(db_path: impl Into<PathBuf>) -> Self {
        Self {
            db_path: db_path.into(),
        }
    }

    pub fn init(&self) -> Result<(), String> {
        if let Some(parent) = self.db_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create runtime store dir: {error}"))?;
        }
        let conn = self.connection()?;
        conn.execute_batch(
            r#"
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
            CREATE TABLE IF NOT EXISTS gm_session_summary_state (
              session_id TEXT PRIMARY KEY,
              last_summarized_message_id TEXT,
              last_summary_updated_at INTEGER,
              tokens_at_last_summary INTEGER NOT NULL DEFAULT 0,
              summary_in_progress INTEGER NOT NULL DEFAULT 0,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS gm_session_compaction_state (
              session_id TEXT PRIMARY KEY,
              preserved_tail_start_turn INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS gm_durable_extraction_cursor (
              session_id TEXT PRIMARY KEY,
              session_key TEXT,
              last_extracted_turn INTEGER NOT NULL DEFAULT 0,
              last_extracted_message_id TEXT,
              last_run_at INTEGER,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS gm_experience_extraction_cursor (
              session_id TEXT PRIMARY KEY,
              session_key TEXT,
              last_extracted_turn INTEGER NOT NULL DEFAULT 0,
              last_extracted_message_id TEXT,
              last_run_at INTEGER,
              updated_at INTEGER NOT NULL
            );
            "#,
        )
        .map_err(|error| format!("failed to initialize Rust memory SQLite store: {error}"))?;
        Ok(())
    }

    pub fn append_message(
        &self,
        session_id: &str,
        session_key: Option<&str>,
        turn_index: i64,
        message: &Value,
    ) -> Result<(), String> {
        let conn = self.connection()?;
        let id = message
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("msg-{}-{turn_index}", now_millis()));
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let content = serde_json::to_string(message).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO gm_messages (id, session_id, conversation_uid, role, content, turn_index, extracted, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
            params![id, session_id, session_key.unwrap_or(session_id), role, content, turn_index, now_millis() as i64],
        )
        .map_err(|error| format!("failed to append memory message: {error}"))?;
        Ok(())
    }

    pub fn list_messages(&self, session_id: &str, limit: usize) -> Result<Vec<Value>, String> {
        let conn = self.connection()?;
        let mut stmt = conn
            .prepare("SELECT id, role, content, turn_index, created_at FROM gm_messages WHERE session_id = ?1 ORDER BY turn_index ASC, created_at ASC LIMIT ?2")
            .map_err(|error| format!("failed to prepare message query: {error}"))?;
        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                let id: String = row.get(0)?;
                let role: String = row.get(1)?;
                let content: String = row.get(2)?;
                let turn_index: i64 = row.get(3)?;
                let created_at: i64 = row.get(4)?;
                let parsed = serde_json::from_str::<Value>(&content)
                    .unwrap_or_else(|_| json!({ "content": content }));
                Ok(json!({
                    "id": id,
                    "role": role,
                    "message": parsed,
                    "turnIndex": turn_index,
                    "createdAt": created_at
                }))
            })
            .map_err(|error| format!("failed to query messages: {error}"))?;
        let mut values = Vec::new();
        for row in rows {
            values.push(row.map_err(|error| format!("failed to read message row: {error}"))?);
        }
        Ok(values)
    }

    pub fn upsert_session_summary_state(
        &self,
        session_id: &str,
        tokens: i64,
    ) -> Result<(), String> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO gm_session_summary_state (session_id, tokens_at_last_summary, summary_in_progress, updated_at) VALUES (?1, ?2, 0, ?3)",
            params![session_id, tokens, now_millis() as i64],
        )
        .map_err(|error| format!("failed to upsert session summary state: {error}"))?;
        Ok(())
    }

    pub fn upsert_session_compaction_state(
        &self,
        session_id: &str,
        preserved_tail_start_turn: i64,
    ) -> Result<(), String> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO gm_session_compaction_state (session_id, preserved_tail_start_turn, updated_at) VALUES (?1, ?2, ?3)",
            params![session_id, preserved_tail_start_turn, now_millis() as i64],
        )
        .map_err(|error| format!("failed to upsert session compaction state: {error}"))?;
        Ok(())
    }

    pub fn session_summary_state(&self, session_id: &str) -> Result<Option<Value>, String> {
        let conn = self.connection()?;
        conn.query_row(
            "SELECT session_id, last_summarized_message_id, last_summary_updated_at, tokens_at_last_summary, summary_in_progress, updated_at FROM gm_session_summary_state WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok(json!({
                    "sessionId": row.get::<_, String>(0)?,
                    "lastSummarizedMessageId": row.get::<_, Option<String>>(1)?,
                    "lastSummaryUpdatedAt": row.get::<_, Option<i64>>(2)?,
                    "tokensAtLastSummary": row.get::<_, i64>(3)?,
                    "summaryInProgress": row.get::<_, i64>(4)? != 0,
                    "updatedAt": row.get::<_, i64>(5)?
                }))
            },
        )
        .optional()
        .map_err(|error| format!("failed to read session summary state: {error}"))
    }

    fn connection(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| {
            format!(
                "failed to open Rust memory SQLite store {}: {error}",
                self.db_path.display()
            )
        })
    }
}

#[derive(Clone, Debug)]
pub struct DurableMemoryStore {
    runtime_root: PathBuf,
}

impl DurableMemoryStore {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        Self {
            runtime_root: runtime_root.into(),
        }
    }

    pub fn manifest(&self, scope: &str) -> Result<Value, String> {
        let root = self.scope_root(scope)?;
        let mut entries = Vec::new();
        collect_markdown_entries(&root, &root, &mut entries)?;
        entries.sort_by(|left, right| {
            left.get("notePath")
                .and_then(Value::as_str)
                .cmp(&right.get("notePath").and_then(Value::as_str))
        });
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "entries": entries
        }))
    }

    pub fn read_note(&self, scope: &str, note_path: &str) -> Result<Value, String> {
        let normalized = normalize_note_path(note_path)?;
        let target = self.scope_root(scope)?.join(&normalized);
        let content = fs::read_to_string(&target).map_err(|error| {
            format!(
                "failed to read durable memory note {}: {error}",
                target.display()
            )
        })?;
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "notePath": normalized,
            "content": content
        }))
    }

    fn scope_root(&self, scope: &str) -> Result<PathBuf, String> {
        Ok(self
            .runtime_root
            .join("memory")
            .join("durable")
            .join(normalize_scope(scope)?))
    }
}

#[derive(Clone, Debug)]
pub struct DreamStore {
    runtime_root: PathBuf,
}

impl DreamStore {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        Self {
            runtime_root: runtime_root.into(),
        }
    }

    pub fn status(&self) -> Result<Value, String> {
        Ok(json!({
            "status": "ok",
            "implementation": "rust-native",
            "historyCount": self.history()?.len()
        }))
    }

    pub fn history(&self) -> Result<Vec<Value>, String> {
        read_json_array(&self.history_file())
    }

    pub fn run(&self, scope: &str, task: &str) -> Result<Value, String> {
        let mut history = self.history()?;
        let entry = json!({
            "runId": format!("dream-{}", now_millis()),
            "scope": normalize_scope(scope)?,
            "status": "completed",
            "summary": task.trim(),
            "createdAtMillis": now_millis()
        });
        history.push(entry.clone());
        write_json_array(&self.history_file(), &history)?;
        Ok(entry)
    }

    fn history_file(&self) -> PathBuf {
        self.runtime_root
            .join("memory")
            .join("dream")
            .join("history.json")
    }
}

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
            "bytes": fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0)
        }))
    }

    pub fn read(&self, scope: &str) -> Result<Value, String> {
        let path = self.summary_file(scope)?;
        let content = fs::read_to_string(path).unwrap_or_default();
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "content": content
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
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create session summary dir: {error}"))?;
        }
        fs::write(&path, &body)
            .map_err(|error| format!("failed to write session summary: {error}"))?;
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "bytesWritten": body.len()
        }))
    }

    fn summary_file(&self, scope: &str) -> Result<PathBuf, String> {
        Ok(self
            .runtime_root
            .join("memory")
            .join("session-summary")
            .join(format!("{}.md", normalize_scope(scope)?)))
    }
}

#[derive(Clone, Debug)]
pub struct ExperienceStore {
    runtime_root: PathBuf,
}

impl ExperienceStore {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        Self {
            runtime_root: runtime_root.into(),
        }
    }

    pub fn write_note(
        &self,
        scope: &str,
        title: &str,
        body: &str,
        source: &str,
    ) -> Result<Value, String> {
        let mut entries = self.list()?;
        let entry = json!({
            "id": format!("experience-{}", now_millis()),
            "scope": normalize_scope(scope)?,
            "title": title.trim(),
            "body": body.trim(),
            "source": source.trim(),
            "status": "pending",
            "createdAtMillis": now_millis()
        });
        entries.push(entry.clone());
        self.replace_all(&entries)?;
        Ok(json!({ "status": "ok", "entry": entry }))
    }

    pub fn list(&self) -> Result<Vec<Value>, String> {
        read_json_array(&self.outbox_file())
    }

    pub fn replace_all(&self, entries: &[Value]) -> Result<(), String> {
        write_json_array(&self.outbox_file(), entries)
    }

    pub fn update_status(&self, id: &str, status: &str) -> Result<Value, String> {
        let mut entries = self.list()?;
        let mut updated = false;
        for entry in &mut entries {
            if entry.get("id").and_then(Value::as_str) == Some(id) {
                if let Some(object) = entry.as_object_mut() {
                    object.insert("status".to_string(), Value::String(status.to_string()));
                    object.insert("updatedAtMillis".to_string(), json!(now_millis()));
                    updated = true;
                }
            }
        }
        if !updated {
            return Err(format!("experience outbox entry not found: {id}"));
        }
        self.replace_all(&entries)?;
        Ok(json!({ "status": "ok", "entries": entries }))
    }

    pub fn prune(&self) -> Result<Value, String> {
        let entries = self
            .list()?
            .into_iter()
            .filter(|entry| entry.get("status").and_then(Value::as_str) == Some("pending"))
            .collect::<Vec<_>>();
        self.replace_all(&entries)?;
        Ok(json!({ "status": "ok", "entries": entries }))
    }

    fn outbox_file(&self) -> PathBuf {
        self.runtime_root
            .join("memory")
            .join("experience")
            .join("outbox.json")
    }
}

fn read_active_config() -> Option<Value> {
    let path = resolve_config_path();
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn resolve_config_path() -> PathBuf {
    if let Some(value) = env::var_os("CRAWCLAW_CONFIG_PATH").filter(|value| !value.is_empty()) {
        return expand_user_path(value.to_string_lossy().as_ref());
    }
    let state_dir = env::var_os("CRAWCLAW_STATE_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| resolve_home_dir().join(".crawclaw"));
    state_dir.join("crawclaw.json")
}

fn resolve_home_dir() -> PathBuf {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn expand_user_path(input: &str) -> PathBuf {
    if input == "~" {
        return resolve_home_dir();
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return resolve_home_dir().join(rest);
    }
    PathBuf::from(input)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn now_iso() -> String {
    format!("{}", now_millis())
}

fn bool_value(raw: Option<&Value>, key: &str, fallback: bool) -> bool {
    raw.and_then(|value| value.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn u32_value(raw: Option<&Value>, key: &str, fallback: u32) -> u32 {
    raw.and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .unwrap_or(fallback)
}

fn u64_value(raw: Option<&Value>, key: &str, fallback: u64) -> u64 {
    raw.and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(fallback)
}

fn string_value(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn required_input_string(value: &Value, keys: &[&str]) -> Result<String, String> {
    string_value(value, keys).ok_or_else(|| format!("missing required field: {}", keys.join("|")))
}

fn string_vec_value(value: Option<&Value>) -> Option<Vec<String>> {
    let values = value?.as_array()?;
    Some(
        values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

fn default_notebooklm_query_args() -> Vec<String> {
    vec![
        "notebook".to_string(),
        "query".to_string(),
        "{notebookId}".to_string(),
        "{query}".to_string(),
        "--json".to_string(),
        "--timeout".to_string(),
        "120".to_string(),
        "--profile".to_string(),
        "{profile}".to_string(),
    ]
}

fn default_query_instruction() -> String {
    "请只返回与当前问题直接相关的 NotebookLM experience memory。".to_string()
}

fn estimate_json_tokens(value: &Value) -> u32 {
    estimate_text_tokens(&serde_json::to_string(value).unwrap_or_default())
}

fn estimate_text_tokens(value: &str) -> u32 {
    (value.chars().count() as u32 / 4).max(1)
}

fn notebooklm_notebook_id(config: &NotebookLmConfig, mode: &str) -> String {
    if mode == "write" {
        first_non_empty(&[&config.write.notebook_id, &config.cli.notebook_id])
    } else {
        first_non_empty(&[&config.cli.notebook_id, &config.write.notebook_id])
    }
}

fn first_non_empty(values: &[&String]) -> String {
    values
        .iter()
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

fn notebooklm_state(
    config: &NotebookLmConfig,
    ready: bool,
    lifecycle: &str,
    reason: Option<&str>,
    details: Option<Value>,
    refresh_attempted: bool,
    refresh_succeeded: bool,
) -> NotebookLmProviderState {
    let reason_string = reason.map(str::to_string);
    NotebookLmProviderState {
        enabled: config.enabled,
        ready,
        lifecycle: lifecycle.to_string(),
        recommended_action: if ready {
            "crawclaw memory status".to_string()
        } else if matches!(
            reason,
            Some("auth_expired" | "profile_missing" | "cookie_file_missing" | "cookie_invalid")
        ) {
            "crawclaw memory login".to_string()
        } else {
            "crawclaw memory status".to_string()
        },
        reason: reason_string,
        profile: config.auth.profile.clone(),
        notebook_id: Some(notebooklm_notebook_id(config, "query"))
            .filter(|value| !value.is_empty()),
        refresh_attempted,
        refresh_succeeded,
        auth_source: if ready {
            Some("profile".to_string())
        } else {
            None
        },
        last_validated_at: now_iso(),
        details: details.map(|value| match value {
            Value::String(value) => value,
            other => serde_json::to_string(&other).unwrap_or_default(),
        }),
    }
}

fn resolved_notebooklm_command(command: &str) -> String {
    command.trim().to_string()
}

fn notebooklm_status_command(
    config: &NotebookLmConfig,
    mode: &str,
    notebook_id: &str,
) -> (String, Vec<String>) {
    let profile = config.auth.profile.trim();
    let profile = if profile.is_empty() {
        "default"
    } else {
        profile
    };
    let command = if !config.cli.command.trim().is_empty() {
        config.cli.command.trim().to_string()
    } else if !config.write.command.trim().is_empty() {
        config.write.command.trim().to_string()
    } else {
        "nlm".to_string()
    };
    if is_nlm_command(&command) {
        if mode == "login" {
            let mut args = vec!["login".to_string()];
            if profile != "default" {
                args.push("--profile".to_string());
                args.push(profile.to_string());
            }
            return (command, args);
        }
        let mut args = vec!["login".to_string(), "--check".to_string()];
        if profile != "default" {
            args.push("--profile".to_string());
            args.push(profile.to_string());
        }
        return (command, args);
    }
    let first_arg = if !config.write.command.trim().is_empty() {
        config.write.args.first()
    } else {
        config.cli.args.first()
    };
    if let Some(first_arg) = first_arg.filter(|arg| looks_like_script_arg(arg)) {
        return (
            command,
            vec![
                first_arg.to_string(),
                if mode == "login" { "refresh" } else { "status" }.to_string(),
                notebook_id.to_string(),
                profile.to_string(),
            ],
        );
    }
    (
        command,
        vec![
            "status".to_string(),
            notebook_id.to_string(),
            profile.to_string(),
        ],
    )
}

fn is_nlm_command(command: &str) -> bool {
    Path::new(command)
        .file_name()
        .and_then(|file| file.to_str())
        .map(|file| file == "nlm" || file == "nlm.exe")
        .unwrap_or(false)
}

fn looks_like_script_arg(arg: &str) -> bool {
    arg.contains('/')
        || arg.contains('\\')
        || [".py", ".js", ".mjs", ".cjs", ".ts"]
            .iter()
            .any(|suffix| arg.ends_with(suffix))
}

fn run_command(command: &str, args: &[String], _timeout_ms: u64) -> Result<String, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|error| format!("failed to run NotebookLM command {command}: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "NotebookLM command failed: {}{}{}",
            output.status,
            if stdout.trim().is_empty() { "" } else { "\n" },
            [stdout.trim(), stderr.trim()]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn classify_notebooklm_error(message: &str) -> &'static str {
    if message.contains("ENOENT") || message.contains("No such file") {
        "cli_missing"
    } else if message.contains("profile") && message.contains("not found") {
        "profile_missing"
    } else if message.contains("auth")
        || message.contains("Authentication")
        || message.contains("401")
        || message.contains("403")
    {
        "auth_expired"
    } else {
        "unknown"
    }
}

fn build_notebooklm_query(query: &str, instruction: &str) -> String {
    if instruction.trim().is_empty() {
        query.trim().to_string()
    } else {
        format!("{}\n\n当前问题：{}", instruction.trim(), query.trim())
    }
}

fn render_notebooklm_template(
    value: &str,
    query: &str,
    limit: u32,
    notebook_id: &str,
    profile: &str,
) -> String {
    value
        .replace("{query}", query)
        .replace("{limit}", &limit.to_string())
        .replace("{notebookId}", notebook_id)
        .replace("{profile}", profile)
}

fn notebooklm_entries(payload: &Value) -> Vec<Value> {
    if let Some(array) = payload.as_array() {
        return array.clone();
    }
    let Some(object) = payload.as_object() else {
        return Vec::new();
    };
    for key in ["results", "items", "hits", "sources", "data"] {
        if let Some(array) = object.get(key).and_then(Value::as_array) {
            return array.clone();
        }
    }
    for key in ["answer", "response", "text", "content"] {
        if let Some(answer) = object.get(key).and_then(Value::as_str) {
            if !answer.trim().is_empty() {
                return vec![json!({
                    "title": object.get("title").and_then(Value::as_str).unwrap_or("NotebookLM answer"),
                    "answer": answer,
                    "source": object.get("source").and_then(Value::as_str),
                    "sourceId": object.get("sourceId").and_then(Value::as_str),
                    "score": object.get("score").and_then(Value::as_f64)
                })];
            }
        }
    }
    Vec::new()
}

fn notebooklm_hit_variants(raw: Value, rank: usize) -> Vec<UnifiedRecallItem> {
    let Some(object) = raw.as_object() else {
        return Vec::new();
    };
    let title = string_field(
        object,
        &["title", "name", "sourceTitle", "notebookName", "notebook"],
    )
    .unwrap_or_else(|| format!("NotebookLM result {}", rank + 1));
    let raw_content = string_field(
        object,
        &["summary", "preview", "snippet", "answer", "text", "content"],
    )
    .unwrap_or_default();
    let summary = compact_text(&strip_notebooklm_artifacts(&raw_content), 220);
    let content = compact_text(&strip_notebooklm_artifacts(&raw_content), 520);
    let id = string_field(object, &["id", "sourceId"]).unwrap_or_else(|| (rank + 1).to_string());
    let source_ref = string_field(object, &["url", "path", "sourceId", "id"]);
    vec![UnifiedRecallItem {
        id: format!("notebooklm:{id}"),
        source: "notebooklm".to_string(),
        title: title.clone(),
        summary,
        content: if content.is_empty() {
            None
        } else {
            Some(content)
        },
        memory_kind: project_memory_kind(&title),
        retrieval_score: object
            .get("score")
            .or_else(|| object.get("relevance"))
            .and_then(Value::as_f64)
            .unwrap_or_else(|| (1.0 - rank as f64 * 0.04).max(0.1)),
        importance: 0.72,
        canonical_key: source_ref.clone().unwrap_or(title),
        source_ref,
        metadata: Value::Object(object.clone()),
    }]
}

fn string_field(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn strip_notebooklm_artifacts(value: &str) -> String {
    value
        .replace("**", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn compact_text(value: &str, max_chars: usize) -> String {
    let value = value.trim();
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>()
}

fn project_memory_kind(title: &str) -> String {
    let lower = title.to_lowercase();
    if lower.contains("preference") || lower.contains("偏好") {
        "preference".to_string()
    } else if lower.contains("decision") || lower.contains("决策") {
        "decision".to_string()
    } else if lower.contains("procedure") || lower.contains("流程") {
        "procedure".to_string()
    } else if lower.contains("runtime") || lower.contains("运行") {
        "runtime_pattern".to_string()
    } else {
        "reference".to_string()
    }
}

fn write_temp_json(prefix: &str, payload: &Value) -> Result<String, String> {
    let dir = env::temp_dir().join(format!("{prefix}-{}", now_millis()));
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create temp dir: {error}"))?;
    let file = dir.join("payload.json");
    let mut handle = fs::File::create(&file)
        .map_err(|error| format!("failed to create temp payload file: {error}"))?;
    handle
        .write_all(
            serde_json::to_string_pretty(payload)
                .unwrap_or_else(|_| "{}".to_string())
                .as_bytes(),
        )
        .map_err(|error| format!("failed to write temp payload file: {error}"))?;
    Ok(file.to_string_lossy().to_string())
}

fn parse_json_or_string(value: &str) -> Value {
    serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.trim().to_string()))
}

fn read_json_array(path: &Path) -> Result<Vec<Value>, String> {
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str::<Vec<Value>>(&content)
            .map_err(|error| format!("failed to parse {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("failed to read {}: {error}", path.display())),
    }
}

fn write_json_array(path: &Path, values: &[Value]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(values).unwrap_or_else(|_| "[]".to_string()),
    )
    .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn collect_markdown_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<Value>,
) -> Result<(), String> {
    let read_dir = match fs::read_dir(current) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "failed to read memory dir {}: {error}",
                current.display()
            ))
        }
    };
    for entry in read_dir {
        let entry = entry.map_err(|error| format!("failed to read memory dir entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_entries(root, &path, entries)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let relative = path.strip_prefix(root).unwrap_or(&path);
        let bytes = fs::metadata(&path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        entries.push(json!({
            "notePath": relative.to_string_lossy().replace('\\', "/"),
            "title": path.file_stem().and_then(|name| name.to_str()).unwrap_or("memory"),
            "bytes": bytes,
            "modifiedMillis": fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
                .unwrap_or(0)
        }));
    }
    Ok(())
}

fn normalize_scope(scope: &str) -> Result<String, String> {
    let scope = scope.trim();
    if scope.is_empty()
        || scope == "."
        || scope == ".."
        || scope.contains('/')
        || scope.contains('\\')
    {
        return Err("memory scope must be a simple non-empty name".to_string());
    }
    Ok(scope.to_string())
}

fn normalize_note_path(note_path: &str) -> Result<String, String> {
    let note_path = note_path.trim();
    if note_path.is_empty() {
        return Err("memory note path is required".to_string());
    }
    let path = Path::new(note_path);
    if path.is_absolute() {
        return Err("memory note path must be relative".to_string());
    }
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("memory note path cannot escape its scope".to_string());
    }
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return Err("memory note path must end in .md".to_string());
    }
    Ok(note_path.replace('\\', "/"))
}

static HEARTBEAT_STATE: OnceLock<Mutex<Option<u128>>> = OnceLock::new();

pub fn run_notebooklm_heartbeat_once(runtime_root: impl Into<PathBuf>) -> Result<Value, String> {
    let runtime = RustMemoryRuntime::new(runtime_root);
    if !runtime.config.notebooklm.auth.heartbeat.enabled {
        return Ok(json!({ "status": "disabled" }));
    }
    let state = runtime.notebooklm_status("query")?;
    let mutex = HEARTBEAT_STATE.get_or_init(|| Mutex::new(None));
    *mutex
        .lock()
        .map_err(|_| "heartbeat lock poisoned".to_string())? = Some(now_millis());
    Ok(json!({ "status": "ok", "provider": state }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_normalizes_notebooklm() {
        let root = PathBuf::from("/tmp/crawclaw-runtime-test");
        let config = MemoryRuntimeConfig::from_value(
            &json!({
                "notebooklm": {
                    "enabled": true,
                    "cli": { "enabled": true, "command": "/bin/echo", "notebookId": "nb" }
                }
            }),
            &root,
        );
        assert!(config.notebooklm.enabled);
        assert!(config.notebooklm.cli.enabled);
        assert_eq!(config.notebooklm.cli.notebook_id, "nb");
    }

    #[test]
    fn runtime_store_initializes_sqlite_schema() {
        let temp = tempfile::tempdir().unwrap();
        let store = RuntimeStore::new(temp.path().join("runtime.sqlite"));
        store.init().unwrap();
        store
            .append_message(
                "session-1",
                Some("agent:main:session-1"),
                1,
                &json!({ "id": "m1", "role": "user", "content": "hello" }),
            )
            .unwrap();
        let rows = store.list_messages("session-1", 10).unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn subagent_lifecycle_records_native_events() {
        let temp = tempfile::tempdir().unwrap();
        let runtime = RustMemoryRuntime::new(temp.path());

        let prepared = runtime
            .prepare_subagent_spawn("agent:main:parent", "agent:main:child")
            .expect("prepare subagent spawn");
        assert_eq!(prepared["status"], "ok");
        assert_eq!(prepared["event"], "subagent_spawn_registered");
        assert_eq!(prepared["state"], "running");

        let ended = runtime
            .on_subagent_ended("agent:main:child", "completed")
            .expect("subagent ended");
        assert_eq!(ended["status"], "ok");
        assert_eq!(ended["event"], "subagent_ended");
        assert_eq!(ended["parentSessionKey"], "agent:main:parent");
        assert_eq!(ended["state"], "ended");

        let events = read_json_array(&temp.path().join("memory").join("subagents.json")).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["parentSessionKey"], "agent:main:parent");
        assert_eq!(events[1]["reason"], "completed");
        let states =
            read_json_array(&temp.path().join("memory").join("subagent-state.json")).unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!(states[0]["childSessionKey"], "agent:main:child");
        assert_eq!(states[0]["state"], "ended");
    }

    #[test]
    fn durable_manifest_rejects_scope_escape() {
        let temp = tempfile::tempdir().unwrap();
        let store = DurableMemoryStore::new(temp.path());
        assert!(store.manifest("../bad").is_err());
    }

    #[test]
    fn experience_outbox_write_update_prune() {
        let temp = tempfile::tempdir().unwrap();
        let store = ExperienceStore::new(temp.path());
        let written = store.write_note("main", "Title", "Body", "test").unwrap();
        let id = written
            .get("entry")
            .and_then(|entry| entry.get("id"))
            .and_then(Value::as_str)
            .unwrap()
            .to_string();
        store.update_status(&id, "synced").unwrap();
        let pruned = store.prune().unwrap();
        assert_eq!(
            pruned
                .get("entries")
                .and_then(Value::as_array)
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn notebooklm_query_maps_results() {
        let item = notebooklm_hit_variants(
            json!({ "id": "x", "title": "Procedure", "answer": "Do this. Then that.", "score": 0.9 }),
            0,
        );
        assert_eq!(item[0].id, "notebooklm:x");
        assert_eq!(item[0].memory_kind, "procedure");
    }
}

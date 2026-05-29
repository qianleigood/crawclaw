pub mod bank_resolver;
pub mod config;
pub mod feedback_guard;
pub mod hindsight_client;
pub mod recall_pipeline;
pub mod reflect_pipeline;
pub mod retain_pipeline;

mod helpers;
mod runtime_store;
mod session_summary_store;

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub use self::config::*;
pub use self::helpers::*;
pub use self::runtime_store::RuntimeStore;
pub use self::session_summary_store::SessionSummaryStore;

use self::bank_resolver::{BankContext, BankResolverConfig};
use self::hindsight_client::HindsightClient;
use self::recall_pipeline::RecallConfig;
use self::reflect_pipeline::ReflectConfig;
use self::retain_pipeline::RetainConfig;

#[derive(Clone, Debug)]
pub struct MemoryRuntime {
    runtime_root: PathBuf,
    config: MemoryRuntimeConfig,
    bank_resolver: BankResolverConfig,
    hindsight: Option<HindsightClient>,
}

impl MemoryRuntime {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        let runtime_root = runtime_root.into();
        let config = MemoryRuntimeConfig::load(&runtime_root);
        let bank_resolver = BankResolverConfig::from_hindsight_config(&config.hindsight);
        let hindsight = HindsightClient::new(&config.hindsight).ok();
        Self {
            runtime_root,
            config,
            bank_resolver,
            hindsight,
        }
    }

    pub fn with_config(runtime_root: impl Into<PathBuf>, config: MemoryRuntimeConfig) -> Self {
        let runtime_root = runtime_root.into();
        let bank_resolver = BankResolverConfig::from_hindsight_config(&config.hindsight);
        let hindsight = HindsightClient::new(&config.hindsight).ok();
        Self {
            runtime_root,
            config,
            bank_resolver,
            hindsight,
        }
    }

    pub fn config(&self) -> &MemoryRuntimeConfig {
        &self.config
    }

    pub fn hindsight(&self) -> Option<&HindsightClient> {
        self.hindsight.as_ref()
    }

    pub fn store(&self) -> RuntimeStore {
        RuntimeStore::new(helpers::expand_user_path(&self.config.runtime_store.db_path))
    }

    pub fn session_summary_store(&self) -> SessionSummaryStore {
        SessionSummaryStore::new(self.runtime_root.clone())
    }

    pub fn bank_context(&self, agent_id: &str) -> BankContext {
        BankContext {
            agent_id: agent_id.to_string(),
            channel: None,
            user_id: None,
        }
    }

    pub fn bootstrap(&self, session_id: &str, session_key: Option<&str>) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        store.upsert_session_summary_state(session_id, 0)?;

        if let Some(client) = &self.hindsight {
            if client.is_configured() {
                let language = &self.config.hindsight.language_hints.primary_language;
                for layer in bank_resolver::LAYERS {
                    let ctx = self.bank_context("main");
                    let bank_id = self.bank_resolver.resolve(&ctx, layer);
                    let _ = client.ensure_bank(&bank_id, layer, language);
                }
            }
        }

        Ok(json!({
            "bootstrapped": true,
            "sessionId": session_id,
            "sessionKey": session_key,
        }))
    }

    pub fn assemble(
        &self,
        session_id: &str,
        messages: Vec<Value>,
        prompt: Option<&str>,
    ) -> Result<Value, String> {
        let query_text = prompt.unwrap_or(session_id);
        let ctx = self.bank_context("main");

        let recall_config = RecallConfig::from(&self.config.hindsight);
        let query = recall_pipeline::compose_recall_query(query_text, &messages, &recall_config);

        let (durable, experience, resource, mental_models) = if let Some(client) = &self.hindsight {
            if client.is_configured() {
                let items = recall_pipeline::parallel_recall(
                    client,
                    &self.bank_resolver,
                    &ctx,
                    &query,
                    &recall_config,
                );
                let durable: Vec<_> = items.iter().filter(|i| i.metadata.get("layer").and_then(|v| v.as_str()) == Some("durable")).cloned().collect();
                let experience: Vec<_> = items.iter().filter(|i| i.metadata.get("layer").and_then(|v| v.as_str()) == Some("experience")).cloned().collect();
                let resource: Vec<_> = items.iter().filter(|i| i.metadata.get("layer").and_then(|v| v.as_str()) == Some("resource")).cloned().collect();
                let mental_models: Vec<_> = items.iter().filter(|i| i.metadata.get("layer").and_then(|v| v.as_str()) == Some("mental-models")).cloned().collect();
                (durable, experience, resource, mental_models)
            } else {
                (vec![], vec![], vec![], vec![])
            }
        } else {
            (vec![], vec![], vec![], vec![])
        };

        let sections = recall_pipeline::format_all_recall_for_injection(
            &durable,
            &experience,
            &resource,
            &mental_models,
        );

        let system_sections: Vec<Value> = sections
            .into_iter()
            .map(|(title, content)| json!({ "title": title, "content": content }))
            .collect();

        Ok(json!({
            "messages": messages,
            "systemContextSections": system_sections,
            "diagnostics": {
                "memoryRecall": {
                    "implementation": "hindsight-native",
                    "sessionId": session_id,
                    "durableCount": durable.len(),
                    "experienceCount": experience.len(),
                    "resourceCount": resource.len(),
                    "mentalModelCount": mental_models.len(),
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
        let new_messages: Vec<Value> = messages
            .iter()
            .skip(pre_prompt_message_count)
            .cloned()
            .collect();

        let store = self.store();
        store.init()?;
        for (index, message) in new_messages.iter().enumerate() {
            store.append_message(
                session_id,
                session_key,
                (pre_prompt_message_count + index) as i64,
                message,
            )?;
        }

        let retain_config = RetainConfig::from(&self.config.hindsight);
        let ctx = self.bank_context("main");

        let has_final_assistant = new_messages
            .last()
            .and_then(|m| m.get("role").and_then(Value::as_str))
            == Some("assistant");
        let has_tool_calls = new_messages
            .last()
            .and_then(|m| m.get("tool_calls"))
            .is_some();

        let turn_number = messages.len() as u32;
        let should_retain = retain_pipeline::should_retain_this_turn(
            turn_number,
            retain_config.retain_every_n_turns,
            has_final_assistant,
            has_tool_calls,
        );

        let mut result = json!({
            "status": "ok",
            "ingestedCount": new_messages.len(),
            "hindsightEnabled": self.config.hindsight.enabled,
            "shouldRetain": should_retain,
        });

        if should_retain {
            if let Some(client) = &self.hindsight {
                if client.is_configured() {
                    let bank_id = self.bank_resolver.resolve(&ctx, "experience");
                    if let Some(content) =
                        retain_pipeline::compose_retain_payload(&new_messages, &ctx, &retain_config)
                    {
                        match retain_pipeline::auto_retain(client, &bank_id, &content, &ctx) {
                            Ok(()) => {
                                result["retainStatus"] = json!("ok");
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, "auto_retain_failed");
                                result["retainStatus"] = json!("failed");
                                result["retainError"] = json!(e);
                            }
                        }
                    }
                }
            }
        }

        Ok(result)
    }

    pub fn dream_consolidate(&self, session_id: &str) -> Result<Value, String> {
        if !self.config.dreaming.enabled {
            return Ok(json!({ "status": "skipped", "reason": "dreaming_disabled" }));
        }

        let Some(client) = &self.hindsight else {
            return Ok(json!({ "status": "skipped", "reason": "hindsight_not_available" }));
        };

        if !client.is_configured() {
            return Ok(json!({ "status": "skipped", "reason": "hindsight_not_configured" }));
        }

        let reflect_config = ReflectConfig::from_hindsight_config(
            &self.config.hindsight,
            &self.config.dreaming,
        );

        let ctx = self.bank_context("main");
        let recent_summaries = self.recent_session_summaries(session_id, 5)?;

        reflect_pipeline::dream_reflect(
            client,
            &self.bank_resolver,
            &ctx,
            &reflect_config,
            &recent_summaries,
        )
    }

    fn recent_session_summaries(&self, session_id: &str, _count: usize) -> Result<Vec<String>, String> {
        let store = self.session_summary_store();
        let summary = store.read(session_id)?;
        let content = summary
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if content.trim().is_empty() {
            Ok(vec![])
        } else {
            Ok(vec![content])
        }
    }

    pub fn hindsight_status(&self) -> Value {
        let config = &self.config.hindsight;
        let reason = if !config.enabled {
            Some("disabled")
        } else if config.base_url.trim().is_empty() {
            Some("missing_base_url")
        } else {
            None
        };
        json!({
            "enabled": config.enabled,
            "ready": reason.is_none(),
            "lifecycle": if reason.is_none() { "ready" } else { "degraded" },
            "reason": reason,
            "provider": "hindsight",
            "baseUrl": config.base_url,
            "bankPrefix": config.bank_prefix,
            "bankGranularity": config.bank_granularity,
            "authConfigured": !config.api_key.trim().is_empty(),
        })
    }

    pub fn status(&self) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        Ok(json!({
            "status": "ok",
            "implementation": "hindsight-native",
            "config": {
                "runtimeStore": self.config.runtime_store,
                "hindsight": {
                    "enabled": self.config.hindsight.enabled,
                    "baseUrl": self.config.hindsight.base_url,
                    "bankPrefix": self.config.hindsight.bank_prefix,
                    "bankGranularity": self.config.hindsight.bank_granularity,
                    "memoryMode": self.config.hindsight.memory_mode,
                    "authConfigured": !self.config.hindsight.api_key.trim().is_empty(),
                },
                "dreaming": self.config.dreaming,
                "sessionSummary": self.config.session_summary,
            },
            "hindsight": self.hindsight_status(),
        }))
    }
}

impl MemoryRuntimeConfig {
    pub fn load(_runtime_root: &Path) -> Self {
        Self::from_value(
            &read_active_config()
                .and_then(|c| c.get("memory").cloned())
                .unwrap_or(Value::Null),
        )
    }

    pub fn from_value(raw: &Value) -> Self {
        let object = raw.as_object();
        let runtime_store_db = string_value(
            raw.get("runtimeStore").unwrap_or(&Value::Null),
            &["dbPath"],
        )
        .unwrap_or_else(|| "~/.crawclaw/memory-runtime.db".to_string());

        let hindsight_raw = object.and_then(|o| o.get("hindsight")).unwrap_or(&Value::Null);
        let hindsight = HindsightConfig::from_value(hindsight_raw);

        let dreaming_raw = object.and_then(|o| o.get("dreaming")).unwrap_or(&Value::Null);
        let dreaming = DreamingConfig::from_value(dreaming_raw);

        let summary_raw = object.and_then(|o| o.get("sessionSummary")).unwrap_or(&Value::Null);
        let session_summary = SessionSummaryConfig::from_value(summary_raw);

        Self {
            runtime_store: RuntimeStoreConfig { db_path: runtime_store_db },
            hindsight,
            dreaming,
            session_summary,
        }
    }
}

impl HindsightConfig {
    pub fn from_value(raw: &Value) -> Self {
        let defaults = Self::default();
        let object = raw.as_object();

        let api_key = string_value(raw, &["apiKey", "apiKeyEnv"])
            .or_else(|| {
                string_value(raw, &["apiKeyEnv"])
                    .and_then(|name| std::env::var(name.trim()).ok())
                    .map(|v| v.trim().to_string())
            })
            .unwrap_or(defaults.api_key);

        let tags = raw
            .get("tags")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .filter(|v: &Vec<String>| !v.is_empty())
            .unwrap_or(defaults.tags);

        let bank_granularity = raw
            .get("bankGranularity")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .filter(|v: &Vec<String>| !v.is_empty())
            .unwrap_or(defaults.bank_granularity);

        let retain_roles = raw
            .get("retainRoles")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .filter(|v: &Vec<String>| !v.is_empty())
            .unwrap_or(defaults.retain_roles);

        let recall_types = raw
            .get("recallTypes")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .filter(|v: &Vec<String>| !v.is_empty())
            .unwrap_or(defaults.recall_types);

        let language_hints_raw = raw.get("languageHints").unwrap_or(&Value::Null);
        let language_hints = LanguageHints {
            primary_language: string_value(language_hints_raw, &["primaryLanguage"])
                .unwrap_or(defaults.language_hints.primary_language),
            bilingual_technical_terms: language_hints_raw
                .get("bilingualTechnicalTerms")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.language_hints.bilingual_technical_terms),
        };

        Self {
            enabled: raw.get("enabled").and_then(Value::as_bool).unwrap_or(defaults.enabled),
            base_url: string_value(raw, &["baseUrl"]).unwrap_or(defaults.base_url),
            api_key,
            bank_prefix: string_value(raw, &["bankPrefix"]).unwrap_or(defaults.bank_prefix),
            bank_granularity,
            shared_mode: raw.get("sharedMode").and_then(Value::as_bool).unwrap_or(defaults.shared_mode),
            shared_bank_id: string_value(raw, &["sharedBankId"]).unwrap_or(defaults.shared_bank_id),
            memory_mode: string_value(raw, &["memoryMode"]).unwrap_or(defaults.memory_mode),
            auto_retain: raw.get("autoRetain").and_then(Value::as_bool).unwrap_or(defaults.auto_retain),
            retain_roles,
            retain_every_n_turns: raw.get("retainEveryNTurns").and_then(Value::as_u64).unwrap_or(defaults.retain_every_n_turns as u64) as u32,
            retain_overlap_turns: raw.get("retainOverlapTurns").and_then(Value::as_u64).unwrap_or(defaults.retain_overlap_turns as u64) as u32,
            retain_async: raw.get("retainAsync").and_then(Value::as_bool).unwrap_or(defaults.retain_async),
            default_budget: string_value(raw, &["defaultBudget"]).unwrap_or(defaults.default_budget),
            max_tokens: raw.get("maxTokens").and_then(Value::as_u64).unwrap_or(defaults.max_tokens as u64) as u32,
            recall_context_turns: raw.get("recallContextTurns").and_then(Value::as_u64).unwrap_or(defaults.recall_context_turns as u64) as u32,
            recall_max_query_chars: raw.get("recallMaxQueryChars").and_then(Value::as_u64).unwrap_or(defaults.recall_max_query_chars as u64) as usize,
            recall_types,
            recall_injection_position: string_value(raw, &["recallInjectionPosition"]).unwrap_or(defaults.recall_injection_position),
            auto_reflect: raw.get("autoReflect").and_then(Value::as_bool).unwrap_or(defaults.auto_reflect),
            reflect_budget: string_value(raw, &["reflectBudget"]).unwrap_or(defaults.reflect_budget),
            reflect_max_tokens: raw.get("reflectMaxTokens").and_then(Value::as_u64).unwrap_or(defaults.reflect_max_tokens as u64) as u32,
            default_mental_models: raw.get("defaultMentalModels").and_then(Value::as_bool).unwrap_or(defaults.default_mental_models),
            enable_knowledge_tools: raw.get("enableKnowledgeTools").and_then(Value::as_bool).unwrap_or(defaults.enable_knowledge_tools),
            tags_match: string_value(raw, &["tagsMatch"]).unwrap_or(defaults.tags_match),
            tags,
            timeout_ms: raw.get("timeoutMs").and_then(Value::as_u64).unwrap_or(defaults.timeout_ms),
            language_hints,
        }
    }
}

impl DreamingConfig {
    pub fn from_value(raw: &Value) -> Self {
        let defaults = Self::default();
        Self {
            enabled: raw.get("enabled").and_then(Value::as_bool).unwrap_or(defaults.enabled),
            min_hours: raw.get("minHours").and_then(Value::as_u64).unwrap_or(defaults.min_hours as u64) as u32,
            min_sessions: raw.get("minSessions").and_then(Value::as_u64).unwrap_or(defaults.min_sessions as u64) as u32,
            scan_throttle_ms: raw.get("scanThrottleMs").and_then(Value::as_u64).unwrap_or(defaults.scan_throttle_ms),
            lock_stale_after_ms: raw.get("lockStaleAfterMs").and_then(Value::as_u64).unwrap_or(defaults.lock_stale_after_ms),
        }
    }
}

impl SessionSummaryConfig {
    pub fn from_value(raw: &Value) -> Self {
        let defaults = Self::default();
        Self {
            enabled: raw.get("enabled").and_then(Value::as_bool).unwrap_or(defaults.enabled),
            min_tokens_to_init: raw.get("minTokensToInit").and_then(Value::as_u64).unwrap_or(defaults.min_tokens_to_init as u64) as u32,
            min_tokens_between_updates: raw.get("minTokensBetweenUpdates").and_then(Value::as_u64).unwrap_or(defaults.min_tokens_between_updates as u64) as u32,
            tool_calls_between_updates: raw.get("toolCallsBetweenUpdates").and_then(Value::as_u64).unwrap_or(defaults.tool_calls_between_updates as u64) as u32,
            max_wait_ms: raw.get("maxWaitMs").and_then(Value::as_u64).unwrap_or(defaults.max_wait_ms),
            max_turns: raw.get("maxTurns").and_then(Value::as_u64).unwrap_or(defaults.max_turns as u64) as u32,
        }
    }
}

fn read_active_config() -> Option<Value> {
    let path = resolve_config_path();
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn resolve_config_path() -> PathBuf {
    if let Some(value) = std::env::var_os("CRAWCLAW_CONFIG_PATH").filter(|v| !v.is_empty()) {
        return helpers::expand_user_path(&value.to_string_lossy());
    }
    let state_dir = std::env::var_os("CRAWCLAW_STATE_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".crawclaw")
        });
    state_dir.join("crawclaw.json")
}

pub async fn execute_memory_runtime_operation(
    runtime_root: &Path,
    operation: &str,
    input: Value,
) -> Result<Value, String> {
    let runtime = MemoryRuntime::new(runtime_root.to_path_buf());
    match operation {
        "memory.bootstrap" | "memory_bootstrap" => {
            let session_id = string_value(&input, &["sessionId", "sessionKey"])
                .unwrap_or_else(|| "default".to_string());
            let session_key = string_value(&input, &["sessionKey"]);
            runtime.bootstrap(&session_id, session_key.as_deref())
        }
        "memory.ingestBatch" | "memory_ingest_batch" => {
            let session_id = string_value(&input, &["sessionId", "sessionKey"])
                .unwrap_or_else(|| "default".to_string());
            let session_key = string_value(&input, &["sessionKey"]);
            let messages = input
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let store = runtime.store();
            store.init()?;
            for (index, message) in messages.iter().enumerate() {
                store.append_message(&session_id, session_key.as_deref(), index as i64, message)?;
            }
            Ok(json!({ "ingestedCount": messages.len() }))
        }
        "memory.assemble" | "memory_assemble" => {
            let session_id = string_value(&input, &["sessionId", "sessionKey"])
                .unwrap_or_else(|| "default".to_string());
            let messages = input
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let prompt = string_value(&input, &["prompt"]);
            runtime.assemble(&session_id, messages, prompt.as_deref())
        }
        "memory.afterTurn" | "memory_after_turn" => {
            let session_id = string_value(&input, &["sessionId", "sessionKey"])
                .unwrap_or_else(|| "default".to_string());
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
        "memory.dream" | "memory_dream" => {
            let session_id = string_value(&input, &["sessionId", "sessionKey"])
                .unwrap_or_else(|| "default".to_string());
            runtime.dream_consolidate(&session_id)
        }
        "memory.status" | "memory_status" => runtime.status(),
        _ => Err(format!("unsupported memory runtime operation: {operation}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn bootstrap_initializes_store() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let result = runtime.bootstrap("test-session", Some("key")).unwrap();
        assert_eq!(result["bootstrapped"], true);
    }

    #[test]
    fn after_turn_ingests_and_skips_retain_without_hindsight() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let messages = vec![
            json!({"role": "user", "content": "hello"}),
            json!({"role": "assistant", "content": "hi"}),
        ];
        let result = runtime.after_turn("session-1", Some("key"), &messages, 0).unwrap();
        assert_eq!(result["status"], "ok");
        assert_eq!(result["ingestedCount"], 2);
    }

    #[test]
    fn assemble_works_without_hindsight() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let messages = vec![json!({"role": "user", "content": "hello"})];
        let result = runtime.assemble("session-1", messages, Some("test query")).unwrap();
        assert_eq!(result["diagnostics"]["memoryRecall"]["implementation"], "hindsight-native");
    }

    #[test]
    fn hindsight_status_shows_not_configured() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let status = runtime.hindsight_status();
        assert_eq!(status["enabled"], false);
    }

    #[test]
    fn dream_consolidate_skips_without_hindsight() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let result = runtime.dream_consolidate("session-1").unwrap();
        assert_eq!(result["status"], "skipped");
    }

    #[test]
    fn status_returns_complete_info() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let status = runtime.status().unwrap();
        assert_eq!(status["status"], "ok");
        assert_eq!(status["implementation"], "hindsight-native");
    }
}

pub mod bank_resolver;
pub mod config;
pub mod feedback_guard;
pub mod hindsight_client;
pub mod quality;
pub mod recall_pipeline;
pub mod reflect_pipeline;
pub mod retain_pipeline;

mod helpers;
mod runtime_store;
mod session_summary_store;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::{
    AgentModelSelection, AgentRunProfileKind, AgentRunProfileRequest, AgentRunRequest,
    AgentRuntime, ChannelChatType, ChannelInboundEnvelope,
};

pub use self::config::*;
pub use self::helpers::*;
pub use self::runtime_store::RuntimeStore;
pub use self::session_summary_store::SessionSummaryStore;

use self::bank_resolver::{BankContext, BankResolverConfig};
use self::hindsight_client::{HindsightClient, RecallItem, RetainMemoryItem};
use self::recall_pipeline::RecallConfig;
use self::reflect_pipeline::ReflectConfig;
use self::retain_pipeline::RetainConfig;

#[derive(Clone, Debug)]
pub struct MemoryRuntime {
    runtime_root: PathBuf,
    config: MemoryRuntimeConfig,
    desktop_policy: Option<Value>,
    bank_resolver: BankResolverConfig,
    hindsight: Option<HindsightClient>,
}

impl MemoryRuntime {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        let runtime_root = runtime_root.into();
        let desktop_policy = read_desktop_memory_policy(&runtime_root);
        let config = Self::load_effective_config(&runtime_root);
        let bank_resolver = BankResolverConfig::from_hindsight_config(&config.hindsight);
        let hindsight = maybe_hindsight_client(&config.hindsight);
        Self {
            runtime_root,
            config,
            desktop_policy,
            bank_resolver,
            hindsight,
        }
    }

    pub fn with_config(runtime_root: impl Into<PathBuf>, config: MemoryRuntimeConfig) -> Self {
        let runtime_root = runtime_root.into();
        let desktop_policy = read_desktop_memory_policy(&runtime_root);
        let mut config = config;
        apply_desktop_memory_policy(&mut config, desktop_policy.as_ref());
        let bank_resolver = BankResolverConfig::from_hindsight_config(&config.hindsight);
        let hindsight = maybe_hindsight_client(&config.hindsight);
        Self {
            runtime_root,
            config,
            desktop_policy,
            bank_resolver,
            hindsight,
        }
    }

    pub fn config(&self) -> &MemoryRuntimeConfig {
        &self.config
    }

    pub fn load_effective_config(runtime_root: &Path) -> MemoryRuntimeConfig {
        let desktop_policy = read_desktop_memory_policy(runtime_root);
        let mut config = MemoryRuntimeConfig::load(runtime_root);
        apply_desktop_memory_policy(&mut config, desktop_policy.as_ref());
        config
    }

    pub fn hindsight(&self) -> Option<&HindsightClient> {
        self.hindsight.as_ref()
    }

    pub fn store(&self) -> RuntimeStore {
        RuntimeStore::new(helpers::expand_user_path(
            &self.config.runtime_store.db_path,
        ))
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
                    client.ensure_bank(&bank_id, layer, language)?;
                    if *layer == "mental-models" && self.config.hindsight.default_mental_models {
                        reflect_pipeline::ensure_default_mental_models(client, &bank_id, language)?;
                    }
                }
            }
        }

        Ok(json!({
            "bootstrapped": true,
            "sessionId": session_id,
            "sessionKey": session_key,
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
        let query_text = prompt.unwrap_or(session_id);
        let ctx = self.bank_context("main");
        let store = self.store();
        store.init()?;
        let tombstones = store.list_memory_tombstones(500)?;

        let recall_config = RecallConfig::from(&self.config.hindsight);
        let query = recall_pipeline::compose_recall_query(query_text, &messages, &recall_config);

        let (durable, experience, resource, mental_models) = if !self
            .config
            .hindsight
            .prompt_recall_enabled()
        {
            (vec![], vec![], vec![], vec![])
        } else if let Some(client) = &self.hindsight {
            if client.is_configured() {
                let items = recall_pipeline::parallel_recall(
                    client,
                    &self.bank_resolver,
                    &ctx,
                    &query,
                    &recall_config,
                );
                let items = filter_tombstoned_recall_items(items, &tombstones);
                let durable: Vec<_> = items
                    .iter()
                    .filter(|i| i.metadata.get("layer").and_then(|v| v.as_str()) == Some("durable"))
                    .cloned()
                    .collect();
                let experience: Vec<_> = items
                    .iter()
                    .filter(|i| {
                        i.metadata.get("layer").and_then(|v| v.as_str()) == Some("experience")
                    })
                    .cloned()
                    .collect();
                let resource: Vec<_> = items
                    .iter()
                    .filter(|i| {
                        i.metadata.get("layer").and_then(|v| v.as_str()) == Some("resource")
                    })
                    .cloned()
                    .collect();
                let mental_models: Vec<_> = items
                    .iter()
                    .filter(|i| {
                        i.metadata.get("layer").and_then(|v| v.as_str()) == Some("mental-models")
                    })
                    .cloned()
                    .collect();
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
        self.after_turn_with_options(
            session_id,
            session_key,
            messages,
            pre_prompt_message_count,
            None,
        )
    }

    pub fn after_turn_with_options(
        &self,
        session_id: &str,
        session_key: Option<&str>,
        messages: &[Value],
        pre_prompt_message_count: usize,
        memory_directive: Option<&Value>,
    ) -> Result<Value, String> {
        let new_messages: Vec<Value> = messages
            .iter()
            .skip(pre_prompt_message_count)
            .cloned()
            .collect();

        let store = self.store();
        store.init()?;
        let mut ingested_count = 0usize;
        for (index, message) in new_messages.iter().enumerate() {
            if store.append_message(
                session_id,
                session_key,
                (pre_prompt_message_count + index) as i64,
                message,
            )? {
                ingested_count += 1;
            }
        }

        let retain_config = RetainConfig::from(&self.config.hindsight);
        let ctx = self.bank_context("main");
        let policy = EffectiveMemoryPolicy::from_config(&self.config);
        let directive = MemoryDirective::from_value(memory_directive);

        let has_final_assistant = new_messages
            .last()
            .and_then(|m| m.get("role").and_then(Value::as_str))
            == Some("assistant");
        let has_tool_calls = new_messages
            .last()
            .is_some_and(memory_message_has_tool_calls);

        let turn_number = messages.len() as u32;
        let auto_should_retain = retain_config.auto_retain
            && retain_pipeline::should_retain_this_turn(
                turn_number,
                retain_config.retain_every_n_turns,
                has_final_assistant,
                has_tool_calls,
            );
        let should_retain = match directive {
            MemoryDirective::Auto => auto_should_retain,
            MemoryDirective::Remember { .. } => true,
            MemoryDirective::Forget { .. } | MemoryDirective::DoNotRemember { .. } => false,
        };
        let skip_reason = match directive {
            MemoryDirective::Auto => retain_skip_reason(
                retain_config.auto_retain,
                retain_config.retain_every_n_turns,
                has_final_assistant,
                has_tool_calls,
            ),
            MemoryDirective::Remember { .. } => "none",
            MemoryDirective::Forget { .. } => "user_forget_requested",
            MemoryDirective::DoNotRemember { .. } => "user_do_not_remember",
        };

        let mut result = json!({
            "status": "ok",
            "ingestedCount": ingested_count,
            "hindsightEnabled": self.config.hindsight.enabled,
            "shouldRetain": should_retain,
        });

        let mut outbox = json!({
            "status": "not_queued",
            "jobId": Value::Null,
            "enqueued": false,
        });
        match &directive {
            MemoryDirective::Auto if should_retain => {
                outbox = self.enqueue_retain_job(
                    &store,
                    session_id,
                    &ctx,
                    "experience",
                    "retain_experience",
                    "agent_turn",
                    retain_pipeline::compose_retain_payload(&new_messages, &ctx, &retain_config),
                    &retain_config,
                )?;
            }
            MemoryDirective::Remember { content } => {
                outbox = self.enqueue_retain_job(
                    &store,
                    session_id,
                    &ctx,
                    "durable",
                    "retain_durable",
                    "explicit_remember",
                    Some(content.clone()),
                    &retain_config,
                )?;
            }
            MemoryDirective::Forget { content } => {
                outbox = self.enqueue_forget_job(&store, session_id, content, None)?;
            }
            MemoryDirective::DoNotRemember { .. } => {
                outbox["status"] = json!("skipped");
                outbox["skipReason"] = json!("user_do_not_remember");
            }
            MemoryDirective::Auto => {}
        }

        let activity_status = if outbox["status"] == "pending" {
            "enqueued"
        } else if should_retain {
            "skipped"
        } else {
            "skipped"
        };
        store.record_memory_activity(
            Some(session_id),
            "after_turn",
            activity_status,
            json!({
                "shouldRetain": should_retain,
                "skipReason": skip_reason,
                "directive": directive.diagnostics(),
                "jobId": outbox.get("jobId").cloned().unwrap_or(Value::Null),
                "outbox": outbox.clone(),
            }),
        )?;
        result["diagnostics"] = json!({
            "memory": {
                "policy": policy,
                "afterTurn": {
                    "ran": true,
                    "shouldRetain": should_retain,
                    "skipReason": skip_reason,
                    "directive": directive.diagnostics(),
                    "outbox": outbox,
                }
            }
        });

        Ok(result)
    }

    fn enqueue_retain_job(
        &self,
        store: &RuntimeStore,
        session_id: &str,
        ctx: &BankContext,
        layer: &str,
        kind: &str,
        context: &str,
        content: Option<String>,
        retain_config: &RetainConfig,
    ) -> Result<Value, String> {
        if !self.config.hindsight.enabled {
            return Ok(json!({
                "status": "skipped",
                "skipReason": "hindsight_disabled",
                "jobId": Value::Null,
                "enqueued": false,
                "kind": kind,
                "layer": layer,
            }));
        }
        if self
            .hindsight
            .as_ref()
            .is_none_or(|client| !client.is_configured())
        {
            return Ok(json!({
                "status": "skipped",
                "skipReason": "hindsight_not_available",
                "jobId": Value::Null,
                "enqueued": false,
                "kind": kind,
                "layer": layer,
            }));
        }
        let Some(content) = content.filter(|value| !value.trim().is_empty()) else {
            return Ok(json!({
                "status": "skipped",
                "skipReason": "empty_retain_payload",
                "jobId": Value::Null,
                "enqueued": false,
                "kind": kind,
                "layer": layer,
            }));
        };
        let bank_id = self.bank_resolver.resolve(ctx, layer);
        let chunks = retain_pipeline::chunk_retain_content(&content, retain_config);
        let chunk_values = chunks
            .iter()
            .map(|chunk| {
                json!({
                    "content": chunk.content,
                    "metadata": chunk.metadata,
                })
            })
            .collect::<Vec<_>>();
        let payload = json!({
            "bankId": bank_id,
            "content": content,
            "chunks": chunk_values,
            "context": context,
            "metadata": retain_pipeline::build_retain_metadata(ctx),
            "tags": retain_pipeline::build_retain_tags(ctx, layer),
        });
        let enqueued = store.enqueue_memory_job(session_id, kind, Some(layer), payload)?;
        Ok(json!({
            "status": enqueued.status,
            "jobId": enqueued.job_id,
            "enqueued": enqueued.enqueued,
            "kind": kind,
            "layer": layer,
        }))
    }

    fn enqueue_forget_job(
        &self,
        store: &RuntimeStore,
        session_id: &str,
        content: &str,
        target_id: Option<&str>,
    ) -> Result<Value, String> {
        if content.trim().is_empty() {
            return Ok(json!({
                "status": "skipped",
                "skipReason": "empty_forget_payload",
                "jobId": Value::Null,
                "enqueued": false,
                "kind": "forget_memory",
                "layer": Value::Null,
            }));
        }
        let payload = json!({
            "query": content,
            "reason": "explicit_forget",
            "targetId": target_id,
        });
        let enqueued = store.enqueue_memory_job(session_id, "forget_memory", None, payload)?;
        Ok(json!({
            "status": enqueued.status,
            "jobId": enqueued.job_id,
            "enqueued": enqueued.enqueued,
            "kind": "forget_memory",
            "layer": Value::Null,
        }))
    }

    pub fn enqueue_desktop_memory_item(
        &self,
        item_id: &str,
        agent_id: &str,
        title: &str,
        summary: &str,
        content: &str,
        category: &str,
        source: &str,
        tags: &[String],
    ) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        let layer = desktop_memory_layer(category);
        let kind = retain_kind_for_layer(layer);
        if !self.config.hindsight.enabled {
            return Ok(json!({
                "status": "skipped",
                "skipReason": "hindsight_disabled",
                "enqueued": false,
                "provider": "local",
                "kind": kind,
                "layer": layer,
                "bankId": Value::Null,
            }));
        }
        if self
            .hindsight
            .as_ref()
            .is_none_or(|client| !client.is_configured())
        {
            return Ok(json!({
                "status": "skipped",
                "skipReason": "hindsight_not_available",
                "enqueued": false,
                "provider": "local",
                "kind": kind,
                "layer": layer,
                "bankId": Value::Null,
            }));
        }
        let ctx = self.bank_context(agent_id);
        let bank_id = self.bank_resolver.resolve(&ctx, layer);
        let retain_config = RetainConfig::from(&self.config.hindsight);
        let content = [title.trim(), summary.trim(), content.trim()]
            .into_iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        if content.trim().is_empty() {
            return Ok(json!({
                "status": "skipped",
                "skipReason": "empty_retain_payload",
                "enqueued": false,
                "provider": "local",
                "kind": kind,
                "layer": layer,
                "bankId": bank_id,
            }));
        }
        let mut retain_tags = retain_pipeline::build_retain_tags(&ctx, layer);
        retain_tags.push("desktop-memory".to_string());
        retain_tags.push(format!("category:{category}"));
        retain_tags.extend(tags.iter().filter(|tag| !tag.trim().is_empty()).cloned());
        let payload = json!({
                "bankId": bank_id,
                "content": content,
                "chunks": retain_pipeline::chunk_retain_content(&content, &retain_config)
                    .into_iter()
                    .map(|chunk| json!({
                        "content": chunk.content,
                        "metadata": chunk.metadata,
                    }))
                    .collect::<Vec<_>>(),
                "context": "desktop_memory_item",
                "metadata": {
                "layer": layer,
                "agentId": agent_id,
                "desktopMemoryItemId": item_id,
                "title": title,
                "summary": summary,
                "category": category,
                "source": source,
            },
            "tags": retain_tags,
        });
        let enqueued = store.enqueue_memory_job(
            &format!("desktop-memory:{agent_id}"),
            kind,
            Some(layer),
            payload,
        )?;
        Ok(json!({
            "status": enqueued.status,
            "jobId": enqueued.job_id,
            "enqueued": enqueued.enqueued,
            "provider": "hindsight",
            "kind": kind,
            "layer": layer,
            "bankId": bank_id,
        }))
    }

    pub fn enqueue_forget_memory(
        &self,
        session_id: &str,
        content: &str,
        target_id: Option<&str>,
    ) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        self.enqueue_forget_job(&store, session_id, content, target_id)
    }

    pub fn process_outbox_once(&self, limit: usize) -> Result<Value, String> {
        let store = self.store();
        store.init()?;
        let started_at = helpers::now_millis();
        let jobs = store.list_outbox_jobs(Some("pending"), limit)?;
        let mut status_counts = serde_json::Map::new();
        let mut results = Vec::new();
        for job in jobs {
            let job_id = job.get("id").and_then(Value::as_str).unwrap_or("");
            let kind = job.get("kind").and_then(Value::as_str).unwrap_or("");
            let process_result = self.process_outbox_job(&store, &job);
            let (status, last_error) = match process_result {
                Ok(status) => (status, None),
                Err(error) if error.starts_with("unsupported_memory_job_kind:") => {
                    ("unsupported".to_string(), Some(error))
                }
                Err(error) => ("failed".to_string(), Some(error)),
            };
            store.update_memory_job_status(job_id, &status, last_error.as_deref())?;
            store.record_memory_activity(
                job.get("sessionId").and_then(Value::as_str),
                "outbox_process",
                &status,
                json!({
                    "jobId": job_id,
                    "kind": kind,
                    "lastError": last_error,
                }),
            )?;
            let current = status_counts
                .get(&status)
                .and_then(Value::as_i64)
                .unwrap_or(0);
            status_counts.insert(status.clone(), json!(current + 1));
            results.push(json!({
                "jobId": job_id,
                "kind": kind,
                "status": status,
            }));
        }
        let worker_status = memory_worker_run_status(&status_counts);
        let status_counts_value = Value::Object(status_counts.clone());
        store.record_memory_worker_result(
            self.memory_worker_enabled(),
            worker_status,
            started_at,
            results.len(),
            &status_counts_value,
            None,
        )?;
        Ok(json!({
            "status": "ok",
            "processedCount": results.len(),
            "statusCounts": status_counts,
            "results": results,
        }))
    }

    fn process_outbox_job(&self, store: &RuntimeStore, job: &Value) -> Result<String, String> {
        let kind = job.get("kind").and_then(Value::as_str).unwrap_or("");
        if kind == "forget_memory" {
            return self.process_forget_memory_job(store, job);
        }
        if !matches!(
            kind,
            "retain_experience" | "retain_durable" | "retain_resource"
        ) {
            return Err(format!("unsupported_memory_job_kind:{kind}"));
        }
        let Some(client) = &self.hindsight else {
            return Err("hindsight_not_available".to_string());
        };
        if !client.is_configured() {
            return Err("hindsight_not_available".to_string());
        }
        let payload = job.get("payload").unwrap_or(&Value::Null);
        let bank_id = payload
            .get("bankId")
            .and_then(Value::as_str)
            .ok_or_else(|| "memory_job_missing_bank_id".to_string())?;
        let content = payload
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| "memory_job_missing_content".to_string())?;
        let context = payload
            .get("context")
            .and_then(Value::as_str)
            .unwrap_or("memory_outbox");
        let metadata = payload.get("metadata").cloned().unwrap_or(Value::Null);
        let tags = payload
            .get("tags")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let tag_refs: Vec<&str> = tags.iter().map(String::as_str).collect();
        if let Some(chunks) = payload.get("chunks").and_then(Value::as_array) {
            let items = chunks
                .iter()
                .filter_map(|chunk| {
                    let content = chunk.get("content").and_then(Value::as_str)?;
                    if content.trim().is_empty() {
                        return None;
                    }
                    let chunk_metadata = chunk.get("metadata").cloned().unwrap_or(Value::Null);
                    Some(RetainMemoryItem {
                        content: content.to_string(),
                        context: context.to_string(),
                        metadata: merge_retain_metadata(&metadata, &chunk_metadata),
                        tags: tags.clone(),
                    })
                })
                .collect::<Vec<_>>();
            if !items.is_empty() {
                client.retain_items(bank_id, &items)?;
                return Ok("completed".to_string());
            }
        }
        client.retain(bank_id, content, context, metadata, &tag_refs)?;
        Ok("completed".to_string())
    }

    fn process_forget_memory_job(
        &self,
        store: &RuntimeStore,
        job: &Value,
    ) -> Result<String, String> {
        let payload = job.get("payload").unwrap_or(&Value::Null);
        let query = payload
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "memory_forget_missing_query".to_string())?;
        let reason = payload
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("explicit_forget");
        let target_id = payload.get("targetId").and_then(Value::as_str);
        store.record_memory_tombstone(query, reason, target_id, payload.clone())?;
        Ok("completed_local".to_string())
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

        let reflect_config =
            ReflectConfig::from_hindsight_config(&self.config.hindsight, &self.config.dreaming);

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

    pub async fn compact_session(&self, session_id: &str, force: bool) -> Result<Value, String> {
        let messages = self.store().list_messages(session_id, 10_000)?;
        if messages.is_empty() && !force {
            return Ok(json!({
                "ok": true,
                "compacted": false,
                "reason": "no_messages",
            }));
        }

        let transcript = messages
            .iter()
            .map(|message| {
                let role = message
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let content = feedback_guard::extract_text_content(message);
                format!("{role}: {content}")
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let prompt = format!(
            "Summarize this transcript for future context. Preserve user intent, task state, decisions, blockers, and next actions.\n\n{transcript}"
        );
        let run_id = format!("memory-compact-{}", helpers::now_millis());
        let result = AgentRuntime::new(self.runtime_root.clone())
            .run_turn(AgentRunRequest {
                run_id: run_id.clone(),
                agent_id: "session-summary".to_string(),
                session_key: session_id.to_string(),
                inbound: ChannelInboundEnvelope {
                    channel: "memory".to_string(),
                    account_id: Some("rust-runtime".to_string()),
                    from: "memory.compact".to_string(),
                    to: "agent:session-summary".to_string(),
                    chat_type: ChannelChatType::Direct,
                    body: prompt,
                    raw_body: None,
                    message_id: Some(format!("{run_id}:input")),
                    thread_id: Some(session_id.to_string()),
                    media_urls: Vec::new(),
                    metadata: BTreeMap::new(),
                },
                model: AgentModelSelection {
                    provider: "configured".to_string(),
                    model: "configured".to_string(),
                    reasoning_level: None,
                },
                enabled_tools: vec![
                    "session_summary_file_read".to_string(),
                    "session_summary_file_edit".to_string(),
                ],
                profile: Some(AgentRunProfileRequest {
                    kind: AgentRunProfileKind::Compaction,
                    special_agent: Some("session-summary".to_string()),
                    memory_after_turn: Some(false),
                }),
                options: BTreeMap::new(),
            })
            .await
            .map_err(|error| format!("failed to run compaction agent: {error:?}"))?;

        let compacted_through = messages
            .last()
            .and_then(|message| {
                message
                    .get("id")
                    .or_else(|| message.get("messageId"))
                    .and_then(Value::as_str)
            })
            .map(str::to_string);
        let summary_store = self.session_summary_store();
        summary_store.refresh(session_id, &result.assistant_text)?;
        summary_store.write_compaction_cursor(
            session_id,
            compacted_through.as_deref(),
            None,
            None,
            messages.len(),
        )?;
        self.store()
            .upsert_session_compaction_state(session_id, messages.len() as i64)?;

        Ok(json!({
            "ok": true,
            "compacted": true,
            "result": {
                "summary": result.assistant_text,
                "compactedThroughMessageId": compacted_through,
                "tailStartMessageIndex": messages.len(),
                "implementation": "rust-native-agent-runtime",
            }
        }))
    }

    fn recent_session_summaries(
        &self,
        session_id: &str,
        _count: usize,
    ) -> Result<Vec<String>, String> {
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
        let lifecycle = self.hindsight_lifecycle_status();
        let reason = lifecycle
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_string);
        json!({
            "enabled": config.enabled,
            "ready": lifecycle.get("status").and_then(Value::as_str) == Some("ready"),
            "lifecycle": lifecycle,
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
                    "autoRetain": self.config.hindsight.auto_retain,
                    "authConfigured": !self.config.hindsight.api_key.trim().is_empty(),
                },
                "dreaming": self.config.dreaming,
                "sessionSummary": self.config.session_summary,
                "desktopPolicy": self.desktop_policy.clone(),
            },
            "hindsight": self.hindsight_status(),
            "quality": quality::MemoryQualityProfile::for_language_hint_with_config(
                &self.config.hindsight.language_hints.primary_language,
                &self.config.hindsight.quality,
            ).diagnostics(),
            "policy": EffectiveMemoryPolicy::from_config(&self.config),
            "outbox": store.memory_outbox_summary()?,
            "worker": store.memory_worker_status(self.memory_worker_enabled())?,
            "recentActivity": store.list_memory_activity(None, 10)?,
        }))
    }

    pub fn memory_worker_enabled(&self) -> bool {
        true
    }

    fn hindsight_lifecycle_status(&self) -> Value {
        let config = &self.config.hindsight;
        let policy_mode = self
            .desktop_policy
            .as_ref()
            .and_then(|policy| policy.get("hindsightMode"))
            .and_then(Value::as_str);
        let policy_managed = self
            .desktop_policy
            .as_ref()
            .and_then(|policy| policy.get("hindsightManaged"))
            .and_then(Value::as_bool);
        let policy_status = self
            .desktop_policy
            .as_ref()
            .and_then(|policy| policy.get("hindsightLifecycleStatus"))
            .and_then(Value::as_str);
        let policy_reason = self
            .desktop_policy
            .as_ref()
            .and_then(|policy| policy.get("hindsightLifecycleReason"))
            .and_then(Value::as_str);
        if !config.enabled {
            let managed = policy_managed.unwrap_or(false);
            let status = if managed && policy_status == Some("unavailable") {
                "unavailable"
            } else {
                "disabled"
            };
            let reason = if status == "unavailable" {
                policy_reason.unwrap_or("hindsight_unavailable")
            } else {
                "disabled"
            };
            return json!({
                "provider": "hindsight",
                "mode": policy_mode.unwrap_or("off"),
                "status": status,
                "reason": reason,
                "baseUrl": config.base_url,
                "managed": managed,
            });
        }
        if config.base_url.trim().is_empty() {
            return json!({
                "provider": "hindsight",
                "mode": policy_mode.unwrap_or("local"),
                "status": "degraded",
                "reason": "missing_base_url",
                "baseUrl": config.base_url,
                "managed": policy_managed.unwrap_or(true),
            });
        }
        let mode = policy_mode.unwrap_or(if is_loopback_hindsight_url(&config.base_url) {
            "local"
        } else {
            "remote"
        });
        let healthy = self
            .hindsight
            .as_ref()
            .is_some_and(HindsightClient::health_check);
        let status = if healthy {
            "ready"
        } else if policy_status == Some("starting") {
            "starting"
        } else {
            "degraded"
        };
        let reason = if healthy {
            Value::Null
        } else if status == "starting" {
            json!("health_check_pending")
        } else {
            json!(policy_reason.unwrap_or("health_check_failed"))
        };
        json!({
            "provider": "hindsight",
            "mode": mode,
            "status": status,
            "reason": reason,
            "baseUrl": config.base_url,
            "managed": policy_managed.unwrap_or(mode == "local"),
        })
    }
}

fn memory_worker_run_status(status_counts: &serde_json::Map<String, Value>) -> &'static str {
    if status_counts.is_empty() {
        return "idle";
    }
    if status_counts
        .get("failed")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        "failed"
    } else {
        "completed"
    }
}

fn is_loopback_hindsight_url(value: &str) -> bool {
    value.contains("://127.0.0.1") || value.contains("://localhost") || value.contains("://[::1]")
}

fn desktop_memory_layer(category: &str) -> &'static str {
    match category.trim() {
        "偏好" => "durable",
        "经验" => "experience",
        "项目" | "其他" => "resource",
        _ => "resource",
    }
}

fn retain_kind_for_layer(layer: &str) -> &'static str {
    match layer {
        "durable" => "retain_durable",
        "experience" => "retain_experience",
        "resource" => "retain_resource",
        _ => "retain_resource",
    }
}

fn merge_retain_metadata(base: &Value, chunk: &Value) -> Value {
    let mut merged = base.clone();
    if let (Some(merged), Some(chunk)) = (merged.as_object_mut(), chunk.as_object()) {
        for (key, value) in chunk {
            merged.insert(key.clone(), value.clone());
        }
        return Value::Object(merged.clone());
    }
    json!({
        "base": base,
        "chunk": chunk,
    })
}

fn filter_tombstoned_recall_items(items: Vec<RecallItem>, tombstones: &[Value]) -> Vec<RecallItem> {
    if tombstones.is_empty() {
        return items;
    }
    items
        .into_iter()
        .filter(|item| !recall_item_matches_tombstone(item, tombstones))
        .collect()
}

fn recall_item_matches_tombstone(item: &RecallItem, tombstones: &[Value]) -> bool {
    let item_target = item
        .metadata
        .get("desktopMemoryItemId")
        .and_then(Value::as_str);
    let item_text = item.text.to_ascii_lowercase();
    tombstones.iter().any(|tombstone| {
        let target_match = tombstone
            .get("targetId")
            .and_then(Value::as_str)
            .zip(item_target)
            .is_some_and(|(target_id, item_id)| target_id == item_id);
        if target_match {
            return true;
        }
        tombstone
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|query| !query.is_empty())
            .is_some_and(|query| item_text.contains(&query.to_ascii_lowercase()))
    })
}

fn maybe_hindsight_client(config: &HindsightConfig) -> Option<HindsightClient> {
    if !config.enabled || config.base_url.trim().is_empty() {
        return None;
    }
    HindsightClient::new(config).ok()
}

fn memory_message_has_tool_calls(message: &Value) -> bool {
    for key in ["tool_calls", "toolCalls"] {
        if let Some(value) = message.get(key) {
            return match value {
                Value::Array(items) => !items.is_empty(),
                Value::Null => false,
                _ => true,
            };
        }
    }
    message
        .get("blocks")
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks.iter().any(|block| {
                block.get("type").and_then(Value::as_str) == Some("toolUse")
                    || block.get("type").and_then(Value::as_str) == Some("tool_use")
            })
        })
}

fn retain_skip_reason(
    auto_retain: bool,
    retain_every_n_turns: u32,
    has_final_assistant: bool,
    has_tool_calls: bool,
) -> &'static str {
    if !auto_retain {
        return "auto_retain_disabled";
    }
    if !has_final_assistant {
        return "no_final_assistant";
    }
    if has_tool_calls {
        return "tool_calls";
    }
    if retain_every_n_turns == 0 {
        return "retain_interval_disabled";
    }
    "none"
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum MemoryDirective {
    Auto,
    Remember { content: String },
    Forget { content: String },
    DoNotRemember { reason: Option<String> },
}

impl MemoryDirective {
    fn from_value(value: Option<&Value>) -> Self {
        let Some(value) = value else {
            return Self::Auto;
        };
        if value.as_bool() == Some(true) {
            return Self::DoNotRemember { reason: None };
        }
        if let Some(action) = value.as_str() {
            return Self::from_action(action, None, None);
        }
        if let Some(object) = value.as_object() {
            if object
                .get("doNotRemember")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return Self::DoNotRemember {
                    reason: string_value(value, &["reason"]),
                };
            }
            let action = string_value(value, &["action", "intent", "memoryAction"])
                .unwrap_or_else(|| "auto".to_string());
            let content = string_value(value, &["content", "text", "memory", "target", "query"]);
            let reason = string_value(value, &["reason"]);
            return Self::from_action(&action, content, reason);
        }
        Self::Auto
    }

    fn from_action(action: &str, content: Option<String>, reason: Option<String>) -> Self {
        match normalize_memory_action(action).as_str() {
            "remember" => Self::Remember {
                content: content.unwrap_or_default(),
            },
            "forget" => Self::Forget {
                content: content.unwrap_or_default(),
            },
            "do_not_remember" => Self::DoNotRemember { reason },
            _ => Self::Auto,
        }
    }

    fn diagnostics(&self) -> Value {
        match self {
            Self::Auto => json!({ "action": "auto" }),
            Self::Remember { content } => json!({
                "action": "remember",
                "contentChars": content.chars().count(),
            }),
            Self::Forget { content } => json!({
                "action": "forget",
                "contentChars": content.chars().count(),
            }),
            Self::DoNotRemember { reason } => json!({
                "action": "do-not-remember",
                "reason": reason,
            }),
        }
    }
}

fn normalize_memory_action(action: &str) -> String {
    action.trim().to_ascii_lowercase().replace(['-', ' '], "_")
}

fn read_desktop_memory_policy(runtime_root: &Path) -> Option<Value> {
    let path = runtime_root
        .join("config")
        .join("desktop-memory-policy.json");
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn apply_desktop_memory_policy(config: &mut MemoryRuntimeConfig, policy: Option<&Value>) {
    let Some(policy) = policy else {
        return;
    };
    let managed_unavailable = policy.get("hindsightManaged").and_then(Value::as_bool) == Some(true)
        && matches!(
            policy
                .get("hindsightLifecycleStatus")
                .and_then(Value::as_str),
            Some("failed" | "unavailable")
        );
    if managed_unavailable {
        config.hindsight.enabled = false;
        config.hindsight.base_url.clear();
    } else {
        if let Some(enabled) = policy.get("hindsightEnabled").and_then(Value::as_bool) {
            config.hindsight.enabled = enabled;
        }
        if let Some(base_url) = policy
            .get("hindsightBaseUrl")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            config.hindsight.base_url = base_url.to_string();
        }
    }
    if policy.get("memoryDreamEnabled").and_then(Value::as_bool) == Some(false) {
        config.dreaming.enabled = false;
    }
    let remembers_preferences = policy
        .get("rememberPreferences")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let remembers_project_context = policy
        .get("rememberProjectContext")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !remembers_preferences && !remembers_project_context {
        config.hindsight.auto_retain = false;
    }
}

impl MemoryRuntimeConfig {
    pub fn load(runtime_root: &Path) -> Self {
        let raw = read_active_config()
            .and_then(|c| c.get("memory").cloned())
            .unwrap_or(Value::Null);
        let mut config = Self::from_value(&raw);
        let has_runtime_db_path =
            string_value(raw.get("runtimeStore").unwrap_or(&Value::Null), &["dbPath"]).is_some();
        if !has_runtime_db_path {
            config.runtime_store.db_path = runtime_root
                .join("memory-runtime.db")
                .to_string_lossy()
                .to_string();
        }
        config
    }

    pub fn from_value(raw: &Value) -> Self {
        let object = raw.as_object();
        let runtime_store_db =
            string_value(raw.get("runtimeStore").unwrap_or(&Value::Null), &["dbPath"])
                .unwrap_or_else(|| "~/.crawclaw/memory-runtime.db".to_string());

        let hindsight_raw = object
            .and_then(|o| o.get("hindsight"))
            .unwrap_or(&Value::Null);
        let hindsight = HindsightConfig::from_value(hindsight_raw);

        let dreaming_raw = object
            .and_then(|o| o.get("dreaming"))
            .unwrap_or(&Value::Null);
        let dreaming = DreamingConfig::from_value(dreaming_raw);

        let summary_raw = object
            .and_then(|o| o.get("sessionSummary"))
            .unwrap_or(&Value::Null);
        let session_summary = SessionSummaryConfig::from_value(summary_raw);

        Self {
            runtime_store: RuntimeStoreConfig {
                db_path: runtime_store_db,
            },
            hindsight,
            dreaming,
            session_summary,
        }
    }
}

impl HindsightConfig {
    pub fn from_value(raw: &Value) -> Self {
        let defaults = Self::default();

        let api_key = string_value(raw, &["apiKey"])
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
        let quality_raw = raw.get("quality").unwrap_or(&Value::Null);
        let quality = HindsightQualityConfig {
            retain_chunk_max_chars: optional_positive_usize(quality_raw, "retainChunkMaxChars"),
            retain_chunk_overlap_chars: optional_usize(quality_raw, "retainChunkOverlapChars"),
            recall_min_score: optional_score(quality_raw, "recallMinScore"),
            recall_rerank_top_k: optional_positive_usize(quality_raw, "recallRerankTopK"),
            query_rewrite: quality_raw.get("queryRewrite").and_then(Value::as_bool),
        };

        Self {
            enabled: raw
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.enabled),
            base_url: string_value(raw, &["baseUrl"]).unwrap_or(defaults.base_url),
            api_key,
            bank_prefix: string_value(raw, &["bankPrefix"]).unwrap_or(defaults.bank_prefix),
            bank_granularity,
            shared_mode: raw
                .get("sharedMode")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.shared_mode),
            shared_bank_id: string_value(raw, &["sharedBankId"]).unwrap_or(defaults.shared_bank_id),
            memory_mode: string_value(raw, &["memoryMode"]).unwrap_or(defaults.memory_mode),
            auto_retain: raw
                .get("autoRetain")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.auto_retain),
            retain_roles,
            retain_every_n_turns: raw
                .get("retainEveryNTurns")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.retain_every_n_turns as u64)
                as u32,
            retain_overlap_turns: raw
                .get("retainOverlapTurns")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.retain_overlap_turns as u64)
                as u32,
            retain_async: raw
                .get("retainAsync")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.retain_async),
            default_budget: string_value(raw, &["defaultBudget"])
                .unwrap_or(defaults.default_budget),
            max_tokens: raw
                .get("maxTokens")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.max_tokens as u64) as u32,
            recall_context_turns: raw
                .get("recallContextTurns")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.recall_context_turns as u64)
                as u32,
            recall_max_query_chars: raw
                .get("recallMaxQueryChars")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.recall_max_query_chars as u64)
                as usize,
            recall_types,
            recall_injection_position: string_value(raw, &["recallInjectionPosition"])
                .unwrap_or(defaults.recall_injection_position),
            auto_reflect: raw
                .get("autoReflect")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.auto_reflect),
            reflect_budget: string_value(raw, &["reflectBudget"])
                .unwrap_or(defaults.reflect_budget),
            reflect_max_tokens: raw
                .get("reflectMaxTokens")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.reflect_max_tokens as u64)
                as u32,
            default_mental_models: raw
                .get("defaultMentalModels")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.default_mental_models),
            enable_knowledge_tools: raw
                .get("enableKnowledgeTools")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.enable_knowledge_tools),
            tags_match: string_value(raw, &["tagsMatch"]).unwrap_or(defaults.tags_match),
            tags,
            timeout_ms: raw
                .get("timeoutMs")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.timeout_ms),
            language_hints,
            quality,
        }
    }
}

fn optional_usize(raw: &Value, key: &str) -> Option<usize> {
    raw.get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

fn optional_positive_usize(raw: &Value, key: &str) -> Option<usize> {
    optional_usize(raw, key).filter(|value| *value > 0)
}

fn optional_score(raw: &Value, key: &str) -> Option<f64> {
    raw.get(key)
        .and_then(Value::as_f64)
        .filter(|value| (0.0..=1.0).contains(value))
}

impl DreamingConfig {
    pub fn from_value(raw: &Value) -> Self {
        let defaults = Self::default();
        Self {
            enabled: raw
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.enabled),
            min_hours: raw
                .get("minHours")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.min_hours as u64) as u32,
            min_sessions: raw
                .get("minSessions")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.min_sessions as u64) as u32,
            scan_throttle_ms: raw
                .get("scanThrottleMs")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.scan_throttle_ms),
            lock_stale_after_ms: raw
                .get("lockStaleAfterMs")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.lock_stale_after_ms),
        }
    }
}

impl SessionSummaryConfig {
    pub fn from_value(raw: &Value) -> Self {
        let defaults = Self::default();
        Self {
            enabled: raw
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.enabled),
            min_tokens_to_init: raw
                .get("minTokensToInit")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.min_tokens_to_init as u64)
                as u32,
            min_tokens_between_updates: raw
                .get("minTokensBetweenUpdates")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.min_tokens_between_updates as u64)
                as u32,
            tool_calls_between_updates: raw
                .get("toolCallsBetweenUpdates")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.tool_calls_between_updates as u64)
                as u32,
            max_wait_ms: raw
                .get("maxWaitMs")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.max_wait_ms),
            max_turns: raw
                .get("maxTurns")
                .and_then(Value::as_u64)
                .unwrap_or(defaults.max_turns as u64) as u32,
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
            runtime.ingest_batch(&session_id, session_key.as_deref(), &messages)
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
            let memory_directive = input
                .get("memoryDirective")
                .or_else(|| input.get("memoryIntent"))
                .or_else(|| input.get("memoryAction"))
                .or_else(|| input.get("doNotRemember"))
                .or(Some(&input));
            runtime.after_turn_with_options(
                &session_id,
                session_key.as_deref(),
                &messages,
                pre_prompt_message_count,
                memory_directive,
            )
        }
        "memory.outbox.list" | "memory_outbox_list" => {
            let status = string_value(&input, &["status"]);
            let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            let store = runtime.store();
            store.init()?;
            Ok(json!({
                "status": "ok",
                "jobs": store.list_outbox_jobs(status.as_deref(), limit)?,
            }))
        }
        "memory.outbox.process" | "memory_outbox_process" => {
            let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(10) as usize;
            runtime.process_outbox_once(limit)
        }
        "memory.activity.list" | "memory_activity_list" => {
            let session_id = string_value(&input, &["sessionId", "sessionKey"]);
            let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
            let store = runtime.store();
            store.init()?;
            Ok(json!({
                "status": "ok",
                "activity": store.list_memory_activity(session_id.as_deref(), limit)?,
            }))
        }
        "memory.dream" | "memory_dream" => {
            let session_id = string_value(&input, &["sessionId", "sessionKey"])
                .unwrap_or_else(|| "default".to_string());
            runtime.dream_consolidate(&session_id)
        }
        "memory.compact" | "memory_compact" => {
            let session_id = string_value(&input, &["sessionId", "sessionKey"])
                .unwrap_or_else(|| "default".to_string());
            let force = input.get("force").and_then(Value::as_bool).unwrap_or(false);
            runtime.compact_session(&session_id, force).await
        }
        "memory.status" | "memory_status" => runtime.status(),
        _ => Err(format!("unsupported memory runtime operation: {operation}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;
    use tempfile::tempdir;

    #[test]
    fn bootstrap_initializes_store() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let result = runtime.bootstrap("test-session", Some("key")).unwrap();
        assert_eq!(result["bootstrapped"], true);
    }

    #[test]
    fn bootstrap_surfaces_hindsight_bank_create_failure() {
        let dir = tempdir().unwrap();
        let (base_url, _request_rx) = start_hindsight_response_server(
            "HTTP/1.1 405 Method Not Allowed\r\nContent-Type: application/json\r\nContent-Length: 31\r\nConnection: close\r\n\r\n{\"detail\":\"Method Not Allowed\"}",
        );
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        config.hindsight.enabled = true;
        config.hindsight.base_url = base_url;
        config.hindsight.default_mental_models = false;
        let runtime = MemoryRuntime::with_config(dir.path(), config);

        let error = runtime
            .bootstrap("test-session", Some("key"))
            .expect_err("bank create failure should surface");

        assert!(error.contains("Create bank failed with HTTP 405"));
    }

    #[test]
    fn after_turn_ingests_and_skips_retain_without_hindsight() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let messages = vec![
            json!({"id": "m1", "role": "user", "content": "hello"}),
            json!({"id": "m2", "role": "assistant", "content": "hi"}),
        ];
        let result = runtime
            .after_turn("session-1", Some("key"), &messages, 0)
            .unwrap();
        assert_eq!(result["status"], "ok");
        assert_eq!(result["ingestedCount"], 2);

        let replay = runtime
            .after_turn("session-1", Some("key"), &messages, 0)
            .unwrap();
        assert_eq!(replay["status"], "ok");
        assert_eq!(replay["ingestedCount"], 0);
        assert_eq!(
            runtime
                .store()
                .list_messages("session-1", 10)
                .expect("stored messages")
                .len(),
            2
        );
    }

    #[test]
    fn after_turn_enqueues_async_retain_job_and_activity() {
        let dir = tempdir().unwrap();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        config.hindsight.enabled = true;
        config.hindsight.base_url = "http://127.0.0.1:1".to_string();
        config.hindsight.auto_retain = true;
        config.hindsight.retain_every_n_turns = 1;
        let runtime = MemoryRuntime::with_config(dir.path(), config);
        let messages = vec![
            json!({"id": "m1", "role": "user", "content": "remember this preference"}),
            json!({"id": "m2", "role": "assistant", "content": "stored"}),
        ];

        let result = runtime
            .after_turn("session-retain", Some("key"), &messages, 0)
            .unwrap();

        assert_eq!(result["status"], "ok");
        assert_eq!(result["shouldRetain"], true);
        assert_eq!(result["retainStatus"], Value::Null);
        assert_eq!(
            result["diagnostics"]["memory"]["afterTurn"]["outbox"]["status"],
            "pending"
        );
        assert!(
            result["diagnostics"]["memory"]["afterTurn"]["outbox"]["jobId"]
                .as_str()
                .expect("job id")
                .starts_with("memory-job-")
        );

        let jobs = runtime
            .store()
            .list_outbox_jobs(Some("pending"), 10)
            .expect("outbox jobs");
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0]["kind"], "retain_experience");
        assert_eq!(jobs[0]["layer"], "experience");

        let activity = runtime
            .store()
            .list_memory_activity(Some("session-retain"), 10)
            .expect("activity");
        assert!(activity.iter().any(|event| {
            event["kind"] == "after_turn"
                && event["status"] == "enqueued"
                && event["payload"]["jobId"] == jobs[0]["id"]
        }));
    }

    #[test]
    fn after_turn_applies_explicit_memory_directives() {
        let dir = tempdir().unwrap();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        config.hindsight.enabled = true;
        config.hindsight.base_url = "http://127.0.0.1:1".to_string();
        let runtime = MemoryRuntime::with_config(dir.path(), config);
        let messages = vec![
            json!({"id": "m1", "role": "user", "content": "remember this preference"}),
            json!({"id": "m2", "role": "assistant", "content": "stored"}),
        ];

        let remember = runtime
            .after_turn_with_options(
                "session-remember",
                Some("key"),
                &messages,
                0,
                Some(&json!({
                    "action": "remember",
                    "content": "User prefers concise answers"
                })),
            )
            .unwrap();

        assert_eq!(
            remember["diagnostics"]["memory"]["afterTurn"]["directive"]["action"],
            "remember"
        );
        assert_eq!(
            remember["diagnostics"]["memory"]["afterTurn"]["outbox"]["kind"],
            "retain_durable"
        );
        assert_eq!(
            remember["diagnostics"]["memory"]["afterTurn"]["outbox"]["layer"],
            "durable"
        );

        let do_not_remember = runtime
            .after_turn_with_options(
                "session-private",
                Some("key"),
                &messages,
                0,
                Some(&json!({
                    "action": "do-not-remember",
                    "reason": "private turn"
                })),
            )
            .unwrap();
        assert_eq!(do_not_remember["shouldRetain"], false);
        assert_eq!(
            do_not_remember["diagnostics"]["memory"]["afterTurn"]["skipReason"],
            "user_do_not_remember"
        );
        assert_eq!(
            do_not_remember["diagnostics"]["memory"]["afterTurn"]["outbox"]["status"],
            "skipped"
        );

        let forget = runtime
            .after_turn_with_options(
                "session-forget",
                Some("key"),
                &messages,
                0,
                Some(&json!({
                    "action": "forget",
                    "content": "old project codename"
                })),
            )
            .unwrap();
        assert_eq!(
            forget["diagnostics"]["memory"]["afterTurn"]["directive"]["action"],
            "forget"
        );
        assert_eq!(
            forget["diagnostics"]["memory"]["afterTurn"]["outbox"]["kind"],
            "forget_memory"
        );
        assert_eq!(
            forget["diagnostics"]["memory"]["afterTurn"]["outbox"]["status"],
            "pending"
        );
    }

    #[test]
    fn process_outbox_retains_pending_jobs() {
        let dir = tempdir().unwrap();
        let (base_url, request_rx) = start_hindsight_retain_server();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        config.hindsight.enabled = true;
        config.hindsight.base_url = base_url;
        let runtime = MemoryRuntime::with_config(dir.path(), config);
        let messages = vec![
            json!({"id": "m1", "role": "user", "content": "remember this lesson"}),
            json!({"id": "m2", "role": "assistant", "content": "stored"}),
        ];
        runtime
            .after_turn("session-process", Some("key"), &messages, 0)
            .unwrap();

        let result = runtime.process_outbox_once(10).unwrap();

        assert_eq!(result["processedCount"], 1);
        assert_eq!(result["statusCounts"]["completed"], 1);
        let jobs = runtime
            .store()
            .list_outbox_jobs(Some("completed"), 10)
            .unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0]["attempts"], 1);
        let request = request_rx.recv().expect("retain request");
        assert!(request.contains("/v1/default/banks/crawclaw:main:experience/memories"));
        assert!(request.contains("agent_turn"));
    }

    #[test]
    fn process_outbox_retains_long_chinese_content_as_chunked_items() {
        let dir = tempdir().unwrap();
        let (base_url, request_rx) = start_hindsight_retain_server();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        config.hindsight.enabled = true;
        config.hindsight.base_url = base_url;
        config.hindsight.language_hints.primary_language = "zh-CN".to_string();
        let runtime = MemoryRuntime::with_config(dir.path(), config);
        let messages = vec![
            json!({
                "id": "m1",
                "role": "user",
                "content": "用户要求记忆系统保留中文排障过程，包括网关、缓存、数据库和日志分析。".repeat(90),
            }),
            json!({"id": "m2", "role": "assistant", "content": "已记录中文排障过程。"}),
        ];
        runtime
            .after_turn("session-chinese-chunks", Some("key"), &messages, 0)
            .unwrap();

        let result = runtime.process_outbox_once(10).unwrap();

        assert_eq!(result["processedCount"], 1);
        let request = request_rx.recv().expect("retain request");
        let body = http_request_body_json(&request);
        let items = body["items"].as_array().expect("retain items");
        assert!(items.len() > 1);
        assert_eq!(items[0]["metadata"]["language"], "zh-CN");
        assert_eq!(items[0]["metadata"]["chunkIndex"], 0);
        assert_eq!(items[0]["metadata"]["chunkTotal"], items.len());
        assert!(items[0]["content"].as_str().unwrap_or("").ends_with('。'));
    }

    #[test]
    fn process_outbox_records_forget_jobs_as_local_tombstones() {
        let dir = tempdir().unwrap();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        config.hindsight.enabled = true;
        config.hindsight.base_url = "http://127.0.0.1:1".to_string();
        let runtime = MemoryRuntime::with_config(dir.path(), config);
        let messages = vec![
            json!({"id": "m1", "role": "user", "content": "forget the old code name"}),
            json!({"id": "m2", "role": "assistant", "content": "I will not use it"}),
        ];
        runtime
            .after_turn_with_options(
                "session-forget-process",
                Some("key"),
                &messages,
                0,
                Some(&json!({
                    "action": "forget",
                    "content": "old code name"
                })),
            )
            .unwrap();

        let result = runtime.process_outbox_once(10).unwrap();

        assert_eq!(result["processedCount"], 1);
        assert_eq!(result["statusCounts"]["completed_local"], 1);
        let jobs = runtime
            .store()
            .list_outbox_jobs(Some("completed_local"), 10)
            .unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0]["lastError"], Value::Null);
        let tombstones = runtime.store().list_memory_tombstones(10).unwrap();
        assert_eq!(tombstones.len(), 1);
        assert_eq!(tombstones[0]["query"], "old code name");
        assert_eq!(tombstones[0]["reason"], "explicit_forget");
    }

    #[test]
    fn after_turn_detects_tool_use_blocks_for_retain_skip() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let messages = vec![
            json!({"role": "user", "content": "please inspect the file"}),
            json!({
                "role": "assistant",
                "content": "final after tool",
                "blocks": [{
                    "type": "toolUse",
                    "id": "call-read",
                    "name": "read",
                    "input": { "path": "Cargo.toml" }
                }]
            }),
        ];
        let result = runtime
            .after_turn("session-tools", Some("key"), &messages, 0)
            .unwrap();
        assert_eq!(result["status"], "ok");
        assert_eq!(result["shouldRetain"], false);
    }

    #[test]
    fn assemble_works_without_hindsight() {
        let dir = tempdir().unwrap();
        let runtime = MemoryRuntime::new(dir.path());
        let messages = vec![json!({"role": "user", "content": "hello"})];
        let result = runtime
            .assemble("session-1", messages, Some("test query"))
            .unwrap();
        assert_eq!(
            result["diagnostics"]["memoryRecall"]["implementation"],
            "hindsight-native"
        );
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

    #[test]
    fn status_includes_worker_and_hindsight_lifecycle() {
        let dir = tempdir().unwrap();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        config.hindsight.enabled = true;
        config.hindsight.base_url = "http://127.0.0.1:1".to_string();
        config.hindsight.language_hints.primary_language = "zh-CN".to_string();
        config.hindsight.quality.recall_min_score = Some(0.31);
        config.hindsight.quality.recall_rerank_top_k = Some(7);
        let runtime = MemoryRuntime::with_config(dir.path(), config);

        let status = runtime.status().unwrap();

        assert_eq!(status["worker"]["enabled"], true);
        assert_eq!(status["worker"]["lastRunStatus"], "never_run");
        assert_eq!(status["hindsight"]["lifecycle"]["provider"], "hindsight");
        assert_eq!(status["hindsight"]["lifecycle"]["mode"], "local");
        assert_eq!(status["hindsight"]["lifecycle"]["status"], "degraded");
        assert_eq!(status["quality"]["language"], "zh-CN");
        assert_eq!(status["quality"]["recallMinScore"], 0.31);
        assert_eq!(status["quality"]["recallRerankTopK"], 7);
    }

    #[test]
    fn desktop_policy_enables_managed_local_hindsight_lifecycle() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("config")).unwrap();
        std::fs::write(
            dir.path().join("config").join("desktop-memory-policy.json"),
            serde_json::to_vec_pretty(&json!({
                "hindsightEnabled": true,
                "hindsightBaseUrl": "http://127.0.0.1:1",
                "hindsightMode": "local",
                "hindsightManaged": true,
                "hindsightLifecycleStatus": "starting"
            }))
            .unwrap(),
        )
        .unwrap();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        let runtime = MemoryRuntime::with_config(dir.path(), config);

        let status = runtime.status().unwrap();

        assert_eq!(status["config"]["hindsight"]["enabled"], true);
        assert_eq!(
            status["config"]["hindsight"]["baseUrl"],
            "http://127.0.0.1:1"
        );
        assert_eq!(status["worker"]["enabled"], true);
        assert_eq!(status["hindsight"]["lifecycle"]["mode"], "local");
        assert_eq!(status["hindsight"]["lifecycle"]["status"], "starting");
        assert_eq!(
            status["hindsight"]["lifecycle"]["reason"],
            "health_check_pending"
        );
        assert_eq!(status["hindsight"]["lifecycle"]["managed"], true);
    }

    #[test]
    fn desktop_policy_unavailable_managed_hindsight_disables_runtime_config() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("config")).unwrap();
        std::fs::write(
            dir.path().join("config").join("desktop-memory-policy.json"),
            serde_json::to_vec_pretty(&json!({
                "hindsightEnabled": true,
                "hindsightBaseUrl": "http://127.0.0.1:1",
                "hindsightMode": "local",
                "hindsightManaged": true,
                "hindsightLifecycleStatus": "unavailable",
                "hindsightLifecycleReason": "hindsight_embed_cli_only"
            }))
            .unwrap(),
        )
        .unwrap();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        let runtime = MemoryRuntime::with_config(dir.path(), config);

        let status = runtime.status().unwrap();

        assert_eq!(status["config"]["hindsight"]["enabled"], false);
        assert_eq!(
            status["hindsight"]["lifecycle"]["reason"],
            "hindsight_embed_cli_only"
        );
    }

    #[test]
    fn process_outbox_updates_worker_observability() {
        let dir = tempdir().unwrap();
        let (base_url, _request_rx) = start_hindsight_retain_server();
        let mut config = MemoryRuntimeConfig::default();
        config.runtime_store.db_path = dir.path().join("memory.db").to_string_lossy().to_string();
        config.hindsight.enabled = true;
        config.hindsight.base_url = base_url;
        let runtime = MemoryRuntime::with_config(dir.path(), config);
        let messages = vec![
            json!({"id": "m1", "role": "user", "content": "remember this lesson"}),
            json!({"id": "m2", "role": "assistant", "content": "stored"}),
        ];
        runtime
            .after_turn("session-process-worker", Some("key"), &messages, 0)
            .unwrap();

        let result = runtime.process_outbox_once(10).unwrap();

        assert_eq!(result["processedCount"], 1);
        let status = runtime.status().unwrap();
        assert_eq!(status["worker"]["lastRunStatus"], "completed");
        assert_eq!(status["worker"]["lastProcessedCount"], 1);
        assert_eq!(status["worker"]["lastStatusCounts"]["completed"], 1);
    }

    fn start_hindsight_retain_server() -> (String, std::sync::mpsc::Receiver<String>) {
        start_hindsight_response_server(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}",
        )
    }

    fn start_hindsight_response_server(
        response: &'static str,
    ) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("hindsight listener");
        let addr = listener.local_addr().expect("hindsight addr");
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("hindsight request");
            stream
                .set_read_timeout(Some(Duration::from_millis(500)))
                .expect("set read timeout");
            let request = read_http_request(&mut stream);
            request_tx
                .send(String::from_utf8_lossy(&request).to_string())
                .expect("send hindsight request");
            stream
                .write_all(response.as_bytes())
                .expect("write hindsight response");
        });
        (format!("http://{addr}"), request_rx)
    }

    fn http_request_body_json(request: &str) -> Value {
        let body = request.split("\r\n\r\n").nth(1).expect("HTTP request body");
        serde_json::from_str(body).expect("JSON request body")
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    request.extend_from_slice(&buffer[..n]);
                    if request_body_complete(&request) {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break;
                }
                Err(error) => panic!("read hindsight request: {error}"),
            }
        }
        request
    }

    fn request_body_complete(request: &[u8]) -> bool {
        let text = String::from_utf8_lossy(request);
        let Some((headers, body)) = text.split_once("\r\n\r\n") else {
            return false;
        };
        let content_length = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        });
        match content_length {
            Some(length) => body.as_bytes().len() >= length,
            None => true,
        }
    }
}

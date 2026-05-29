use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use chrono_tz::Tz;
use croner::Cron;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::{
    AgentModelSelection, AgentRunProfileKind, AgentRunProfileRequest, AgentRunRequest,
    AgentRuntime, ChannelChatType, ChannelInboundEnvelope, DesktopSessionStore,
};

const STORE_VERSION: u8 = 1;
const MAX_TIMER_DELAY_MS: u64 = 60_000;
const MIN_REFIRE_GAP_MS: u64 = 2_000;
const DEFAULT_RUN_LOG_MAX_BYTES: u64 = 2_000_000;
const DEFAULT_RUN_LOG_KEEP_LINES: usize = 2_000;
const DEFAULT_MAX_TRANSIENT_RETRIES: u32 = 3;
const DEFAULT_BACKOFF_MS: &[u64] = &[30_000, 60_000, 300_000];
const MAX_CLAUDE_CRON_JOBS: usize = 50;

#[derive(Clone)]
pub struct CronServiceOptions {
    pub runtime_root: PathBuf,
    pub store_path: Option<PathBuf>,
    pub enabled: bool,
    pub start_scheduler: bool,
    pub max_concurrent_runs: usize,
    pub on_event: Option<CronEventSink>,
}

impl Default for CronServiceOptions {
    fn default() -> Self {
        Self {
            runtime_root: PathBuf::new(),
            store_path: None,
            enabled: true,
            start_scheduler: false,
            max_concurrent_runs: 1,
            on_event: None,
        }
    }
}

pub type CronEventSink = Arc<dyn Fn(Value) + Send + Sync + 'static>;

#[derive(Clone)]
pub struct CronService {
    inner: Arc<CronServiceInner>,
}

struct CronServiceInner {
    runtime_root: PathBuf,
    store_path: PathBuf,
    enabled: bool,
    max_concurrent_runs: usize,
    store_lock: Mutex<()>,
    running_jobs: Mutex<HashSet<String>>,
    scheduler_started: AtomicBool,
    scheduler_stop_requested: AtomicBool,
    webhook_token: Option<String>,
    run_log_max_bytes: u64,
    run_log_keep_lines: usize,
    on_event: Option<CronEventSink>,
}

#[derive(Clone, Debug)]
struct CronExecutionResult {
    summary: String,
    session_id: Option<String>,
    session_key: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CronStoreFile {
    pub version: u8,
    #[serde(default)]
    pub jobs: Vec<CronJob>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CronJob {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub schedule: CronSchedule,
    #[serde(default = "default_session_target")]
    pub session_target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wake_mode: Option<String>,
    pub payload: CronPayload,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<CronDelivery>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub delete_after_run: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at_ms: Option<u64>,
    #[serde(default)]
    pub state: CronJobState,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CronJobState {
    #[serde(default)]
    pub consecutive_errors: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_delivered: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_delivery_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_delivery_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_failure_alert_at_ms: Option<u64>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CronSchedule {
    #[serde(rename_all = "camelCase")]
    At {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at: Option<String>,
        #[serde(default, rename = "atMs", skip_serializing_if = "Option::is_none")]
        at_ms: Option<Value>,
    },
    #[serde(rename_all = "camelCase")]
    Every {
        every_ms: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor_ms: Option<Value>,
    },
    #[serde(rename_all = "camelCase")]
    Cron {
        expr: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tz: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stagger_ms: Option<Value>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CronPayload {
    #[serde(rename_all = "camelCase")]
    SystemEvent { text: String },
    #[serde(rename_all = "camelCase")]
    AgentTurn {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fallbacks: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thinking: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout_seconds: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        allow_unsafe_external_content: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        light_context: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tools_allow: Option<Vec<String>>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CronDelivery {
    #[serde(default = "default_delivery_mode")]
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default)]
    pub best_effort: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_destination: Option<CronFailureDestination>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CronFailureDestination {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronRunLogEntry {
    pub ts: u64,
    pub job_id: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivered: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

#[derive(Clone, Debug)]
struct CronRuntimeConfig {
    enabled: bool,
    store_path: Option<PathBuf>,
    webhook_token: Option<String>,
    max_concurrent_runs: Option<usize>,
    run_log_max_bytes: u64,
    run_log_keep_lines: usize,
}

impl CronService {
    pub fn new(options: CronServiceOptions) -> Result<Self, String> {
        let active_config = CronRuntimeConfig::load();
        let store_path = options
            .store_path
            .or(active_config.store_path.clone())
            .unwrap_or_else(default_cron_store_path);
        let service = Self {
            inner: Arc::new(CronServiceInner {
                runtime_root: options.runtime_root,
                store_path,
                enabled: options.enabled
                    && active_config.enabled
                    && std::env::var("CRAWCLAW_SKIP_CRON").ok().as_deref() != Some("1"),
                max_concurrent_runs: active_config
                    .max_concurrent_runs
                    .unwrap_or(options.max_concurrent_runs)
                    .max(1),
                store_lock: Mutex::new(()),
                running_jobs: Mutex::new(HashSet::new()),
                scheduler_started: AtomicBool::new(false),
                scheduler_stop_requested: AtomicBool::new(false),
                webhook_token: active_config.webhook_token,
                run_log_max_bytes: active_config.run_log_max_bytes,
                run_log_keep_lines: active_config.run_log_keep_lines,
                on_event: options.on_event,
            }),
        };
        if options.start_scheduler {
            service.start_scheduler();
        }
        Ok(service)
    }

    pub fn store_path(&self) -> &Path {
        &self.inner.store_path
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.enabled
    }

    pub fn start_scheduler(&self) {
        if !self.inner.enabled {
            return;
        }
        if self.inner.scheduler_started.swap(true, Ordering::SeqCst) {
            return;
        }
        self.inner
            .scheduler_stop_requested
            .store(false, Ordering::SeqCst);
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            self.inner.scheduler_started.store(false, Ordering::SeqCst);
            return;
        };
        let service = self.clone();
        handle.spawn(async move {
            service.run_due_jobs().await;
            loop {
                if service
                    .inner
                    .scheduler_stop_requested
                    .load(Ordering::SeqCst)
                {
                    break;
                }
                let delay = service.next_timer_delay();
                tokio::time::sleep(Duration::from_millis(delay)).await;
                if service
                    .inner
                    .scheduler_stop_requested
                    .load(Ordering::SeqCst)
                {
                    break;
                }
                service.run_due_jobs().await;
            }
            service
                .inner
                .scheduler_started
                .store(false, Ordering::SeqCst);
        });
    }

    pub fn stop_scheduler(&self) {
        self.inner
            .scheduler_stop_requested
            .store(true, Ordering::SeqCst);
    }

    pub async fn handle_action(&self, input: Value) -> Result<Value, String> {
        let action = string_field(&input, "action").unwrap_or_else(|| "status".to_string());
        match action.as_str() {
            "status" => self.status(),
            "list" => self.list(include_disabled(&input)),
            "add" => self.add(job_payload_from_action(&input)).await,
            "update" => {
                let id = required_id(&input)?;
                let patch = input
                    .get("patch")
                    .cloned()
                    .unwrap_or_else(|| strip_action_fields(&input));
                self.update(&id, patch).await
            }
            "remove" => {
                let id = required_id(&input)?;
                self.remove(&id).await
            }
            "run" => {
                let id = required_id(&input)?;
                let mode = string_field(&input, "mode").unwrap_or_else(|| "due".to_string());
                self.run(&id, &mode).await
            }
            "runs" => {
                let id = required_id(&input)?;
                self.runs(&id, &input)
            }
            "wake" => {
                let text = string_field(&input, "text")
                    .or_else(|| string_field(&input, "message"))
                    .unwrap_or_else(|| "cron wake".to_string());
                self.wake_now(&text)
            }
            other => Err(format!("unsupported cron action: {other}")),
        }
    }

    pub async fn handle_method(&self, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "wake" => {
                let mut input = object_or_empty(params);
                input.insert("action".to_string(), Value::String("wake".to_string()));
                self.handle_action(Value::Object(input)).await
            }
            "cron.start" => {
                self.start_scheduler();
                self.gateway_status()
            }
            "cron.stop" => {
                self.stop_scheduler();
                self.gateway_status()
            }
            "cron.status" => self.gateway_status(),
            "cron.list" => self.gateway_list(params),
            "cron.add" => {
                let result = self
                    .handle_action(json!({ "action": "add", "job": params }))
                    .await?;
                Ok(result.get("job").cloned().unwrap_or(Value::Null))
            }
            "cron.update" => {
                let mut input = object_or_empty(params);
                input.insert("action".to_string(), Value::String("update".to_string()));
                let result = self.handle_action(Value::Object(input)).await?;
                Ok(result.get("job").cloned().unwrap_or(Value::Null))
            }
            "cron.remove" => {
                let mut input = object_or_empty(params);
                input.insert("action".to_string(), Value::String("remove".to_string()));
                let result = self.handle_action(Value::Object(input)).await?;
                Ok(json!({
                    "ok": true,
                    "removed": result.get("removed").and_then(Value::as_bool).unwrap_or(false)
                }))
            }
            "cron.run" => self.gateway_run(params).await,
            "cron.runs" => self.gateway_runs(params),
            other => Err(format!("unsupported cron method: {other}")),
        }
    }

    fn status(&self) -> Result<Value, String> {
        let store = self.load_store()?;
        Ok(json!({
            "status": "ok",
            "enabled": self.inner.enabled,
            "storePath": self.inner.store_path,
            "jobs": store.jobs.len(),
            "running": self.running_count(),
            "nextRunAtMs": store.jobs.iter().filter_map(job_next_run_at_ms).min()
        }))
    }

    fn gateway_status(&self) -> Result<Value, String> {
        let store = self.load_store()?;
        Ok(json!({
            "enabled": self.inner.enabled,
            "storePath": self.inner.store_path,
            "jobs": store.jobs.len(),
            "nextWakeAtMs": if self.inner.enabled {
                store.jobs.iter().filter_map(job_next_run_at_ms).min()
            } else {
                None
            }
        }))
    }

    fn list(&self, include_disabled: bool) -> Result<Value, String> {
        let mut jobs = self.load_store()?.jobs;
        if !include_disabled {
            jobs.retain(|job| job.enabled);
        }
        sort_jobs(&mut jobs, "nextRunAtMs", "asc");
        Ok(json!({
            "status": "ok",
            "jobs": jobs
        }))
    }

    fn gateway_list(&self, params: Value) -> Result<Value, String> {
        let input = object_or_empty(params);
        let mut jobs = self.load_store()?.jobs;
        match string_from_map(&input, "enabled").as_deref() {
            Some("all") => {}
            Some("disabled") => jobs.retain(|job| !job.enabled),
            _ if input
                .get("includeDisabled")
                .and_then(Value::as_bool)
                .unwrap_or(false) => {}
            _ => jobs.retain(|job| job.enabled),
        }
        if let Some(query) = string_from_map(&input, "query").map(|value| value.to_lowercase()) {
            jobs.retain(|job| {
                [
                    job.name.as_str(),
                    job.description.as_deref().unwrap_or(""),
                    job.agent_id.as_deref().unwrap_or(""),
                    job.id.as_str(),
                ]
                .join(" ")
                .to_lowercase()
                .contains(&query)
            });
        }
        let sort_by = string_from_map(&input, "sortBy").unwrap_or_else(|| "nextRunAtMs".into());
        let sort_dir = string_from_map(&input, "sortDir").unwrap_or_else(|| "asc".into());
        sort_jobs(&mut jobs, &sort_by, &sort_dir);
        let total = jobs.len();
        let offset = input
            .get("offset")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(total as u64) as usize;
        let limit = input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(total.max(50) as u64)
            .clamp(1, 200) as usize;
        let page = jobs
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect::<Vec<_>>();
        let next_offset = offset + page.len();
        Ok(json!({
            "jobs": page,
            "total": total,
            "offset": offset,
            "limit": limit,
            "hasMore": next_offset < total,
            "nextOffset": if next_offset < total { Some(next_offset) } else { None }
        }))
    }

    async fn add(&self, input: Value) -> Result<Value, String> {
        let now = now_millis();
        let mut job = normalize_job(input, now)?;
        job.state.next_run_at_ms = if job.enabled {
            compute_next_run_at_ms(&job.schedule, now, &job.id)
        } else {
            None
        };
        if job.created_at_ms.is_none() {
            job.created_at_ms = Some(now);
        }
        job.updated_at_ms = Some(now);
        let mut store = self.load_store()?;
        if store.jobs.iter().any(|existing| existing.id == job.id) {
            return Err(format!("cron job already exists: {}", job.id));
        }
        store.jobs.push(job.clone());
        self.save_store(&store, false)?;
        Ok(json!({ "status": "ok", "job": job }))
    }

    async fn update(&self, id: &str, patch: Value) -> Result<Value, String> {
        let now = now_millis();
        let mut store = self.load_store()?;
        let job = store
            .jobs
            .iter_mut()
            .find(|job| job.id == id)
            .ok_or_else(|| format!("unknown cron job: {id}"))?;
        apply_patch_to_job(job, patch)?;
        job.updated_at_ms = Some(now);
        job.state.next_run_at_ms = if job.enabled {
            compute_next_run_at_ms(&job.schedule, now, &job.id)
        } else {
            None
        };
        let updated = job.clone();
        self.save_store(&store, false)?;
        Ok(json!({ "status": "ok", "job": updated }))
    }

    async fn remove(&self, id: &str) -> Result<Value, String> {
        let mut store = self.load_store()?;
        let before = store.jobs.len();
        store.jobs.retain(|job| job.id != id);
        let removed = before != store.jobs.len();
        self.save_store(&store, false)?;
        Ok(json!({ "status": "ok", "removed": removed, "id": id }))
    }

    async fn run(&self, id: &str, mode: &str) -> Result<Value, String> {
        let now = now_millis();
        let Some(job) = self.load_store()?.jobs.into_iter().find(|job| job.id == id) else {
            return Err(format!("unknown cron job: {id}"));
        };
        if !job.enabled {
            return Ok(json!({
                "status": "skipped",
                "jobId": id,
                "reason": "disabled"
            }));
        }
        if mode != "force"
            && job
                .state
                .next_run_at_ms
                .map(|due| due > now)
                .unwrap_or(true)
        {
            return Ok(json!({
                "status": "skipped",
                "jobId": id,
                "reason": "not_due",
                "nextRunAtMs": job.state.next_run_at_ms
            }));
        }
        self.execute_job(job).await
    }

    fn runs(&self, id: &str, input: &Value) -> Result<Value, String> {
        let limit = input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(50)
            .min(500) as usize;
        let status_filter = string_field(input, "status").unwrap_or_else(|| "all".to_string());
        let mut entries = read_run_log(&run_log_path(&self.inner.store_path, id)?, limit)?;
        if status_filter != "all" {
            entries.retain(|entry| entry.status.as_deref() == Some(status_filter.as_str()));
        }
        Ok(json!({ "status": "ok", "jobId": id, "runs": entries }))
    }

    async fn gateway_run(&self, params: Value) -> Result<Value, String> {
        let input = object_or_empty(params);
        let id = string_from_map(&input, "id")
            .or_else(|| string_from_map(&input, "jobId"))
            .ok_or_else(|| "cron job id is required".to_string())?;
        let mode = string_from_map(&input, "mode").unwrap_or_else(|| "force".to_string());
        let now = now_millis();
        let Some(job) = self.load_store()?.jobs.into_iter().find(|job| job.id == id) else {
            return Err(format!("unknown cron job: {id}"));
        };
        if !job.enabled {
            return Ok(json!({ "status": "ok", "ok": true, "ran": false, "reason": "disabled" }));
        }
        if mode != "force"
            && job
                .state
                .next_run_at_ms
                .map(|due| due > now)
                .unwrap_or(true)
        {
            return Ok(json!({ "status": "ok", "ok": true, "ran": false, "reason": "not-due" }));
        }
        if !self.try_mark_running(&job.id)? {
            return Ok(
                json!({ "status": "ok", "ok": true, "ran": false, "reason": "already-running" }),
            );
        }
        let run_id = format!("manual:{}:{now}", job.id);
        let service = self.clone();
        let run_id_for_task = run_id.clone();
        tokio::spawn(async move {
            let _ = service.execute_marked_job(job, run_id_for_task).await;
        });
        Ok(json!({ "status": "ok", "ok": true, "enqueued": true, "runId": run_id }))
    }

    fn gateway_runs(&self, params: Value) -> Result<Value, String> {
        let input = object_or_empty(params);
        let scope = string_from_map(&input, "scope");
        let job_id = string_from_map(&input, "id").or_else(|| string_from_map(&input, "jobId"));
        let scope = scope
            .as_deref()
            .unwrap_or(if job_id.is_some() { "job" } else { "all" });
        let mut entries = if scope == "all" {
            read_all_run_logs(&self.inner.store_path)?
        } else {
            let id = job_id.ok_or_else(|| "cron.runs job id is required".to_string())?;
            read_run_log(&run_log_path(&self.inner.store_path, &id)?, usize::MAX)?
        };
        filter_run_log_entries(&mut entries, &input);
        let sort_desc = string_from_map(&input, "sortDir").as_deref() != Some("asc");
        if sort_desc {
            entries.sort_by_key(|entry| std::cmp::Reverse(entry.ts));
        } else {
            entries.sort_by_key(|entry| entry.ts);
        }
        let total = entries.len();
        let offset = input
            .get("offset")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(total as u64) as usize;
        let limit = input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(50)
            .clamp(1, 200) as usize;
        let page = entries
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect::<Vec<_>>();
        let next_offset = offset + page.len();
        Ok(json!({
            "entries": page,
            "total": total,
            "offset": offset,
            "limit": limit,
            "hasMore": next_offset < total,
            "nextOffset": if next_offset < total { Some(next_offset) } else { None }
        }))
    }

    fn wake_now(&self, text: &str) -> Result<Value, String> {
        DesktopSessionStore::new(self.inner.runtime_root.clone())
            .append_message("main", "system", text, Some("cron"))
            .map_err(|error| error.to_string())?;
        Ok(json!({ "status": "ok", "mode": "now" }))
    }

    async fn execute_job(&self, job: CronJob) -> Result<Value, String> {
        if !self.try_mark_running(&job.id)? {
            return Ok(json!({
                "status": "skipped",
                "jobId": job.id,
                "reason": "running"
            }));
        }

        let started_at = now_millis();
        let run_id = format!("cron:{}:{started_at}", job.id);
        self.execute_marked_job(job, run_id).await
    }

    async fn execute_marked_job(&self, job: CronJob, run_id: String) -> Result<Value, String> {
        let started_at = now_millis();
        self.emit_event(json!({
            "jobId": job.id,
            "action": "started",
            "runId": run_id,
            "ts": started_at
        }));
        let result = self.execute_job_core(&job, &run_id).await;
        let ended_at = now_millis();
        self.clear_running(&job.id);
        let delivery_status = match &result {
            Ok(execution) => {
                self.deliver_webhook_if_requested(&job, &execution.summary)
                    .await
            }
            Err(_) => resolve_delivery_status(&job, false),
        };

        let mut store = self.load_store()?;
        let mut next_run_at_ms = None;
        if let Some(stored) = store.jobs.iter_mut().find(|stored| stored.id == job.id) {
            let mut state = stored.state.clone();
            state.running_at_ms = None;
            state.last_run_at_ms = Some(started_at);
            state.last_duration_ms = Some(ended_at.saturating_sub(started_at));
            stored.updated_at_ms = Some(ended_at);
            match &result {
                Ok(execution) => {
                    state.last_run_status = Some("ok".to_string());
                    state.last_status = Some("ok".to_string());
                    state.last_error = None;
                    state.consecutive_errors = 0;
                    state.next_run_at_ms = compute_next_run_after_completion(
                        stored,
                        ended_at.max(started_at + MIN_REFIRE_GAP_MS),
                    );
                    state.last_delivery_status = Some(delivery_status.clone());
                    if stored.delete_after_run || state.next_run_at_ms.is_none() {
                        stored.enabled = false;
                    }
                    next_run_at_ms = state.next_run_at_ms;
                    self.deliver_webhook_if_requested(stored, &execution.summary)
                        .await;
                }
                Err(error) => {
                    state.last_run_status = Some("error".to_string());
                    state.last_status = Some("error".to_string());
                    state.last_error = Some(error.clone());
                    state.consecutive_errors = state.consecutive_errors.saturating_add(1);
                    if is_transient_error(error)
                        && state.consecutive_errors <= DEFAULT_MAX_TRANSIENT_RETRIES
                    {
                        state.next_run_at_ms =
                            Some(ended_at + retry_backoff_ms(state.consecutive_errors));
                    } else {
                        state.next_run_at_ms = compute_next_run_after_completion(
                            stored,
                            ended_at.max(started_at + MIN_REFIRE_GAP_MS),
                        );
                        if stored.delete_after_run || state.next_run_at_ms.is_none() {
                            stored.enabled = false;
                        }
                    }
                    next_run_at_ms = state.next_run_at_ms;
                }
            }
            stored.state = state;
        }
        store
            .jobs
            .retain(|job| !job.delete_after_run || job.enabled);
        self.save_store(&store, true)?;

        let status = if result.is_ok() { "ok" } else { "error" };
        let entry = CronRunLogEntry {
            ts: ended_at,
            job_id: job.id.clone(),
            action: "finished".to_string(),
            status: Some(status.to_string()),
            summary: result
                .as_ref()
                .ok()
                .map(|execution| execution.summary.clone()),
            error: result.as_ref().err().cloned(),
            delivered: None,
            delivery_status: Some(delivery_status),
            delivery_error: None,
            session_id: result
                .as_ref()
                .ok()
                .and_then(|execution| execution.session_id.clone()),
            session_key: result
                .as_ref()
                .ok()
                .and_then(|execution| execution.session_key.clone())
                .or_else(|| job.session_key.clone()),
            run_at_ms: Some(started_at),
            duration_ms: Some(ended_at.saturating_sub(started_at)),
            next_run_at_ms,
            run_id: Some(run_id.clone()),
        };
        append_run_log(
            &self.inner.store_path,
            &entry,
            self.inner.run_log_max_bytes,
            self.inner.run_log_keep_lines,
        )?;
        self.emit_event(json!({
            "jobId": job.id,
            "action": "finished",
            "runId": run_id,
            "status": status,
            "summary": entry.summary,
            "error": entry.error,
            "sessionId": entry.session_id,
            "sessionKey": entry.session_key,
            "deliveryStatus": entry.delivery_status,
            "nextRunAtMs": next_run_at_ms,
            "ts": ended_at
        }));

        Ok(json!({
            "status": status,
            "runId": run_id,
            "jobId": job.id,
            "summary": entry.summary,
            "error": entry.error,
            "sessionId": entry.session_id,
            "sessionKey": entry.session_key,
            "nextRunAtMs": next_run_at_ms
        }))
    }

    async fn execute_job_core(
        &self,
        job: &CronJob,
        run_id: &str,
    ) -> Result<CronExecutionResult, String> {
        match (&job.session_target[..], &job.payload) {
            ("main", CronPayload::SystemEvent { text }) => {
                let session_key = job.session_key.as_deref().unwrap_or("main");
                DesktopSessionStore::new(self.inner.runtime_root.clone())
                    .append_message(session_key, "system", text, Some("cron"))
                    .map_err(|error| format!("{error:?}"))?;
                Ok(CronExecutionResult {
                    summary: format!("Queued system event for session {session_key}."),
                    session_id: Some(session_key.to_string()),
                    session_key: Some(session_key.to_string()),
                })
            }
            (
                _,
                CronPayload::AgentTurn {
                    message,
                    model,
                    thinking,
                    tools_allow,
                    ..
                },
            ) => {
                let session_key = resolve_agent_session_key(job);
                let (provider, model_id) = resolve_cron_agent_model(model.as_deref());
                let result = AgentRuntime::new(self.inner.runtime_root.clone())
                    .run_turn(AgentRunRequest {
                        run_id: run_id.to_string(),
                        agent_id: job.agent_id.clone().unwrap_or_else(|| "main".to_string()),
                        session_key: session_key.clone(),
                        inbound: ChannelInboundEnvelope {
                            channel: "cron".to_string(),
                            account_id: Some("local".to_string()),
                            from: "cron".to_string(),
                            to: format!("agent:{}", job.agent_id.as_deref().unwrap_or("main")),
                            chat_type: ChannelChatType::Direct,
                            body: message.clone(),
                            raw_body: Some(message.clone()),
                            message_id: Some(format!("{run_id}:input")),
                            thread_id: Some(session_key.clone()),
                            media_urls: Vec::new(),
                            metadata: BTreeMap::new(),
                        },
                        model: AgentModelSelection {
                            provider,
                            model: model_id,
                            reasoning_level: thinking.clone(),
                        },
                        enabled_tools: tools_allow.clone().unwrap_or_default(),
                        profile: Some(AgentRunProfileRequest {
                            kind: AgentRunProfileKind::Normal,
                            special_agent: None,
                            memory_after_turn: Some(true),
                        }),
                        options: BTreeMap::new(),
                    })
                    .await
                    .map_err(|error| error.message().to_string())?;
                Ok(CronExecutionResult {
                    summary: format!(
                        "Agent turn completed for session {}: {}",
                        result.session_key, result.assistant_text
                    ),
                    session_id: Some(result.session_key.clone()),
                    session_key: Some(session_key),
                })
            }
            (target, CronPayload::SystemEvent { .. }) => Err(format!(
                "cron target {target} requires payload.kind=\"agentTurn\""
            )),
        }
    }

    async fn deliver_webhook_if_requested(&self, job: &CronJob, summary: &str) -> String {
        let Some(delivery) = &job.delivery else {
            return "not-requested".to_string();
        };
        if delivery.mode != "webhook" {
            return "unknown".to_string();
        }
        let Some(url) = delivery.to.as_deref().filter(|url| is_http_url(url)) else {
            return "not-delivered".to_string();
        };
        let mut request = reqwest::Client::new().post(url).json(&json!({
            "jobId": job.id,
            "jobName": job.name,
            "summary": summary,
            "status": "ok"
        }));
        if let Some(token) = &self.inner.webhook_token {
            request = request.bearer_auth(token);
        }
        match request.send().await {
            Ok(response) if response.status().is_success() => "delivered".to_string(),
            Ok(_) | Err(_) => "not-delivered".to_string(),
        }
    }

    async fn run_due_jobs(&self) {
        if !self.inner.enabled {
            return;
        }
        let now = now_millis();
        let due_jobs = self
            .load_store()
            .map(|store| {
                store
                    .jobs
                    .into_iter()
                    .filter(|job| {
                        job.enabled
                            && job
                                .state
                                .next_run_at_ms
                                .map(|due| due <= now)
                                .unwrap_or(false)
                    })
                    .take(self.inner.max_concurrent_runs)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for job in due_jobs {
            let _ = self.execute_job(job).await;
        }
    }

    fn next_timer_delay(&self) -> u64 {
        let now = now_millis();
        self.load_store()
            .ok()
            .and_then(|store| {
                store
                    .jobs
                    .into_iter()
                    .filter(|job| job.enabled)
                    .filter_map(|job| job.state.next_run_at_ms)
                    .min()
            })
            .map(|next| next.saturating_sub(now).clamp(1, MAX_TIMER_DELAY_MS))
            .unwrap_or(MAX_TIMER_DELAY_MS)
    }

    fn load_store(&self) -> Result<CronStoreFile, String> {
        let _guard = self
            .inner
            .store_lock
            .lock()
            .map_err(|_| "cron store lock poisoned")?;
        load_store_unlocked(&self.inner.store_path)
    }

    fn save_store(&self, store: &CronStoreFile, runtime_only: bool) -> Result<(), String> {
        let _guard = self
            .inner
            .store_lock
            .lock()
            .map_err(|_| "cron store lock poisoned")?;
        save_store_unlocked(&self.inner.store_path, store, runtime_only)
    }

    fn try_mark_running(&self, job_id: &str) -> Result<bool, String> {
        let mut running = self
            .inner
            .running_jobs
            .lock()
            .map_err(|_| "cron running set lock poisoned")?;
        if running.contains(job_id) {
            return Ok(false);
        }
        running.insert(job_id.to_string());
        Ok(true)
    }

    fn clear_running(&self, job_id: &str) {
        if let Ok(mut running) = self.inner.running_jobs.lock() {
            running.remove(job_id);
        }
    }

    fn running_count(&self) -> usize {
        self.inner
            .running_jobs
            .lock()
            .map(|running| running.len())
            .unwrap_or(0)
    }

    fn emit_event(&self, payload: Value) {
        if let Some(on_event) = &self.inner.on_event {
            on_event(payload);
        }
    }
}

impl Default for CronJobState {
    fn default() -> Self {
        Self {
            consecutive_errors: 0,
            last_error: None,
            last_error_reason: None,
            next_run_at_ms: None,
            running_at_ms: None,
            last_run_at_ms: None,
            last_run_status: None,
            last_status: None,
            last_duration_ms: None,
            last_delivered: None,
            last_delivery_status: None,
            last_delivery_error: None,
            last_failure_alert_at_ms: None,
            extra: Map::new(),
        }
    }
}

pub struct CronTool {
    runtime_root: PathBuf,
}

#[derive(Clone, Copy)]
pub enum ClaudeCronToolKind {
    Create,
    Delete,
    List,
}

pub struct ClaudeCronTool {
    runtime_root: PathBuf,
    kind: ClaudeCronToolKind,
}

pub struct RemoteTriggerTool {
    runtime_root: PathBuf,
}

impl CronTool {
    pub fn new(runtime_root: &Path) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
        }
    }
}

impl ClaudeCronTool {
    pub fn new(runtime_root: &Path, kind: ClaudeCronToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

impl RemoteTriggerTool {
    pub fn new(runtime_root: &Path) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
        }
    }
}

impl ClaudeCronToolKind {
    fn name(self) -> &'static str {
        match self {
            Self::Create => "CronCreate",
            Self::Delete => "CronDelete",
            Self::List => "CronList",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Create => "Schedule a prompt to run at a future time within this Claude session — either recurring on a cron schedule, or once at a specific time.",
            Self::Delete => "Cancel a scheduled cron job by ID",
            Self::List => "List scheduled cron jobs",
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::Create => json!({
                "type": "object",
                "properties": {
                    "cron": {
                        "type": "string",
                        "description": "Standard 5-field cron expression in local time: \"M H DoM Mon DoW\" (e.g. \"*/5 * * * *\" = every 5 minutes, \"30 14 28 2 *\" = Feb 28 at 2:30pm local once)."
                    },
                    "prompt": {
                        "type": "string",
                        "description": "The prompt to enqueue at each fire time."
                    },
                    "recurring": {
                        "type": "boolean",
                        "description": "true (default) = fire on every cron match until deleted. false = fire once at the next match, then auto-delete. Use false for \"remind me at X\" one-shot requests with pinned minute/hour/dom/month."
                    },
                    "durable": {
                        "type": "boolean",
                        "description": "true = mark the job as durable runtime metadata. false (default) = mark it as non-durable runtime metadata. Use true only when the user asks the task to survive across sessions."
                    }
                },
                "required": ["cron", "prompt"],
                "additionalProperties": false
            }),
            Self::Delete => json!({
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "Job ID returned by CronCreate."
                    }
                },
                "required": ["id"],
                "additionalProperties": false
            }),
            Self::List => json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        }
    }
}

fn claude_cron_schedule_string(schedule: &CronSchedule) -> String {
    match schedule {
        CronSchedule::Cron { expr, .. } => expr.clone(),
        CronSchedule::At { at, at_ms } => at
            .clone()
            .or_else(|| at_ms.as_ref().map(Value::to_string))
            .map(|value| format!("at:{value}"))
            .unwrap_or_else(|| "at".to_string()),
        CronSchedule::Every { every_ms, .. } => format!("every:{}", every_ms),
    }
}

fn claude_cron_human_schedule(schedule: &CronSchedule) -> String {
    match schedule {
        CronSchedule::Cron { expr, .. } => expr.clone(),
        CronSchedule::At { at, at_ms } => at
            .clone()
            .or_else(|| at_ms.as_ref().map(Value::to_string))
            .map(|value| format!("At {value}"))
            .unwrap_or_else(|| "At scheduled time".to_string()),
        CronSchedule::Every { every_ms, .. } => format!("Every {every_ms}ms"),
    }
}

fn claude_cron_prompt(job: &CronJob) -> String {
    match &job.payload {
        CronPayload::SystemEvent { text } => text.clone(),
        CronPayload::AgentTurn { message, .. } => message.clone(),
    }
}

fn claude_cron_job(job: &CronJob) -> Value {
    let recurring = !job.delete_after_run;
    let durable = job
        .extra
        .get("durable")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut details = Map::new();
    details.insert("id".to_string(), Value::String(job.id.clone()));
    details.insert(
        "cron".to_string(),
        Value::String(claude_cron_schedule_string(&job.schedule)),
    );
    details.insert(
        "humanSchedule".to_string(),
        Value::String(claude_cron_human_schedule(&job.schedule)),
    );
    details.insert("prompt".to_string(), Value::String(claude_cron_prompt(job)));
    if recurring {
        details.insert("recurring".to_string(), Value::Bool(true));
    }
    if !durable {
        details.insert("durable".to_string(), Value::Bool(false));
    }
    Value::Object(details)
}

fn claude_cron_job_from_result(result: &Value) -> Option<CronJob> {
    result
        .get("job")
        .cloned()
        .and_then(|value| serde_json::from_value::<CronJob>(value).ok())
}

fn claude_cron_create_details(job: &CronJob) -> Value {
    json!({
        "id": job.id,
        "humanSchedule": claude_cron_human_schedule(&job.schedule),
        "recurring": !job.delete_after_run,
        "durable": job.extra.get("durable").and_then(Value::as_bool).unwrap_or(true)
    })
}

fn claude_cron_create_message(details: &Value) -> String {
    let id = details
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let human_schedule = details
        .get("humanSchedule")
        .and_then(Value::as_str)
        .unwrap_or("scheduled time");
    let where_text = if details
        .get("durable")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        "Persisted to CrawClaw cron store"
    } else {
        "Stored in CrawClaw cron store with durable=false metadata"
    };
    if details
        .get("recurring")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        format!(
            "Scheduled recurring job {id} ({human_schedule}). {where_text}. Use CronDelete to cancel."
        )
    } else {
        format!(
            "Scheduled one-shot task {id} ({human_schedule}). {where_text}. It will fire once then auto-delete."
        )
    }
}

fn claude_cron_list_details(result: &Value) -> Value {
    let jobs = result
        .get("jobs")
        .and_then(Value::as_array)
        .map(|jobs| {
            jobs.iter()
                .filter_map(|job| serde_json::from_value::<CronJob>(job.clone()).ok())
                .map(|job| claude_cron_job(&job))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({ "jobs": jobs })
}

fn claude_cron_list_message(details: &Value) -> String {
    let jobs = details
        .get("jobs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if jobs.is_empty() {
        return "No scheduled jobs.".to_string();
    }
    jobs.iter()
        .map(|job| {
            let id = job.get("id").and_then(Value::as_str).unwrap_or("unknown");
            let human_schedule = job
                .get("humanSchedule")
                .and_then(Value::as_str)
                .unwrap_or("scheduled time");
            let recurring = if job
                .get("recurring")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                "recurring"
            } else {
                "one-shot"
            };
            let durable_suffix = if job.get("durable").and_then(Value::as_bool).unwrap_or(true) {
                ""
            } else {
                " [durable=false]"
            };
            let prompt = job
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(80)
                .collect::<String>();
            format!("{id} - {human_schedule} ({recurring}){durable_suffix}: {prompt}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn validate_claude_cron_expression(expr: &str, tz: &str) -> Result<(), String> {
    if !is_claude_cron_expression(expr) || Cron::from_str(expr).is_err() {
        return Err(format!(
            "Invalid cron expression '{expr}'. Expected 5 fields: M H DoM Mon DoW."
        ));
    }
    let schedule = CronSchedule::Cron {
        expr: expr.to_string(),
        tz: Some(tz.to_string()),
        stagger_ms: None,
    };
    if compute_next_run_at_ms(&schedule, now_millis(), "claude-cron-validation").is_none() {
        return Err(format!(
            "Cron expression '{expr}' does not match any calendar date in the next year."
        ));
    }
    Ok(())
}

fn is_claude_cron_expression(expr: &str) -> bool {
    let parts = expr.split_whitespace().collect::<Vec<_>>();
    parts.len() == 5
        && validate_claude_cron_field(parts[0], 0, 59, false)
        && validate_claude_cron_field(parts[1], 0, 23, false)
        && validate_claude_cron_field(parts[2], 1, 31, false)
        && validate_claude_cron_field(parts[3], 1, 12, false)
        && validate_claude_cron_field(parts[4], 0, 6, true)
}

fn validate_claude_cron_field(field: &str, min: u32, max: u32, allow_dow_seven: bool) -> bool {
    if field.is_empty() {
        return false;
    }
    field
        .split(',')
        .all(|part| validate_claude_cron_part(part, min, max, allow_dow_seven))
}

fn validate_claude_cron_part(part: &str, min: u32, max: u32, allow_dow_seven: bool) -> bool {
    if part == "*" {
        return true;
    }
    if let Some(step) = part.strip_prefix("*/") {
        return parse_positive_cron_step(step).is_some();
    }
    let (range_part, step) = part
        .split_once('/')
        .map(|(range, step)| (range, Some(step)))
        .unwrap_or((part, None));
    if let Some(step) = step {
        if parse_positive_cron_step(step).is_none() {
            return false;
        }
    }
    if let Some((left, right)) = range_part.split_once('-') {
        let Some(left) = parse_cron_field_number(left) else {
            return false;
        };
        let Some(right) = parse_cron_field_number(right) else {
            return false;
        };
        let effective_max = if allow_dow_seven { 7 } else { max };
        return left <= right && left >= min && right <= effective_max;
    }
    let Some(value) = parse_cron_field_number(range_part) else {
        return false;
    };
    value >= min && (value <= max || (allow_dow_seven && value == 7))
}

fn parse_cron_field_number(value: &str) -> Option<u32> {
    (!value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
        .then(|| value.parse::<u32>().ok())
        .flatten()
}

fn parse_positive_cron_step(value: &str) -> Option<u32> {
    parse_cron_field_number(value).filter(|step| *step > 0)
}

#[async_trait]
impl pi::sdk::Tool for CronTool {
    fn name(&self) -> &str {
        "cron"
    }

    fn label(&self) -> &str {
        "cron"
    }

    fn description(&self) -> &str {
        "Manage Rust-native CrawClaw cron jobs and wake scheduled agent sessions."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["status", "list", "add", "update", "remove", "run", "runs", "wake"]
                },
                "id": { "type": "string" },
                "jobId": { "type": "string" },
                "job": { "type": "object", "additionalProperties": true },
                "patch": { "type": "object", "additionalProperties": true },
                "mode": { "type": "string", "enum": ["due", "force", "now"] },
                "includeDisabled": { "type": "boolean" },
                "text": { "type": "string" },
                "message": { "type": "string" }
            },
            "required": ["action"],
            "additionalProperties": true
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let service = CronService::new(CronServiceOptions {
            runtime_root: self.runtime_root.clone(),
            start_scheduler: false,
            ..CronServiceOptions::default()
        })
        .map_err(|error| pi::sdk::Error::tool("cron", error))?;
        let result = service
            .handle_action(input)
            .await
            .map_err(|error| pi::sdk::Error::tool("cron", error))?;
        Ok(pi::sdk::ToolOutput {
            content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string()),
            ))],
            details: Some(result),
            is_error: false,
        })
    }
}

#[async_trait]
impl pi::sdk::Tool for ClaudeCronTool {
    fn name(&self) -> &str {
        self.kind.name()
    }

    fn label(&self) -> &str {
        self.kind.name()
    }

    fn description(&self) -> &str {
        self.kind.description()
    }

    fn parameters(&self) -> Value {
        self.kind.parameters()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let service = CronService::new(CronServiceOptions {
            runtime_root: self.runtime_root.clone(),
            start_scheduler: false,
            ..CronServiceOptions::default()
        })
        .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))?;
        let (content, details) = match self.kind {
            ClaudeCronToolKind::Create => {
                require_claude_cron_keys(
                    &input,
                    &["cron", "prompt", "recurring", "durable"],
                    self.kind.name(),
                )?;
                let cron = string_field(&input, "cron")
                    .ok_or_else(|| pi::sdk::Error::validation("cron is required"))?;
                let prompt = string_field(&input, "prompt")
                    .ok_or_else(|| pi::sdk::Error::validation("prompt is required"))?;
                let recurring = semantic_bool_field(&input, "recurring")
                    .map_err(pi::sdk::Error::validation)?
                    .unwrap_or(true);
                let durable = semantic_bool_field(&input, "durable")
                    .map_err(pi::sdk::Error::validation)?
                    .unwrap_or(false);
                let name = "Cron job".to_string();
                let timezone = std::env::var("TZ").unwrap_or_else(|_| "UTC".to_string());
                validate_claude_cron_expression(&cron, &timezone)
                    .map_err(pi::sdk::Error::validation)?;
                let existing_jobs = service
                    .handle_action(json!({
                        "action": "list",
                        "includeDisabled": true
                    }))
                    .await
                    .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))?
                    .get("jobs")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0);
                if existing_jobs >= MAX_CLAUDE_CRON_JOBS {
                    return Err(pi::sdk::Error::validation(format!(
                        "Too many scheduled jobs (max {MAX_CLAUDE_CRON_JOBS}). Cancel one first."
                    )));
                }
                let result = service
                    .handle_action(json!({
                        "action": "add",
                        "name": name,
                        "durable": durable,
                        "schedule": {
                            "kind": "cron",
                            "expr": cron,
                            "tz": timezone
                        },
                        "text": prompt,
                        "deleteAfterRun": !recurring
                    }))
                    .await
                    .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))?;
                let job = claude_cron_job_from_result(&result).ok_or_else(|| {
                    pi::sdk::Error::tool(self.kind.name(), "CronCreate returned no job")
                })?;
                let details = claude_cron_create_details(&job);
                (claude_cron_create_message(&details), details)
            }
            ClaudeCronToolKind::Delete => {
                require_claude_cron_keys(&input, &["id"], self.kind.name())?;
                let id = string_field(&input, "id")
                    .ok_or_else(|| pi::sdk::Error::validation("id is required"))?;
                service
                    .handle_action(json!({
                        "action": "remove",
                        "id": id
                    }))
                    .await
                    .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))
                    .and_then(|result| {
                        if result
                            .get("removed")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                        {
                            Ok(result)
                        } else {
                            Err(pi::sdk::Error::validation(format!(
                                "No scheduled job with id '{id}'"
                            )))
                        }
                    })?;
                let details = json!({ "id": id });
                (format!("Cancelled job {id}."), details)
            }
            ClaudeCronToolKind::List => {
                require_claude_cron_keys(&input, &[], self.kind.name())?;
                let result = service
                    .handle_action(json!({
                        "action": "list"
                    }))
                    .await
                    .map_err(|error| pi::sdk::Error::tool(self.kind.name(), error))?;
                let details = claude_cron_list_details(&result);
                (claude_cron_list_message(&details), details)
            }
        };
        Ok(pi::sdk::ToolOutput {
            content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                content,
            ))],
            details: Some(details),
            is_error: false,
        })
    }

    fn is_read_only(&self) -> bool {
        matches!(self.kind, ClaudeCronToolKind::List)
    }
}

#[async_trait]
impl pi::sdk::Tool for RemoteTriggerTool {
    fn name(&self) -> &str {
        "RemoteTrigger"
    }

    fn label(&self) -> &str {
        "RemoteTrigger"
    }

    fn description(&self) -> &str {
        "Manage scheduled runtime agent triggers through the CrawClaw cron store."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "get", "create", "update", "run"]
                },
                "trigger_id": {
                    "type": "string",
                    "pattern": "^[\\w-]+$",
                    "description": "Required for get, update, and run"
                },
                "body": {
                    "type": "object",
                    "description": "JSON body for create and update"
                }
            },
            "required": ["action"],
            "additionalProperties": false
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let service = CronService::new(CronServiceOptions {
            runtime_root: self.runtime_root.clone(),
            start_scheduler: false,
            ..CronServiceOptions::default()
        })
        .map_err(|error| pi::sdk::Error::tool("RemoteTrigger", error))?;
        let result = run_remote_trigger_action(&service, input)
            .await
            .map_err(|error| pi::sdk::Error::tool("RemoteTrigger", error))?;
        let status = result.get("status").and_then(Value::as_u64).unwrap_or(200);
        let body = result.get("json").and_then(Value::as_str).unwrap_or("{}");
        Ok(pi::sdk::ToolOutput {
            content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                format!("HTTP {status}\n{body}"),
            ))],
            details: Some(result),
            is_error: false,
        })
    }

    fn is_read_only(&self) -> bool {
        false
    }
}

async fn run_remote_trigger_action(service: &CronService, input: Value) -> Result<Value, String> {
    require_remote_trigger_keys(&input, &["action", "trigger_id", "body"])?;
    let action = string_field(&input, "action").ok_or_else(|| {
        "RemoteTrigger requires action: list, get, create, update, or run".to_string()
    })?;
    match action.as_str() {
        "list" => remote_trigger_service_response(
            200,
            service
                .handle_action(json!({ "action": "list", "includeDisabled": true }))
                .await?,
        ),
        "get" => {
            let trigger_id = required_remote_trigger_id(&input, "get")?;
            let listed = service
                .handle_action(json!({ "action": "list", "includeDisabled": true }))
                .await?;
            let trigger = listed
                .get("jobs")
                .and_then(Value::as_array)
                .and_then(|jobs| {
                    jobs.iter()
                        .find(|job| job.get("id").and_then(Value::as_str) == Some(&trigger_id))
                })
                .cloned();
            match trigger {
                Some(trigger) => remote_trigger_service_response(200, trigger),
                None => remote_trigger_service_response(
                    404,
                    json!({ "error": format!("unknown trigger: {trigger_id}") }),
                ),
            }
        }
        "create" => {
            let body = required_remote_trigger_body(&input, "create")?;
            match service
                .handle_action(json!({
                    "action": "add",
                    "job": normalize_remote_trigger_body(body)
                }))
                .await
            {
                Ok(value) => remote_trigger_service_response(200, value),
                Err(error) => remote_trigger_service_response(400, json!({ "error": error })),
            }
        }
        "update" => {
            let trigger_id = required_remote_trigger_id(&input, "update")?;
            let body = required_remote_trigger_body(&input, "update")?;
            match service
                .handle_action(json!({
                    "action": "update",
                    "id": trigger_id,
                    "patch": normalize_remote_trigger_body(body)
                }))
                .await
            {
                Ok(value) => remote_trigger_service_response(200, value),
                Err(error) => remote_trigger_service_response(404, json!({ "error": error })),
            }
        }
        "run" => {
            let trigger_id = required_remote_trigger_id(&input, "run")?;
            match service
                .handle_action(json!({
                    "action": "run",
                    "id": trigger_id,
                    "mode": "force"
                }))
                .await
            {
                Ok(value) => remote_trigger_service_response(200, value),
                Err(error) => remote_trigger_service_response(404, json!({ "error": error })),
            }
        }
        other => Err(format!("unsupported RemoteTrigger action: {other}")),
    }
}

fn remote_trigger_service_response(status: u16, value: Value) -> Result<Value, String> {
    let json = serde_json::to_string(&value)
        .map_err(|error| format!("serialize RemoteTrigger response: {error}"))?;
    Ok(json!({
        "status": status,
        "json": json
    }))
}

fn required_remote_trigger_id(input: &Value, action: &str) -> Result<String, String> {
    let id =
        string_field(input, "trigger_id").ok_or_else(|| format!("{action} requires trigger_id"))?;
    if id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Ok(id);
    }
    Err("RemoteTrigger trigger_id must match ^[\\w-]+$".to_string())
}

fn require_remote_trigger_keys(input: &Value, allowed_keys: &[&str]) -> Result<(), String> {
    let Some(object) = input.as_object() else {
        return Err("RemoteTrigger input must be an object".to_string());
    };
    for key in object.keys() {
        if !allowed_keys.contains(&key.as_str()) {
            return Err(format!("RemoteTrigger input contains unknown field: {key}"));
        }
    }
    Ok(())
}

fn required_remote_trigger_body(input: &Value, action: &str) -> Result<Value, String> {
    input
        .get("body")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| format!("{action} requires body"))
}

fn normalize_remote_trigger_body(body: Value) -> Value {
    let mut object = object_or_empty(body);
    if !object.contains_key("id") {
        if let Some(trigger_id) =
            string_from_map(&object, "trigger_id").or_else(|| string_from_map(&object, "triggerId"))
        {
            object.insert("id".to_string(), Value::String(trigger_id));
        }
    }
    if !object.contains_key("schedule") {
        if let Some(expr) = string_from_map(&object, "cron") {
            let mut schedule = Map::new();
            schedule.insert("kind".to_string(), Value::String("cron".to_string()));
            schedule.insert("expr".to_string(), Value::String(expr));
            if let Some(tz) =
                string_from_map(&object, "tz").or_else(|| string_from_map(&object, "timezone"))
            {
                schedule.insert("tz".to_string(), Value::String(tz));
            }
            object.insert("schedule".to_string(), Value::Object(schedule));
        }
    }
    if !object.contains_key("payload")
        && !object.contains_key("text")
        && !object.contains_key("message")
    {
        if let Some(prompt) = string_from_map(&object, "prompt") {
            object.insert("text".to_string(), Value::String(prompt));
        }
    }
    Value::Object(object)
}

static WORKER_CRON_SERVICE: OnceLock<Mutex<Option<WorkerCronService>>> = OnceLock::new();

struct WorkerCronService {
    runtime_root: PathBuf,
    store_path: Option<PathBuf>,
    service: CronService,
}

pub async fn execute_cron_runtime_operation(
    runtime_root: &Path,
    operation: &str,
    input: Value,
) -> Result<Value, String> {
    let method = normalize_cron_runtime_operation(operation)?;
    let start_scheduler = method == "cron.start";
    let service = worker_cron_service(
        runtime_root,
        cron_store_path_from_input(&input),
        start_scheduler,
    )?;
    if method == "cron.start" {
        service.start_scheduler();
        return service.handle_method("cron.status", input).await;
    }
    if method == "cron.stop" {
        service.stop_scheduler();
        return service.handle_method("cron.status", input).await;
    }
    service.handle_method(&method, input).await
}

fn worker_cron_service(
    runtime_root: &Path,
    store_path: Option<PathBuf>,
    start_scheduler: bool,
) -> Result<CronService, String> {
    let root = runtime_root.to_path_buf();
    let cell = WORKER_CRON_SERVICE.get_or_init(|| Mutex::new(None));
    let mut guard = cell
        .lock()
        .map_err(|_| "cron worker service lock poisoned".to_string())?;
    if let Some(existing) = guard.as_ref() {
        if existing.runtime_root == root && existing.store_path == store_path {
            if start_scheduler {
                existing.service.start_scheduler();
            }
            return Ok(existing.service.clone());
        }
    }
    let service = CronService::new(CronServiceOptions {
        runtime_root: root.clone(),
        store_path: store_path.clone(),
        start_scheduler,
        ..CronServiceOptions::default()
    })?;
    *guard = Some(WorkerCronService {
        runtime_root: root,
        store_path,
        service: service.clone(),
    });
    Ok(service)
}

fn normalize_cron_runtime_operation(operation: &str) -> Result<String, String> {
    let normalized = match operation {
        "wake" => "wake",
        "cron" => "cron.status",
        "cron.start" | "cron_start" => "cron.start",
        "cron.stop" | "cron_stop" => "cron.stop",
        "cron.status" | "cron_status" => "cron.status",
        "cron.list" | "cron_list" => "cron.list",
        "cron.create" | "cron_create" => "cron.add",
        "cron.add" | "cron_add" => "cron.add",
        "cron.update" | "cron_update" => "cron.update",
        "cron.remove" | "cron_remove" => "cron.remove",
        "cron.run" | "cron_run" => "cron.run",
        "cron.runs" | "cron_runs" => "cron.runs",
        other => return Err(format!("unsupported cron runtime operation: {other}")),
    };
    Ok(normalized.to_string())
}

fn cron_store_path_from_input(input: &Value) -> Option<PathBuf> {
    input
        .get("storePath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn load_store_unlocked(path: &Path) -> Result<CronStoreFile, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CronStoreFile {
                version: STORE_VERSION,
                jobs: Vec::new(),
            });
        }
        Err(error) => return Err(format!("failed to read cron store: {error}")),
    };
    let mut store: CronStoreFile = serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse cron store: {error}"))?;
    store.version = STORE_VERSION;
    for job in &mut store.jobs {
        if job.wake_mode.is_none() {
            job.wake_mode = Some("now".to_string());
        }
        if job.state.next_run_at_ms.is_none() {
            job.state.next_run_at_ms = job
                .extra
                .remove("nextRunAtMs")
                .and_then(|value| coerce_u64(&value));
        } else {
            job.extra.remove("nextRunAtMs");
        }
        if job.state.last_run_at_ms.is_none() {
            job.state.last_run_at_ms = job
                .extra
                .remove("lastRunAtMs")
                .and_then(|value| coerce_u64(&value));
        } else {
            job.extra.remove("lastRunAtMs");
        }
    }
    Ok(store)
}

fn save_store_unlocked(
    path: &Path,
    store: &CronStoreFile,
    runtime_only: bool,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create cron dir: {error}"))?;
        set_secure_dir_mode(parent);
    }
    let json = serde_json::to_string_pretty(store)
        .map_err(|error| format!("serialize cron store: {error}"))?;
    let previous = fs::read_to_string(path).ok();
    if previous.as_deref() == Some(json.as_str()) {
        return Ok(());
    }
    let tmp_path = path.with_extension(format!("{}.tmp", now_millis()));
    fs::write(&tmp_path, json.as_bytes()).map_err(|error| format!("write cron tmp: {error}"))?;
    set_secure_file_mode(&tmp_path);
    if previous.is_some() && !runtime_only && !runtime_only_change(previous.as_deref(), store) {
        let backup_path = PathBuf::from(format!("{}.bak", path.display()));
        let _ = fs::copy(path, &backup_path);
        set_secure_file_mode(&backup_path);
    }
    fs::rename(&tmp_path, path)
        .or_else(|_| {
            fs::copy(&tmp_path, path)
                .map(|_| ())
                .and_then(|_| fs::remove_file(&tmp_path))
        })
        .map_err(|error| format!("replace cron store: {error}"))?;
    set_secure_file_mode(path);
    Ok(())
}

fn append_run_log(
    store_path: &Path,
    entry: &CronRunLogEntry,
    max_bytes: u64,
    keep_lines: usize,
) -> Result<(), String> {
    let path = run_log_path(store_path, &entry.job_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create cron run log dir: {error}"))?;
        set_secure_dir_mode(parent);
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("open cron run log: {error}"))?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(entry).map_err(|error| format!("serialize cron run: {error}"))?
    )
    .map_err(|error| format!("write cron run log: {error}"))?;
    set_secure_file_mode(&path);
    prune_run_log(&path, max_bytes, keep_lines)
}

fn read_run_log(path: &Path, limit: usize) -> Result<Vec<CronRunLogEntry>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("read cron run log: {error}")),
    };
    let mut entries = raw
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<CronRunLogEntry>(line).ok())
        .take(limit)
        .collect::<Vec<_>>();
    entries.reverse();
    Ok(entries)
}

fn read_all_run_logs(store_path: &Path) -> Result<Vec<CronRunLogEntry>, String> {
    let runs_dir = store_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("runs");
    let Ok(entries) = fs::read_dir(&runs_dir) else {
        return Ok(Vec::new());
    };
    let mut runs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        runs.extend(read_run_log(&path, usize::MAX)?);
    }
    Ok(runs)
}

fn filter_run_log_entries(entries: &mut Vec<CronRunLogEntry>, input: &Map<String, Value>) {
    if let Some(status) = string_from_map(input, "status").filter(|status| status != "all") {
        entries.retain(|entry| entry.status.as_deref() == Some(status.as_str()));
    }
    if let Some(statuses) = input.get("statuses").and_then(Value::as_array) {
        let allowed = statuses
            .iter()
            .filter_map(Value::as_str)
            .collect::<HashSet<_>>();
        if !allowed.is_empty() {
            entries.retain(|entry| {
                entry
                    .status
                    .as_deref()
                    .map(|status| allowed.contains(status))
                    .unwrap_or(false)
            });
        }
    }
    if let Some(delivery_status) = string_from_map(input, "deliveryStatus") {
        entries.retain(|entry| entry.delivery_status.as_deref() == Some(delivery_status.as_str()));
    }
    if let Some(query) = string_from_map(input, "query").map(|value| value.to_lowercase()) {
        entries.retain(|entry| {
            [
                entry.job_id.as_str(),
                entry.summary.as_deref().unwrap_or(""),
                entry.error.as_deref().unwrap_or(""),
            ]
            .join(" ")
            .to_lowercase()
            .contains(&query)
        });
    }
}

fn prune_run_log(path: &Path, max_bytes: u64, keep_lines: usize) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() <= max_bytes {
        return Ok(());
    }
    let raw = fs::read_to_string(path).map_err(|error| format!("read cron run log: {error}"))?;
    let lines = raw.lines().rev().take(keep_lines).collect::<Vec<_>>();
    let mut next = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
    next.push('\n');
    fs::write(path, next).map_err(|error| format!("prune cron run log: {error}"))?;
    set_secure_file_mode(path);
    Ok(())
}

fn run_log_path(store_path: &Path, job_id: &str) -> Result<PathBuf, String> {
    if job_id.is_empty()
        || job_id.contains('/')
        || job_id.contains('\\')
        || job_id.as_bytes().contains(&0)
    {
        return Err("cron.runs job id must not contain path separators".to_string());
    }
    let dir = store_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("runs");
    Ok(dir.join(format!("{job_id}.jsonl")))
}

fn normalize_job(input: Value, now: u64) -> Result<CronJob, String> {
    let mut object = object_or_empty(input);
    object.remove("action");
    let id = string_from_map(&object, "id")
        .or_else(|| string_from_map(&object, "jobId"))
        .unwrap_or_else(|| format!("cron-{now}"));
    object.insert("id".to_string(), Value::String(id));
    if !object.contains_key("name") {
        object.insert("name".to_string(), Value::String("Cron job".to_string()));
    }
    if !object.contains_key("sessionTarget") {
        object.insert(
            "sessionTarget".to_string(),
            Value::String(default_session_target()),
        );
    }
    if let Some(schedule) = object.get("schedule").cloned() {
        object.insert("schedule".to_string(), normalize_schedule_value(schedule)?);
    }
    if !object.contains_key("wakeMode") {
        object.insert("wakeMode".to_string(), Value::String("now".to_string()));
    }
    if !object.contains_key("payload") {
        object.insert("payload".to_string(), infer_payload_from_flat(&object)?);
    }
    if !object.contains_key("deleteAfterRun")
        && object
            .get("schedule")
            .and_then(|schedule| schedule.get("kind"))
            .and_then(Value::as_str)
            == Some("at")
    {
        object.insert("deleteAfterRun".to_string(), Value::Bool(true));
    }
    let mut job: CronJob = serde_json::from_value(Value::Object(object))
        .map_err(|error| format!("invalid cron job: {error}"))?;
    validate_job(&job)?;
    if job.created_at_ms.is_none() {
        job.created_at_ms = Some(now);
    }
    Ok(job)
}

fn apply_patch_to_job(job: &mut CronJob, patch: Value) -> Result<(), String> {
    let object = object_or_empty(patch);
    if let Some(value) = object.get("name").and_then(Value::as_str) {
        job.name = value.trim().to_string();
    }
    if let Some(value) = object.get("description") {
        job.description = value.as_str().map(str::to_string);
    }
    if let Some(value) = object.get("enabled").and_then(Value::as_bool) {
        job.enabled = value;
    }
    if let Some(value) = object.get("deleteAfterRun").and_then(Value::as_bool) {
        job.delete_after_run = value;
    }
    if let Some(value) = object.get("agentId") {
        job.agent_id = value.as_str().map(|value| value.trim().to_string());
    }
    if let Some(value) = object.get("sessionKey") {
        job.session_key = value.as_str().map(|value| value.trim().to_string());
    }
    if let Some(value) = object.get("sessionTarget").and_then(Value::as_str) {
        job.session_target = value.trim().to_string();
    }
    if let Some(value) = object.get("schedule") {
        job.schedule = serde_json::from_value(normalize_schedule_value(value.clone())?)
            .map_err(|error| format!("invalid cron schedule patch: {error}"))?;
    }
    if let Some(value) = object.get("payload") {
        job.payload = serde_json::from_value(value.clone())
            .map_err(|error| format!("invalid cron payload patch: {error}"))?;
    } else if object.contains_key("message") || object.contains_key("text") {
        job.payload = serde_json::from_value(infer_payload_from_flat(&object)?)
            .map_err(|error| format!("invalid cron payload patch: {error}"))?;
    }
    if let Some(value) = object.get("delivery") {
        job.delivery = serde_json::from_value(value.clone())
            .map_err(|error| format!("invalid cron delivery patch: {error}"))?;
    }
    validate_job(job)
}

fn validate_job(job: &CronJob) -> Result<(), String> {
    if job.id.trim().is_empty() {
        return Err("cron job id is required".to_string());
    }
    if job.id.contains('/') || job.id.contains('\\') || job.id.as_bytes().contains(&0) {
        return Err("cron job id must not contain path separators".to_string());
    }
    match (&job.session_target[..], &job.payload) {
        ("main", CronPayload::SystemEvent { text }) if !text.trim().is_empty() => Ok(()),
        ("main", CronPayload::SystemEvent { .. }) => {
            Err("cron main job requires non-empty systemEvent text".to_string())
        }
        ("main", CronPayload::AgentTurn { .. }) => {
            Err("cron main target requires payload.kind=\"systemEvent\"".to_string())
        }
        (_, CronPayload::AgentTurn { message, .. }) if !message.trim().is_empty() => Ok(()),
        (_, CronPayload::AgentTurn { .. }) => {
            Err("cron agent job requires non-empty agentTurn message".to_string())
        }
        (_, CronPayload::SystemEvent { .. }) => {
            Err("cron non-main target requires payload.kind=\"agentTurn\"".to_string())
        }
    }?;
    if let Some(delivery) = &job.delivery {
        if delivery.mode == "webhook" && !delivery.to.as_deref().map(is_http_url).unwrap_or(false) {
            return Err(
                "cron webhook delivery requires delivery.to to be a valid http(s) URL".to_string(),
            );
        }
    }
    Ok(())
}

fn compute_next_run_after_completion(job: &CronJob, now: u64) -> Option<u64> {
    compute_next_run_at_ms(&job.schedule, now, &job.id)
}

fn job_next_run_at_ms(job: &CronJob) -> Option<u64> {
    job.state.next_run_at_ms
}

fn sort_jobs(jobs: &mut [CronJob], sort_by: &str, sort_dir: &str) {
    jobs.sort_by(|left, right| {
        let ordering = match sort_by {
            "name" => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
            "updatedAtMs" => left.updated_at_ms.cmp(&right.updated_at_ms),
            _ => job_next_run_at_ms(left).cmp(&job_next_run_at_ms(right)),
        };
        let ordering = ordering.then_with(|| left.id.cmp(&right.id));
        if sort_dir == "desc" {
            ordering.reverse()
        } else {
            ordering
        }
    });
}

fn resolve_delivery_status(job: &CronJob, ok: bool) -> String {
    match job.delivery.as_ref().map(|delivery| delivery.mode.as_str()) {
        Some("webhook") if ok => "unknown".to_string(),
        Some("announce") if ok => "unknown".to_string(),
        Some("webhook") | Some("announce") => "not-delivered".to_string(),
        _ => "not-requested".to_string(),
    }
}

fn normalize_schedule_value(value: Value) -> Result<Value, String> {
    let mut object = object_or_empty(value);
    if !object.contains_key("kind") {
        let kind = if object.contains_key("at") || object.contains_key("atMs") {
            "at"
        } else if object.contains_key("everyMs") {
            "every"
        } else if object.contains_key("expr") {
            "cron"
        } else {
            return Err("cron schedule kind is required".to_string());
        };
        object.insert("kind".to_string(), Value::String(kind.to_string()));
    }
    Ok(Value::Object(object))
}

pub fn compute_next_run_at_ms(schedule: &CronSchedule, now: u64, job_id: &str) -> Option<u64> {
    match schedule {
        CronSchedule::At { at, at_ms } => {
            parse_at_ms(at.as_deref(), at_ms.as_ref()).filter(|value| *value > now)
        }
        CronSchedule::Every {
            every_ms,
            anchor_ms,
        } => {
            let every = coerce_u64(every_ms).unwrap_or(1).max(1);
            let anchor = anchor_ms.as_ref().and_then(coerce_u64).unwrap_or(now);
            if now < anchor {
                return Some(anchor);
            }
            let elapsed = now.saturating_sub(anchor);
            let steps = elapsed.div_ceil(every).max(1);
            Some(anchor + steps * every)
        }
        CronSchedule::Cron {
            expr,
            tz,
            stagger_ms,
        } => {
            let cron = Cron::from_str(expr).ok()?;
            let timezone = tz
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("UTC")
                .parse::<Tz>()
                .unwrap_or(chrono_tz::UTC);
            let start = Utc
                .timestamp_millis_opt(now as i64)
                .single()?
                .with_timezone(&timezone);
            let next = cron.find_next_occurrence(&start, false).ok()?;
            let mut next_ms = next.with_timezone(&Utc).timestamp_millis() as u64;
            if let Some(stagger) = stagger_ms
                .as_ref()
                .and_then(coerce_u64)
                .filter(|value| *value > 0)
            {
                next_ms = next_ms.saturating_add(stable_stagger_ms(job_id, stagger));
            }
            (next_ms > now).then_some(next_ms)
        }
    }
}

fn parse_at_ms(at: Option<&str>, at_ms: Option<&Value>) -> Option<u64> {
    if let Some(value) = at_ms.and_then(coerce_u64) {
        return Some(value);
    }
    let at = at?;
    if let Ok(ms) = at.trim().parse::<u64>() {
        return Some(ms);
    }
    DateTime::parse_from_rfc3339(at)
        .ok()
        .map(|value| value.with_timezone(&Utc).timestamp_millis() as u64)
}

fn stable_stagger_ms(job_id: &str, stagger_ms: u64) -> u64 {
    let digest = Sha256::digest(job_id.as_bytes());
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    u64::from_be_bytes(bytes) % stagger_ms
}

fn job_payload_from_action(input: &Value) -> Value {
    input
        .get("job")
        .cloned()
        .unwrap_or_else(|| strip_action_fields(input))
}

fn strip_action_fields(input: &Value) -> Value {
    let mut object = object_or_empty(input.clone());
    for key in ["action", "mode", "includeDisabled"] {
        object.remove(key);
    }
    Value::Object(object)
}

fn infer_payload_from_flat(object: &Map<String, Value>) -> Result<Value, String> {
    if let Some(text) = object.get("text").and_then(Value::as_str) {
        return Ok(json!({ "kind": "systemEvent", "text": text }));
    }
    if let Some(message) = object.get("message").and_then(Value::as_str) {
        let mut payload = Map::new();
        payload.insert("kind".to_string(), Value::String("agentTurn".to_string()));
        payload.insert("message".to_string(), Value::String(message.to_string()));
        for key in [
            "model",
            "fallbacks",
            "thinking",
            "timeoutSeconds",
            "allowUnsafeExternalContent",
            "lightContext",
            "toolsAllow",
        ] {
            if let Some(value) = object.get(key) {
                payload.insert(key.to_string(), value.clone());
            }
        }
        return Ok(Value::Object(payload));
    }
    Err("cron job payload is required".to_string())
}

fn required_id(input: &Value) -> Result<String, String> {
    string_field(input, "id")
        .or_else(|| string_field(input, "jobId"))
        .ok_or_else(|| "cron job id is required".to_string())
}

fn include_disabled(input: &Value) -> bool {
    input
        .get("includeDisabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || input
            .get("enabled")
            .and_then(Value::as_str)
            .map(|value| value == "all")
            .unwrap_or(false)
}

fn object_or_empty(input: Value) -> Map<String, Value> {
    match input {
        Value::Object(object) => object,
        _ => Map::new(),
    }
}

fn string_field(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn require_claude_cron_keys(
    input: &Value,
    allowed_keys: &[&str],
    tool_name: &str,
) -> pi::sdk::Result<()> {
    let Some(object) = input.as_object() else {
        return Err(pi::sdk::Error::validation(format!(
            "{tool_name} input must be an object"
        )));
    };
    for key in object.keys() {
        if !allowed_keys.contains(&key.as_str()) {
            return Err(pi::sdk::Error::validation(format!(
                "{tool_name} input contains unknown field: {key}"
            )));
        }
    }
    Ok(())
}

fn semantic_bool_field(input: &Value, key: &str) -> Result<Option<bool>, String> {
    let Some(value) = input.get(key) else {
        return Ok(None);
    };
    if let Some(value) = value.as_bool() {
        return Ok(Some(value));
    }
    if let Some(raw) = value.as_str() {
        return match raw {
            "true" => Ok(Some(true)),
            "false" => Ok(Some(false)),
            _ => Err(format!("{key} must be true or false")),
        };
    }
    Err(format!("{key} must be true or false"))
}

fn string_from_map(input: &Map<String, Value>, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn coerce_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.trim().parse::<u64>().ok())
}

fn resolve_agent_session_key(job: &CronJob) -> String {
    if let Some(session_key) = job.session_key.as_deref().filter(|value| !value.is_empty()) {
        return session_key.to_string();
    }
    if let Some(session_key) = job.session_target.strip_prefix("session:") {
        if !session_key.trim().is_empty() {
            return session_key.trim().to_string();
        }
    }
    format!("cron:{}", job.id)
}

fn resolve_cron_agent_model(model: Option<&str>) -> (String, String) {
    let Some(model_ref) = model.map(str::trim).filter(|value| !value.is_empty()) else {
        return ("configured".to_string(), "configured".to_string());
    };
    if let Some((provider, model_id)) = model_ref.split_once('/') {
        let provider = provider.trim();
        let model_id = model_id.trim();
        if !provider.is_empty() && !model_id.is_empty() {
            return (provider.to_string(), model_id.to_string());
        }
    }
    ("configured".to_string(), model_ref.to_string())
}

fn runtime_only_change(previous_raw: Option<&str>, next_store: &CronStoreFile) -> bool {
    let Some(previous_raw) = previous_raw else {
        return false;
    };
    let Ok(previous) = serde_json::from_str::<CronStoreFile>(previous_raw) else {
        return false;
    };
    strip_runtime_only(previous) == strip_runtime_only(next_store.clone())
}

fn strip_runtime_only(mut store: CronStoreFile) -> Value {
    for job in &mut store.jobs {
        job.state.next_run_at_ms = None;
        job.state.running_at_ms = None;
        job.state.last_run_at_ms = None;
        job.state.last_run_status = None;
        job.state.last_status = None;
        job.state.last_error = None;
        job.state.last_duration_ms = None;
        job.state.consecutive_errors = 0;
        job.state.last_delivery_status = None;
        job.state.last_delivery_error = None;
        job.state.last_delivered = None;
        job.updated_at_ms = None;
    }
    serde_json::to_value(store).unwrap_or(Value::Null)
}

fn retry_backoff_ms(consecutive_errors: u32) -> u64 {
    let idx = consecutive_errors.saturating_sub(1) as usize;
    DEFAULT_BACKOFF_MS
        .get(idx)
        .copied()
        .unwrap_or_else(|| *DEFAULT_BACKOFF_MS.last().unwrap_or(&60_000))
}

fn is_transient_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    [
        "rate_limit",
        "too many requests",
        "429",
        "overloaded",
        "timeout",
        "network",
        "socket",
        "5",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_http_url(input: &str) -> bool {
    input.starts_with("http://") || input.starts_with("https://")
}

impl CronRuntimeConfig {
    fn load() -> Self {
        let value = read_active_config()
            .and_then(|config| config.get("cron").cloned())
            .unwrap_or(Value::Null);
        let cron = value.as_object();
        let run_log = cron
            .and_then(|cron| cron.get("runLog"))
            .and_then(Value::as_object);
        Self {
            enabled: cron
                .and_then(|cron| cron.get("enabled"))
                .and_then(Value::as_bool)
                .unwrap_or(true),
            store_path: cron
                .and_then(|cron| cron.get("store"))
                .and_then(Value::as_str)
                .map(expand_user_path),
            webhook_token: cron
                .and_then(|cron| cron.get("webhookToken"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            max_concurrent_runs: cron
                .and_then(|cron| cron.get("maxConcurrentRuns"))
                .and_then(Value::as_u64)
                .map(|value| value as usize),
            run_log_max_bytes: run_log
                .and_then(|run_log| run_log.get("maxBytes"))
                .and_then(coerce_u64)
                .unwrap_or(DEFAULT_RUN_LOG_MAX_BYTES),
            run_log_keep_lines: run_log
                .and_then(|run_log| run_log.get("keepLines"))
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(DEFAULT_RUN_LOG_KEEP_LINES),
        }
    }
}

fn default_cron_store_path() -> PathBuf {
    resolve_state_dir().join("cron").join("jobs.json")
}

fn read_active_config() -> Option<Value> {
    let path = if let Some(value) =
        std::env::var_os("CRAWCLAW_CONFIG_PATH").filter(|value| !value.is_empty())
    {
        expand_user_path(value.to_string_lossy().as_ref())
    } else {
        resolve_state_dir().join("crawclaw.json")
    };
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn resolve_state_dir() -> PathBuf {
    std::env::var_os("CRAWCLAW_STATE_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| resolve_home_dir().join(".crawclaw"))
}

fn resolve_home_dir() -> PathBuf {
    std::env::var_os("HOME")
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

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn default_session_target() -> String {
    "main".to_string()
}

fn default_enabled() -> bool {
    true
}

fn default_delivery_mode() -> String {
    "none".to_string()
}

#[cfg(unix)]
fn set_secure_dir_mode(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn set_secure_dir_mode(_path: &Path) {}

#[cfg(unix)]
fn set_secure_file_mode(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn set_secure_file_mode(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_schedule_advances_from_anchor() {
        let schedule = CronSchedule::Every {
            every_ms: json!(1_000),
            anchor_ms: Some(json!(10_000)),
        };
        assert_eq!(
            compute_next_run_at_ms(&schedule, 9_000, "job"),
            Some(10_000)
        );
        assert_eq!(
            compute_next_run_at_ms(&schedule, 10_001, "job"),
            Some(11_000)
        );
    }

    #[test]
    fn run_log_rejects_path_traversal_ids() {
        let path = run_log_path(Path::new("/tmp/jobs.json"), "../job");
        assert!(path.is_err());
    }
}

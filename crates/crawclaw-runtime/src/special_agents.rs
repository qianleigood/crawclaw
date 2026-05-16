use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentExecutionMode {
    SpawnedSession,
    EmbeddedFork,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentTranscriptPolicy {
    Isolated,
    ThreadBound,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentParentContextPolicy {
    None,
    ForkMessagesOnly,
    FullEnvelope,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpecialAgentToolGuard {
    MemoryMaintenance,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpecialAgentDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub spawn_source: &'static str,
    pub execution_mode: SpecialAgentExecutionMode,
    pub transcript_policy: SpecialAgentTranscriptPolicy,
    pub parent_context_policy: SpecialAgentParentContextPolicy,
    pub tool_allowlist: &'static [&'static str],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guard: Option<SpecialAgentToolGuard>,
    pub timeout_seconds: u64,
    pub max_turns: u32,
}

pub const REVIEW_AGENT_TOOL_ALLOWLIST: &[&str] = &[
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "process",
    "session_status",
    "sessions_list",
    "sessions_history",
];

pub const MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST: &[&str] = &[
    "memory_manifest_read",
    "memory_note_read",
    "memory_note_write",
    "memory_note_edit",
    "memory_note_delete",
    "sessions_history",
];

pub const DREAM_TOOL_ALLOWLIST: &[&str] = &[
    "memory_manifest_read",
    "memory_note_read",
    "memory_note_write",
    "memory_note_edit",
    "memory_note_delete",
    "session_summary_file_read",
    "sessions_history",
];

pub const SESSION_SUMMARY_TOOL_ALLOWLIST: &[&str] = &[
    "session_summary_file_read",
    "session_summary_file_edit",
    "sessions_history",
];

pub const EXPERIENCE_TOOL_ALLOWLIST: &[&str] = &["write_experience_note", "sessions_history"];

const SPECIAL_AGENT_DEFINITIONS: &[SpecialAgentDefinition] = &[
    SpecialAgentDefinition {
        id: "review-spec",
        label: "Review spec",
        spawn_source: "review-spec",
        execution_mode: SpecialAgentExecutionMode::SpawnedSession,
        transcript_policy: SpecialAgentTranscriptPolicy::Isolated,
        parent_context_policy: SpecialAgentParentContextPolicy::ForkMessagesOnly,
        tool_allowlist: REVIEW_AGENT_TOOL_ALLOWLIST,
        guard: None,
        timeout_seconds: 300,
        max_turns: 8,
    },
    SpecialAgentDefinition {
        id: "review-quality",
        label: "Review quality",
        spawn_source: "review-quality",
        execution_mode: SpecialAgentExecutionMode::SpawnedSession,
        transcript_policy: SpecialAgentTranscriptPolicy::Isolated,
        parent_context_policy: SpecialAgentParentContextPolicy::ForkMessagesOnly,
        tool_allowlist: REVIEW_AGENT_TOOL_ALLOWLIST,
        guard: None,
        timeout_seconds: 300,
        max_turns: 8,
    },
    SpecialAgentDefinition {
        id: "durable-memory",
        label: "Durable memory",
        spawn_source: "durable-memory",
        execution_mode: SpecialAgentExecutionMode::EmbeddedFork,
        transcript_policy: SpecialAgentTranscriptPolicy::ThreadBound,
        parent_context_policy: SpecialAgentParentContextPolicy::ForkMessagesOnly,
        tool_allowlist: MEMORY_FILE_MAINTENANCE_TOOL_ALLOWLIST,
        guard: Some(SpecialAgentToolGuard::MemoryMaintenance),
        timeout_seconds: 90,
        max_turns: 5,
    },
    SpecialAgentDefinition {
        id: "dream",
        label: "Dream",
        spawn_source: "dream",
        execution_mode: SpecialAgentExecutionMode::EmbeddedFork,
        transcript_policy: SpecialAgentTranscriptPolicy::ThreadBound,
        parent_context_policy: SpecialAgentParentContextPolicy::None,
        tool_allowlist: DREAM_TOOL_ALLOWLIST,
        guard: Some(SpecialAgentToolGuard::MemoryMaintenance),
        timeout_seconds: 120,
        max_turns: 5,
    },
    SpecialAgentDefinition {
        id: "session-summary",
        label: "Session summary",
        spawn_source: "session-summary",
        execution_mode: SpecialAgentExecutionMode::EmbeddedFork,
        transcript_policy: SpecialAgentTranscriptPolicy::ThreadBound,
        parent_context_policy: SpecialAgentParentContextPolicy::FullEnvelope,
        tool_allowlist: SESSION_SUMMARY_TOOL_ALLOWLIST,
        guard: Some(SpecialAgentToolGuard::MemoryMaintenance),
        timeout_seconds: 90,
        max_turns: 5,
    },
    SpecialAgentDefinition {
        id: "experience",
        label: "Experience",
        spawn_source: "experience",
        execution_mode: SpecialAgentExecutionMode::EmbeddedFork,
        transcript_policy: SpecialAgentTranscriptPolicy::ThreadBound,
        parent_context_policy: SpecialAgentParentContextPolicy::None,
        tool_allowlist: EXPERIENCE_TOOL_ALLOWLIST,
        guard: Some(SpecialAgentToolGuard::MemoryMaintenance),
        timeout_seconds: 90,
        max_turns: 5,
    },
];

pub fn special_agent_definitions() -> &'static [SpecialAgentDefinition] {
    SPECIAL_AGENT_DEFINITIONS
}

pub fn find_special_agent(id_or_spawn_source: &str) -> Option<&'static SpecialAgentDefinition> {
    let normalized = id_or_spawn_source.trim().replace('_', "-");
    SPECIAL_AGENT_DEFINITIONS
        .iter()
        .find(|definition| definition.id == normalized || definition.spawn_source == normalized)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialAgentRunRequest {
    pub kind: Option<String>,
    pub spawn_source: Option<String>,
    pub task: Option<String>,
    pub scope: Option<String>,
    pub parent_session_key: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SpecialAgentMemoryTools {
    runtime_root: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryManifest {
    pub status: String,
    pub scope: String,
    pub entries: Vec<MemoryManifestEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryManifestEntry {
    pub note_path: String,
    pub title: String,
    pub bytes: u64,
    pub modified_millis: u128,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNoteRead {
    pub status: String,
    pub scope: String,
    pub note_path: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryWriteResult {
    pub status: String,
    pub scope: String,
    pub note_path: String,
    pub bytes_written: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEditResult {
    pub status: String,
    pub scope: String,
    pub note_path: String,
    pub replacements: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDeleteResult {
    pub status: String,
    pub scope: String,
    pub note_path: String,
}

impl SpecialAgentMemoryTools {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        Self {
            runtime_root: runtime_root.into(),
        }
    }

    pub fn read_manifest(&self, scope: &str) -> Result<MemoryManifest, String> {
        let root = self.scope_root(scope)?;
        let mut entries = Vec::new();
        collect_markdown_entries(&root, &root, &mut entries)?;
        entries.sort_by(|left, right| left.note_path.cmp(&right.note_path));
        Ok(MemoryManifest {
            status: "ok".to_string(),
            scope: normalize_scope(scope)?,
            entries,
        })
    }

    pub fn read_note(&self, scope: &str, note_path: &str) -> Result<MemoryNoteRead, String> {
        let target = self.note_file(scope, note_path)?;
        let content = fs::read_to_string(&target)
            .map_err(|error| format!("failed to read memory note {}: {error}", target.display()))?;
        Ok(MemoryNoteRead {
            status: "ok".to_string(),
            scope: normalize_scope(scope)?,
            note_path: normalize_note_path(note_path)?,
            content,
        })
    }

    pub fn write_note(
        &self,
        scope: &str,
        note_path: &str,
        content: &str,
    ) -> Result<MemoryWriteResult, String> {
        let target = self.note_file(scope, note_path)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create memory note dir: {error}"))?;
        }
        fs::write(&target, content).map_err(|error| {
            format!("failed to write memory note {}: {error}", target.display())
        })?;
        Ok(MemoryWriteResult {
            status: "ok".to_string(),
            scope: normalize_scope(scope)?,
            note_path: normalize_note_path(note_path)?,
            bytes_written: content.len() as u64,
        })
    }

    pub fn edit_note(
        &self,
        scope: &str,
        note_path: &str,
        search: &str,
        replace: &str,
    ) -> Result<MemoryEditResult, String> {
        if search.is_empty() {
            return Err("memory_note_edit requires a non-empty search string".to_string());
        }
        let target = self.note_file(scope, note_path)?;
        let content = fs::read_to_string(&target)
            .map_err(|error| format!("failed to read memory note {}: {error}", target.display()))?;
        let replacements = content.matches(search).count();
        if replacements == 0 {
            return Err("memory_note_edit search text was not found".to_string());
        }
        fs::write(&target, content.replace(search, replace))
            .map_err(|error| format!("failed to edit memory note {}: {error}", target.display()))?;
        Ok(MemoryEditResult {
            status: "ok".to_string(),
            scope: normalize_scope(scope)?,
            note_path: normalize_note_path(note_path)?,
            replacements,
        })
    }

    pub fn delete_note(&self, scope: &str, note_path: &str) -> Result<MemoryDeleteResult, String> {
        let target = self.note_file(scope, note_path)?;
        fs::remove_file(&target).map_err(|error| {
            format!("failed to delete memory note {}: {error}", target.display())
        })?;
        Ok(MemoryDeleteResult {
            status: "deleted".to_string(),
            scope: normalize_scope(scope)?,
            note_path: normalize_note_path(note_path)?,
        })
    }

    fn scope_root(&self, scope: &str) -> Result<PathBuf, String> {
        Ok(self
            .runtime_root
            .join("memory")
            .join("durable")
            .join(normalize_scope(scope)?))
    }

    fn note_file(&self, scope: &str, note_path: &str) -> Result<PathBuf, String> {
        Ok(self
            .scope_root(scope)?
            .join(normalize_note_path(note_path)?))
    }
}

#[derive(Clone, Debug)]
pub struct SessionSummaryStore {
    runtime_root: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryStatus {
    pub status: String,
    pub scope: String,
    pub exists: bool,
    pub bytes: u64,
}

impl SessionSummaryStore {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        Self {
            runtime_root: runtime_root.into(),
        }
    }

    pub fn status(&self, scope: &str) -> Result<SessionSummaryStatus, String> {
        let path = self.summary_file(scope)?;
        let bytes = fs::metadata(&path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        Ok(SessionSummaryStatus {
            status: "ok".to_string(),
            scope: normalize_scope(scope)?,
            exists: path.exists(),
            bytes,
        })
    }

    pub fn read(&self, scope: &str) -> Result<Value, String> {
        let path = self.summary_file(scope)?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "content": content
        }))
    }

    pub fn edit(&self, scope: &str, content: &str) -> Result<Value, String> {
        let path = self.summary_file(scope)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create session summary dir: {error}"))?;
        }
        fs::write(&path, content)
            .map_err(|error| format!("failed to write session summary: {error}"))?;
        Ok(json!({
            "status": "ok",
            "scope": normalize_scope(scope)?,
            "bytesWritten": content.len()
        }))
    }

    pub fn refresh(&self, scope: &str, content: &str) -> Result<Value, String> {
        let body = if content.trim().is_empty() {
            "# Session summary\n\nNo new session summary content was provided.\n".to_string()
        } else {
            format!("# Session summary\n\n{}\n", content.trim())
        };
        self.edit(scope, &body)
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
        write_json_array(&self.outbox_file(), &entries)?;
        Ok(json!({
            "status": "ok",
            "entry": entry
        }))
    }

    pub fn list(&self) -> Result<Vec<Value>, String> {
        read_json_array(&self.outbox_file())
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
        write_json_array(&self.outbox_file(), &entries)?;
        Ok(json!({
            "status": "ok",
            "entries": entries
        }))
    }

    pub fn prune(&self) -> Result<Value, String> {
        let entries = self
            .list()?
            .into_iter()
            .filter(|entry| entry.get("status").and_then(Value::as_str) == Some("pending"))
            .collect::<Vec<_>>();
        write_json_array(&self.outbox_file(), &entries)?;
        Ok(json!({
            "status": "ok",
            "entries": entries
        }))
    }

    pub fn flush(&self) -> Result<Value, String> {
        let entries = self.list()?;
        Ok(json!({
            "status": "ok",
            "flushed": 0,
            "entries": entries
        }))
    }

    fn outbox_file(&self) -> PathBuf {
        self.runtime_root
            .join("memory")
            .join("experience")
            .join("outbox.json")
    }
}

fn collect_markdown_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<MemoryManifestEntry>,
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
        let entry = entry.map_err(|error| format!("failed to read memory entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_entries(root, &path, entries)?;
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("failed to inspect memory entry: {error}"))?;
        let note_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let title = fs::read_to_string(&path)
            .ok()
            .and_then(|content| first_markdown_title(&content))
            .unwrap_or_else(|| note_path.clone());
        let modified_millis = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        entries.push(MemoryManifestEntry {
            note_path,
            title,
            bytes: metadata.len(),
            modified_millis,
        });
    }
    Ok(())
}

fn first_markdown_title(content: &str) -> Option<String> {
    content
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_scope(scope: &str) -> Result<String, String> {
    let value = scope.trim();
    if value.is_empty() {
        return Ok("main".to_string());
    }
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Ok(value.to_string());
    }
    Err(format!("invalid memory scope: {scope}"))
}

fn normalize_note_path(note_path: &str) -> Result<String, String> {
    let raw = Path::new(note_path.trim());
    if raw.as_os_str().is_empty() {
        return Err("memory note path must not be empty".to_string());
    }
    if raw.is_absolute() {
        return Err("memory note path must be relative".to_string());
    }
    let mut normalized = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("memory note path must not escape the scope".to_string());
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err("memory note path must be relative".to_string());
            }
        }
    }
    let value = normalized.to_string_lossy().replace('\\', "/");
    if value.is_empty() {
        return Err("memory note path must not be empty".to_string());
    }
    if !value.ends_with(".md") {
        return Err("memory note path must end with .md".to_string());
    }
    Ok(value)
}

fn read_json_array(path: &Path) -> Result<Vec<Value>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("invalid JSON store {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!(
            "failed to read JSON store {}: {error}",
            path.display()
        )),
    }
}

fn write_json_array(path: &Path, entries: &[Value]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create JSON store dir: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("failed to serialize JSON store: {error}"))?;
    fs::write(path, format!("{raw}\n"))
        .map_err(|error| format!("failed to write JSON store {}: {error}", path.display()))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

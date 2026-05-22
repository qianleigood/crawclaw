use super::*;

#[derive(Clone)]
pub struct DesktopMemoryStore {
    store_path: PathBuf,
}

#[derive(Clone)]
pub struct DesktopPreferencesStore {
    store_path: PathBuf,
}

#[derive(Clone)]
pub struct DesktopSessionStore {
    sessions_dir: PathBuf,
    metadata_path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMemoryRecord {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub category: String,
    pub tags: Vec<String>,
    pub source: String,
    pub updated_at: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferencesRecord {
    pub selected_model: String,
    pub selected_thinking: String,
    pub permission_mode: String,
    #[serde(default)]
    pub task_defaults: serde_json::Value,
    #[serde(default)]
    pub confirmation_defaults: serde_json::Value,
    #[serde(default)]
    pub notification_defaults: serde_json::Value,
    #[serde(default)]
    pub ui_defaults: serde_json::Value,
    #[serde(default)]
    pub memory_defaults: serde_json::Value,
    #[serde(default)]
    pub privacy_defaults: serde_json::Value,
    #[serde(default)]
    pub advanced_defaults: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopSessionRecord {
    pub thread_id: String,
    pub title: String,
    pub pinned: bool,
    pub messages: Vec<DesktopConversationMessageRecord>,
    pub result_items: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopConversationMessageRecord {
    pub kind: String,
    pub text: String,
    pub source: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionSummary {
    pub key: String,
    pub title: String,
    pub pinned: bool,
    pub status: String,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawned_by: Option<String>,
    pub yielded: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionStatus {
    pub key: String,
    pub title: String,
    pub pinned: bool,
    pub status: String,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawned_by: Option<String>,
    pub yielded: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DesktopMemoryStoreError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for DesktopMemoryStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DesktopMemoryStoreError {}

#[derive(Debug, PartialEq, Eq)]
pub enum DesktopPreferencesStoreError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for DesktopPreferencesStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DesktopPreferencesStoreError {}

#[derive(Debug, PartialEq, Eq)]
pub enum DesktopSessionStoreError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for DesktopSessionStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DesktopSessionStoreError {}

#[derive(Clone)]
pub struct DesktopAgentStore {
    store_path: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DesktopAgentStoreError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for DesktopAgentStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for DesktopAgentStoreError {}

impl DesktopAgentStore {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            store_path: runtime_root.join("agents").join("desktop-agents.json"),
        }
    }

    pub fn load_agents(&self) -> Result<Vec<serde_json::Value>, DesktopAgentStoreError> {
        let raw = match fs::read_to_string(&self.store_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(DesktopAgentStoreError::Io(format!(
                    "Failed to read desktop agent store: {error}"
                )));
            }
        };
        serde_json::from_str(&raw).map_err(|error| {
            DesktopAgentStoreError::Invalid(format!("Invalid desktop agent store: {error}"))
        })
    }

    pub fn upsert_agent(
        &self,
        agent_id: &str,
        agent: serde_json::Value,
    ) -> Result<(), DesktopAgentStoreError> {
        let mut agents = self.load_agents()?;
        if let Some(existing) = agents
            .iter_mut()
            .find(|agent| agent.get("id").and_then(serde_json::Value::as_str) == Some(agent_id))
        {
            *existing = agent;
        } else {
            agents.push(agent);
        }
        self.save_agents(&agents)
    }

    fn save_agents(&self, agents: &[serde_json::Value]) -> Result<(), DesktopAgentStoreError> {
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopAgentStoreError::Io(format!(
                    "Failed to create desktop agent store directory: {error}"
                ))
            })?;
        }
        fs::write(
            &self.store_path,
            serde_json::to_vec_pretty(agents).map_err(|error| {
                DesktopAgentStoreError::Invalid(format!(
                    "Failed to serialize desktop agent store: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            DesktopAgentStoreError::Io(format!("Failed to write desktop agent store: {error}"))
        })
    }
}

impl DesktopMemoryStore {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            store_path: runtime_root.join("memory").join("desktop-items.json"),
        }
    }

    pub fn load_items(&self) -> Result<Vec<DesktopMemoryRecord>, DesktopMemoryStoreError> {
        let raw = match fs::read_to_string(&self.store_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(DesktopMemoryStoreError::Io(format!(
                    "Failed to read desktop memory store: {error}"
                )));
            }
        };
        serde_json::from_str(&raw).map_err(|error| {
            DesktopMemoryStoreError::Invalid(format!("Invalid desktop memory store: {error}"))
        })
    }

    pub fn upsert_item(&self, item: DesktopMemoryRecord) -> Result<(), DesktopMemoryStoreError> {
        let mut items = self.load_items()?;
        if let Some(existing) = items.iter_mut().find(|existing| existing.id == item.id) {
            *existing = item;
        } else {
            items.push(item);
        }
        self.save_items(&items)
    }

    pub fn archive_item(&self, item_id: &str) -> Result<bool, DesktopMemoryStoreError> {
        let mut items = self.load_items()?;
        let mut changed = false;
        for item in &mut items {
            if item.id == item_id {
                item.archived = true;
                item.updated_at = "刚刚".to_string();
                changed = true;
            }
        }
        if changed {
            self.save_items(&items)?;
        }
        Ok(changed)
    }

    fn save_items(&self, items: &[DesktopMemoryRecord]) -> Result<(), DesktopMemoryStoreError> {
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopMemoryStoreError::Io(format!(
                    "Failed to create desktop memory store directory: {error}"
                ))
            })?;
        }
        fs::write(
            &self.store_path,
            serde_json::to_vec_pretty(items).map_err(|error| {
                DesktopMemoryStoreError::Invalid(format!(
                    "Failed to serialize desktop memory store: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            DesktopMemoryStoreError::Io(format!("Failed to write desktop memory store: {error}"))
        })
    }
}

impl DesktopPreferencesStore {
    pub fn new(runtime_root: PathBuf) -> Self {
        Self {
            store_path: runtime_root.join("config").join("desktop-preferences.json"),
        }
    }

    pub fn load_preferences(
        &self,
    ) -> Result<Option<DesktopPreferencesRecord>, DesktopPreferencesStoreError> {
        let raw = match fs::read_to_string(&self.store_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(DesktopPreferencesStoreError::Io(format!(
                    "Failed to read desktop preferences store: {error}"
                )));
            }
        };
        serde_json::from_str(&raw).map(Some).map_err(|error| {
            DesktopPreferencesStoreError::Invalid(format!(
                "Invalid desktop preferences store: {error}"
            ))
        })
    }

    pub fn save_preferences(
        &self,
        preferences: &DesktopPreferencesRecord,
    ) -> Result<(), DesktopPreferencesStoreError> {
        if let Some(parent) = self.store_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopPreferencesStoreError::Io(format!(
                    "Failed to create desktop preferences store directory: {error}"
                ))
            })?;
        }
        fs::write(
            &self.store_path,
            serde_json::to_vec_pretty(preferences).map_err(|error| {
                DesktopPreferencesStoreError::Invalid(format!(
                    "Failed to serialize desktop preferences store: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            DesktopPreferencesStoreError::Io(format!(
                "Failed to write desktop preferences store: {error}"
            ))
        })
    }
}

impl DesktopSessionStore {
    pub fn new(runtime_root: PathBuf) -> Self {
        let sessions_dir = runtime_root.join("sessions");
        Self {
            metadata_path: sessions_dir.join("desktop-session-metadata.json"),
            sessions_dir,
        }
    }

    pub fn load_sessions(&self) -> Result<Vec<DesktopSessionRecord>, DesktopSessionStoreError> {
        let metadata_by_thread = self.load_metadata_map()?;
        let entries = match fs::read_dir(&self.sessions_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session directory: {error}"
                )));
            }
        };

        let mut sessions = Vec::new();
        for entry in entries {
            let path = entry
                .map_err(|error| {
                    DesktopSessionStoreError::Io(format!(
                        "Failed to read desktop session entry: {error}"
                    ))
                })?
                .path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
                continue;
            }
            let thread_id = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .filter(|stem| !stem.is_empty())
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    DesktopSessionStoreError::Invalid(format!(
                        "Invalid desktop session filename: {}",
                        path.display()
                    ))
                })?;
            let metadata = metadata_by_thread.get(&thread_id);
            if metadata.map(|metadata| metadata.archived).unwrap_or(false) {
                continue;
            }
            let raw = fs::read_to_string(&path).map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session transcript: {error}"
                ))
            })?;
            let transcript_entries = parse_transcript_entries(&raw, &path)?;
            let title = metadata
                .and_then(|metadata| metadata.title.clone())
                .unwrap_or_else(|| {
                    transcript_entries
                        .iter()
                        .find(|entry| entry.role == "user")
                        .map(|entry| title_from_transcript_text(&entry.content))
                        .unwrap_or_else(|| thread_id.clone())
                });
            let result_items = transcript_entries
                .iter()
                .cloned()
                .filter_map(transcript_result_item)
                .collect();
            let messages = transcript_entries
                .into_iter()
                .filter_map(transcript_message_record)
                .collect();
            sessions.push(DesktopSessionRecord {
                thread_id,
                title,
                pinned: metadata.map(|metadata| metadata.pinned).unwrap_or(false),
                messages,
                result_items,
            });
        }
        sessions.sort_by(|left, right| left.thread_id.cmp(&right.thread_id));
        Ok(sessions)
    }

    pub fn load_session(
        &self,
        thread_id: &str,
    ) -> Result<Option<DesktopSessionRecord>, DesktopSessionStoreError> {
        Ok(self
            .load_sessions()?
            .into_iter()
            .find(|session| session.thread_id == thread_id))
    }

    pub fn session_transcript_path(
        &self,
        thread_id: &str,
    ) -> Result<PathBuf, DesktopSessionStoreError> {
        self.transcript_path(thread_id)
    }

    pub fn create_session(
        &self,
        thread_id: &str,
        title: Option<&str>,
        model: Option<&str>,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        if let Some(parent) = transcript_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to create desktop session directory: {error}"
                ))
            })?;
        }
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&transcript_path)
            .map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to create desktop session transcript: {error}"
                ))
            })?;
        self.update_thread_metadata(thread_id, |metadata| {
            if let Some(title) = title.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.title = Some(title.to_string());
            }
            if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.model = Some(model.to_string());
            }
            metadata.status = Some("idle".to_string());
            metadata.archived = false;
        })?;
        self.session_status(thread_id)?
            .ok_or_else(|| DesktopSessionStoreError::Invalid("session was not created".to_string()))
    }

    pub fn patch_session(
        &self,
        thread_id: &str,
        title: Option<&str>,
        model: Option<&str>,
        pinned: Option<bool>,
        status: Option<&str>,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            if let Some(title) = title.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.title = Some(title.to_string());
            }
            if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.model = Some(model.to_string());
            }
            if let Some(pinned) = pinned {
                metadata.pinned = pinned;
            }
            if let Some(status) = status.map(str::trim).filter(|value| !value.is_empty()) {
                metadata.status = Some(status.to_string());
            }
            metadata.archived = false;
        })?;
        self.session_status(thread_id)?.ok_or_else(|| {
            DesktopSessionStoreError::Invalid(format!("Unknown desktop session: {thread_id}"))
        })
    }

    pub fn resolve_session_by_label(
        &self,
        label: &str,
    ) -> Result<Option<String>, DesktopSessionStoreError> {
        let needle = label.trim();
        if needle.is_empty() {
            return Ok(None);
        }
        Ok(self
            .list_summaries()?
            .into_iter()
            .find(|session| session.title == needle || session.key == needle)
            .map(|session| session.key))
    }

    pub fn reset_session(
        &self,
        thread_id: &str,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        if let Some(parent) = transcript_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to create desktop session directory: {error}"
                ))
            })?;
        }
        fs::write(&transcript_path, b"").map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to reset desktop session transcript: {error}"
            ))
        })?;
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.status = Some("idle".to_string());
            metadata.yielded = false;
            metadata.archived = false;
        })?;
        self.session_status(thread_id)?.ok_or_else(|| {
            DesktopSessionStoreError::Invalid(format!("Unknown desktop session: {thread_id}"))
        })
    }

    pub fn delete_session(&self, thread_id: &str) -> Result<bool, DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        let mut deleted = false;
        match fs::remove_file(&transcript_path) {
            Ok(()) => deleted = true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to delete desktop session transcript: {error}"
                )));
            }
        }
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.archived = true;
            metadata.pinned = false;
            metadata.status = Some("deleted".to_string());
        })?;
        Ok(deleted)
    }

    pub fn compact_session(
        &self,
        thread_id: &str,
        max_lines: usize,
    ) -> Result<(bool, usize), DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        let raw = match fs::read_to_string(&transcript_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((false, 0));
            }
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session transcript: {error}"
                )));
            }
        };
        let lines = raw
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if lines.len() <= max_lines {
            return Ok((false, lines.len()));
        }
        let start = lines.len().saturating_sub(max_lines);
        let kept = lines[start..].join("\n");
        fs::write(&transcript_path, format!("{kept}\n")).map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to compact desktop session transcript: {error}"
            ))
        })?;
        Ok((true, lines.len() - start))
    }

    pub fn list_summaries(&self) -> Result<Vec<DesktopSessionSummary>, DesktopSessionStoreError> {
        let metadata_by_thread = self.load_metadata_map()?;
        let mut summaries = Vec::new();
        for session in self.load_sessions()? {
            let metadata = metadata_by_thread.get(&session.thread_id);
            summaries.push(DesktopSessionSummary {
                key: session.thread_id.clone(),
                title: session.title,
                pinned: session.pinned,
                status: metadata
                    .map(|metadata| metadata.effective_status())
                    .unwrap_or_else(|| "idle".to_string()),
                message_count: session.result_items.len(),
                spawned_by: metadata.and_then(|metadata| metadata.spawned_by.clone()),
                yielded: metadata.map(|metadata| metadata.yielded).unwrap_or(false),
            });
        }
        Ok(summaries)
    }

    pub fn session_status(
        &self,
        thread_id: &str,
    ) -> Result<Option<DesktopSessionStatus>, DesktopSessionStoreError> {
        let Some(session) = self.load_session(thread_id)? else {
            return Ok(None);
        };
        let metadata_by_thread = self.load_metadata_map()?;
        let metadata = metadata_by_thread.get(thread_id);
        Ok(Some(DesktopSessionStatus {
            key: session.thread_id,
            title: session.title,
            pinned: session.pinned,
            status: metadata
                .map(|metadata| metadata.effective_status())
                .unwrap_or_else(|| "idle".to_string()),
            message_count: session.result_items.len(),
            spawned_by: metadata.and_then(|metadata| metadata.spawned_by.clone()),
            yielded: metadata.map(|metadata| metadata.yielded).unwrap_or(false),
        }))
    }

    pub fn session_history(
        &self,
        thread_id: &str,
    ) -> Result<Vec<DesktopSessionMessage>, DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        let raw = match fs::read_to_string(&transcript_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session transcript: {error}"
                )));
            }
        };
        Ok(parse_transcript_entries(&raw, &transcript_path)?
            .into_iter()
            .map(|entry| DesktopSessionMessage {
                role: entry.role,
                content: entry.content,
                source: entry.source,
            })
            .collect())
    }

    pub fn append_message(
        &self,
        thread_id: &str,
        role: &str,
        content: &str,
        source: Option<&str>,
    ) -> Result<(), DesktopSessionStoreError> {
        let transcript_path = self.transcript_path(thread_id)?;
        if let Some(parent) = transcript_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to create desktop session directory: {error}"
                ))
            })?;
        }
        let entry = DesktopTranscriptEntry {
            role: role.to_string(),
            content: content.to_string(),
            source: source.map(ToOwned::to_owned),
        };
        let mut transcript = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&transcript_path)
            .map_err(|error| {
                DesktopSessionStoreError::Io(format!(
                    "Failed to open desktop session transcript: {error}"
                ))
            })?;
        writeln!(
            transcript,
            "{}",
            serde_json::to_string(&entry).map_err(|error| {
                DesktopSessionStoreError::Invalid(format!(
                    "Failed to serialize desktop session message: {error}"
                ))
            })?
        )
        .map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to write desktop session transcript: {error}"
            ))
        })
    }

    pub fn send_to_session(
        &self,
        thread_id: &str,
        message: &str,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        self.append_message(thread_id, "user", message, Some("sessions_send"))?;
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.status = Some("pending".to_string());
            metadata.yielded = false;
        })?;
        self.session_status(thread_id)?
            .ok_or_else(|| DesktopSessionStoreError::Invalid("session was not created".to_string()))
    }

    pub fn spawn_session(
        &self,
        parent_thread_id: Option<&str>,
        label: Option<&str>,
        task: &str,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        let child_thread_id = format!("subagent-{}", now_millis());
        let title = label
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| title_from_transcript_text(task));
        self.append_message(&child_thread_id, "user", task, Some("sessions_spawn"))?;
        self.update_thread_metadata(&child_thread_id, |metadata| {
            metadata.title = Some(title);
            metadata.status = Some("spawned".to_string());
            metadata.spawned_by = parent_thread_id.map(ToOwned::to_owned);
            metadata.yielded = false;
        })?;
        self.session_status(&child_thread_id)?.ok_or_else(|| {
            DesktopSessionStoreError::Invalid("subagent session missing".to_string())
        })
    }

    pub fn mark_session_yielded(
        &self,
        thread_id: &str,
    ) -> Result<DesktopSessionStatus, DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.status = Some("yielded".to_string());
            metadata.yielded = true;
        })?;
        self.session_status(thread_id)?.ok_or_else(|| {
            DesktopSessionStoreError::Invalid(format!("Unknown desktop session: {thread_id}"))
        })
    }

    pub fn list_subagents(
        &self,
        parent_thread_id: Option<&str>,
    ) -> Result<Vec<DesktopSessionSummary>, DesktopSessionStoreError> {
        Ok(self
            .list_summaries()?
            .into_iter()
            .filter(
                |session| match (parent_thread_id, session.spawned_by.as_deref()) {
                    (Some(parent), Some(spawned_by)) => spawned_by == parent,
                    (Some(_), None) => false,
                    (None, Some(_)) => true,
                    (None, None) => false,
                },
            )
            .collect())
    }

    pub fn rename_thread(
        &self,
        thread_id: &str,
        title: &str,
    ) -> Result<(), DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.title = Some(title.to_string());
        })
    }

    pub fn set_thread_pinned(
        &self,
        thread_id: &str,
        pinned: bool,
    ) -> Result<(), DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.pinned = pinned;
        })
    }

    pub fn archive_thread(&self, thread_id: &str) -> Result<(), DesktopSessionStoreError> {
        self.update_thread_metadata(thread_id, |metadata| {
            metadata.archived = true;
            metadata.pinned = false;
        })
    }

    fn update_thread_metadata(
        &self,
        thread_id: &str,
        update: impl FnOnce(&mut DesktopSessionMetadataRecord),
    ) -> Result<(), DesktopSessionStoreError> {
        validate_thread_id(thread_id)?;
        let mut metadata_by_thread = self.load_metadata_map()?;
        let metadata = metadata_by_thread
            .entry(thread_id.to_string())
            .or_insert_with(|| DesktopSessionMetadataRecord {
                thread_id: thread_id.to_string(),
                ..DesktopSessionMetadataRecord::default()
            });
        update(metadata);
        self.save_metadata_map(metadata_by_thread)
    }

    fn transcript_path(&self, thread_id: &str) -> Result<PathBuf, DesktopSessionStoreError> {
        validate_thread_id(thread_id)?;
        Ok(self.sessions_dir.join(format!("{thread_id}.jsonl")))
    }

    fn load_metadata_map(
        &self,
    ) -> Result<BTreeMap<String, DesktopSessionMetadataRecord>, DesktopSessionStoreError> {
        let raw = match fs::read_to_string(&self.metadata_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new());
            }
            Err(error) => {
                return Err(DesktopSessionStoreError::Io(format!(
                    "Failed to read desktop session metadata: {error}"
                )));
            }
        };
        let metadata_file: DesktopSessionMetadataFile =
            serde_json::from_str(&raw).map_err(|error| {
                DesktopSessionStoreError::Invalid(format!(
                    "Invalid desktop session metadata: {error}"
                ))
            })?;
        Ok(metadata_file
            .threads
            .into_iter()
            .map(|metadata| (metadata.thread_id.clone(), metadata))
            .collect())
    }

    fn save_metadata_map(
        &self,
        metadata_by_thread: BTreeMap<String, DesktopSessionMetadataRecord>,
    ) -> Result<(), DesktopSessionStoreError> {
        fs::create_dir_all(&self.sessions_dir).map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to create desktop session metadata directory: {error}"
            ))
        })?;
        let metadata_file = DesktopSessionMetadataFile {
            threads: metadata_by_thread.into_values().collect(),
        };
        fs::write(
            &self.metadata_path,
            serde_json::to_vec_pretty(&metadata_file).map_err(|error| {
                DesktopSessionStoreError::Invalid(format!(
                    "Failed to serialize desktop session metadata: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            DesktopSessionStoreError::Io(format!(
                "Failed to write desktop session metadata: {error}"
            ))
        })
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopSessionMetadataFile {
    #[serde(default)]
    threads: Vec<DesktopSessionMetadataRecord>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopSessionMetadataRecord {
    #[serde(default)]
    thread_id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    spawned_by: Option<String>,
    #[serde(default)]
    yielded: bool,
    #[serde(default)]
    model: Option<String>,
}

impl DesktopSessionMetadataRecord {
    fn effective_status(&self) -> String {
        self.status
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("idle")
            .to_string()
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct DesktopTranscriptEntry {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

pub(super) fn parse_transcript_entries(
    raw: &str,
    path: &Path,
) -> Result<Vec<DesktopTranscriptEntry>, DesktopSessionStoreError> {
    raw.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            serde_json::from_str::<DesktopTranscriptEntry>(line).map_err(|error| {
                DesktopSessionStoreError::Invalid(format!(
                    "Invalid desktop session transcript at {}:{}: {error}",
                    path.display(),
                    index + 1
                ))
            })
        })
        .collect()
}

pub(super) fn parse_agent_runtime_history(
    raw: &str,
    path: &Path,
) -> Result<Vec<AgentRuntimeMessage>, AgentRuntimeError> {
    raw.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .filter_map(|(index, line)| {
            let entry = match serde_json::from_str::<DesktopTranscriptEntry>(line) {
                Ok(entry) => entry,
                Err(error) => {
                    return Some(Err(AgentRuntimeError::TranscriptFailed(format!(
                        "Invalid Rust session transcript at {}:{}: {error}",
                        path.display(),
                        index + 1
                    ))));
                }
            };
            let role = match entry.role.as_str() {
                "user" => AgentRuntimeMessageRole::User,
                "assistant" => AgentRuntimeMessageRole::Assistant,
                _ => return None,
            };
            Some(Ok(AgentRuntimeMessage {
                role,
                content: entry.content,
            }))
        })
        .collect()
}

pub(super) fn transcript_result_item(entry: DesktopTranscriptEntry) -> Option<String> {
    let content = entry.content.trim();
    if content.is_empty() {
        return None;
    }
    match entry.role.as_str() {
        "user" => Some(format!("用户: {content}")),
        "assistant" => Some(content.to_string()),
        role => Some(format!("{role}: {content}")),
    }
}

pub(super) fn transcript_message_record(
    entry: DesktopTranscriptEntry,
) -> Option<DesktopConversationMessageRecord> {
    let content = entry.content.trim();
    if content.is_empty() {
        return None;
    }
    let kind = match entry.role.as_str() {
        "user" => "user",
        "assistant" => "assistant",
        _ => "status",
    };
    Some(DesktopConversationMessageRecord {
        kind: kind.to_string(),
        text: content.to_string(),
        source: entry.source,
    })
}

pub(super) fn title_from_transcript_text(text: &str) -> String {
    let mut title = text.chars().take(32).collect::<String>();
    if text.chars().count() > 32 {
        title.push_str("...");
    }
    title
}

pub(super) fn validate_thread_id(thread_id: &str) -> Result<(), DesktopSessionStoreError> {
    let trimmed = thread_id.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed == "."
        || trimmed == ".."
    {
        return Err(DesktopSessionStoreError::Invalid(format!(
            "Invalid desktop session key: {thread_id}"
        )));
    }
    Ok(())
}

pub(super) fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

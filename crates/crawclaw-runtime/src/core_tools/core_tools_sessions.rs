use super::*;

#[derive(Clone, Copy)]
pub(super) enum SessionToolKind {
    Status,
    List,
    History,
    Send,
    Spawn,
    Yield,
    Subagents,
}

impl SessionToolKind {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Status => "session_status",
            Self::List => "sessions_list",
            Self::History => "sessions_history",
            Self::Send => "sessions_send",
            Self::Spawn => "sessions_spawn",
            Self::Yield => "sessions_yield",
            Self::Subagents => "subagents",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Status => "Return Rust-native status for a desktop session.",
            Self::List => "List Rust-native desktop sessions.",
            Self::History => "Read Rust-native desktop session history.",
            Self::Send => "Append a message into another Rust-native desktop session.",
            Self::Spawn => "Create a Rust-native child subagent session.",
            Self::Yield => "Mark the current Rust-native session as yielded.",
            Self::Subagents => "List Rust-native child subagent sessions.",
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::List | Self::Subagents => json!({
                "type": "object",
                "properties": {
                    "parentSessionKey": {
                        "type": "string",
                        "description": "Optional parent session key for subagent filtering."
                    }
                }
            }),
            Self::Status | Self::History | Self::Yield => json!({
                "type": "object",
                "properties": {
                    "sessionKey": {
                        "type": "string",
                        "description": "Session key. Defaults to main for status/yield."
                    }
                }
            }),
            Self::Send => json!({
                "type": "object",
                "properties": {
                    "sessionKey": {
                        "type": "string",
                        "description": "Target session key."
                    },
                    "message": {
                        "type": "string",
                        "description": "Message to send into the target session."
                    }
                },
                "required": ["sessionKey", "message"]
            }),
            Self::Spawn => json!({
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Task for the child subagent session."
                    },
                    "label": {
                        "type": "string",
                        "description": "Optional child session label."
                    },
                    "parentSessionKey": {
                        "type": "string",
                        "description": "Optional parent session key."
                    }
                },
                "required": ["task"]
            }),
        }
    }
}

#[derive(Clone)]
pub(super) struct SessionTool {
    runtime_root: PathBuf,
    kind: SessionToolKind,
}

impl SessionTool {
    pub(super) fn new(runtime_root: &Path, kind: SessionToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for SessionTool {
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
        let store = DesktopSessionStore::new(self.runtime_root.clone());
        let result = match self.kind {
            SessionToolKind::Status => {
                let session_key = session_key_param(&input).unwrap_or_else(|| "main".to_string());
                json!({
                    "status": "ok",
                    "session": store.session_status(&session_key).map_err(|error| session_tool_error(self.kind, error))?
                })
            }
            SessionToolKind::List => json!({
                "status": "ok",
                "sessions": store.list_summaries().map_err(|error| session_tool_error(self.kind, error))?
            }),
            SessionToolKind::History => {
                let session_key = required_param(self.kind, &input, &["sessionKey", "key"])?;
                json!({
                    "status": "ok",
                    "sessionKey": session_key,
                    "messages": store.session_history(&session_key).map_err(|error| session_tool_error(self.kind, error))?
                })
            }
            SessionToolKind::Send => {
                let session_key = required_param(self.kind, &input, &["sessionKey", "key"])?;
                let message = required_param(self.kind, &input, &["message", "text"])?;
                let session = store
                    .send_to_session(&session_key, &message)
                    .map_err(|error| session_tool_error(self.kind, error))?;
                json!({
                    "status": "sent",
                    "session": session
                })
            }
            SessionToolKind::Spawn => {
                let task = required_param(self.kind, &input, &["task", "message"])?;
                let label = string_param(&input, &["label"]);
                let parent = string_param(&input, &["parentSessionKey", "parent", "spawnedBy"]);
                let session = store
                    .spawn_session(parent.as_deref(), label.as_deref(), &task)
                    .map_err(|error| session_tool_error(self.kind, error))?;
                json!({
                    "status": "spawned",
                    "session": session
                })
            }
            SessionToolKind::Yield => {
                let session_key = session_key_param(&input).unwrap_or_else(|| "main".to_string());
                let session = store
                    .mark_session_yielded(&session_key)
                    .map_err(|error| session_tool_error(self.kind, error))?;
                json!({
                    "status": "yielded",
                    "session": session
                })
            }
            SessionToolKind::Subagents => {
                let parent = string_param(&input, &["parentSessionKey", "parent", "spawnedBy"]);
                json!({
                    "status": "ok",
                    "subagents": store.list_subagents(parent.as_deref()).map_err(|error| session_tool_error(self.kind, error))?
                })
            }
        };
        Ok(native_tool_output(result))
    }
}

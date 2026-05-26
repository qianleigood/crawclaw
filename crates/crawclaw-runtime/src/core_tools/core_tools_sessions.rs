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
            Self::Spawn => "subagents_spawn",
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
            Self::Spawn => "Create and optionally run a Rust-native child subagent session.",
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
                    },
                    "run": {
                        "type": "boolean",
                        "description": "When true or omitted, immediately run the child subagent."
                    }
                },
                "required": ["task"]
            }),
        }
    }
}

fn session_tool_now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
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
                let parent =
                    string_param(&input, &["parentSessionKey", "parent", "spawnedBy"])
                        .unwrap_or_else(|| "main".to_string());
                let session = store
                    .spawn_session(Some(&parent), label.as_deref(), &task)
                    .map_err(|error| session_tool_error(self.kind, error))?;
                if input.get("run").and_then(Value::as_bool) != Some(false) {
                    let running_session = store
                        .patch_session(&session.key, None, None, None, Some("running"))
                        .map_err(|error| session_tool_error(self.kind, error))?;
                    let run_id = format!("subagent-run-{}", session_tool_now_millis());
                    let result = match AgentRuntime::new(self.runtime_root.clone())
                        .run_turn(AgentRunRequest {
                            run_id: run_id.clone(),
                            agent_id: "subagent".to_string(),
                            session_key: running_session.key.clone(),
                            inbound: ChannelInboundEnvelope {
                                channel: "subagent".to_string(),
                                account_id: Some("rust-runtime".to_string()),
                                from: parent,
                                to: "agent:subagent".to_string(),
                                chat_type: ChannelChatType::Direct,
                                body: task,
                                raw_body: None,
                                message_id: Some(format!("{run_id}:input")),
                                thread_id: Some(session.key.clone()),
                                media_urls: Vec::new(),
                                metadata: BTreeMap::new(),
                            },
                            model: AgentModelSelection {
                                provider: "configured".to_string(),
                                model: "configured".to_string(),
                                reasoning_level: None,
                            },
                            enabled_tools: Vec::new(),
                            profile: Some(AgentRunProfileRequest {
                                kind: AgentRunProfileKind::Subagent,
                                special_agent: None,
                                memory_after_turn: Some(true),
                            }),
                            options: BTreeMap::new(),
                        })
                        .await
                    {
                        Ok(result) => result,
                        Err(error) => {
                            let _ = store.patch_session(
                                &running_session.key,
                                None,
                                None,
                                None,
                                Some("failed"),
                            );
                            return Err(session_tool_error(
                                self.kind,
                                format!("subagent runtime failed: {}", error.message()),
                            ));
                        }
                    };
                    let completed_session = store
                        .patch_session(&running_session.key, None, None, None, Some("completed"))
                        .map_err(|error| session_tool_error(self.kind, error))?;
                    json!({
                        "status": "completed",
                        "session": completed_session,
                        "runId": result.run_id,
                        "assistantText": result.assistant_text
                    })
                } else {
                json!({
                    "status": "spawned",
                    "session": session
                })
                }
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

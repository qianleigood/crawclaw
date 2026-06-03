use super::*;

#[derive(Clone, Copy)]
pub(super) enum SessionToolKind {
    Status,
    List,
    History,
    Send,
    SendMessage,
    TeamCreate,
    TeamDelete,
    Agent,
    Task,
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
            Self::SendMessage => "SendMessage",
            Self::TeamCreate => "TeamCreate",
            Self::TeamDelete => "TeamDelete",
            Self::Agent => "Agent",
            Self::Task => "Task",
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
            Self::SendMessage => "Send a message to another agent",
            Self::TeamCreate => "Create a new team for coordinating multiple agents",
            Self::TeamDelete => "Clean up team and task directories when the swarm is complete",
            Self::Agent => "Launch a new agent",
            Self::Task => "Launch a new agent",
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
            Self::SendMessage => json!({
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "Recipient: teammate name, or \"*\" for broadcast to all teammates"
                    },
                    "summary": {
                        "type": "string",
                        "description": "A 5-10 word summary shown as a preview in the UI (required when message is a string)"
                    },
                    "message": {
                        "description": "Plain text message content or structured message"
                    }
                },
                "required": ["to", "message"],
                "additionalProperties": false
            }),
            Self::TeamCreate => json!({
                "type": "object",
                "properties": {
                    "team_name": {
                        "type": "string",
                        "description": "Name for the new team to create."
                    },
                    "description": {
                        "type": "string",
                        "description": "Team description/purpose."
                    },
                    "agent_type": {
                        "type": "string",
                        "description": "Type/role of the team lead (e.g., \"researcher\", \"test-runner\"). Used for team file and inter-agent coordination."
                    }
                },
                "required": ["team_name"],
                "additionalProperties": false
            }),
            Self::TeamDelete => json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            Self::Agent | Self::Task => json!({
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "A short (3-5 word) description of the task"
                    },
                    "prompt": {
                        "type": "string",
                        "description": "The task for the agent to perform"
                    },
                    "subagent_type": {
                        "type": "string",
                        "description": "The type of specialized agent to use for this task"
                    },
                    "model": {
                        "type": "string",
                        "enum": ["sonnet", "opus", "haiku", "inherit"],
                        "description": "Optional model override for this agent. Takes precedence over the agent definition's model frontmatter. If omitted, uses the agent definition's model, or inherits from the parent."
                    },
                    "run_in_background": {
                        "type": "boolean",
                        "description": "Set to true to run this agent in the background. You will be notified when it completes."
                    },
                    "name": {
                        "type": "string",
                        "description": "Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running."
                    },
                    "team_name": {
                        "type": "string",
                        "description": "Team name for spawning. Uses current team context if omitted."
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan", "auto"],
                        "description": "Permission mode for spawned teammate (e.g., \"plan\" to require plan approval)."
                    },
                    "permissionMode": {
                        "type": "string",
                        "enum": ["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan", "auto", "readOnly", "workspace", "fullAccess"],
                        "description": "Agent definition permission mode. Defaults to the selected agent definition."
                    },
                    "mcpServers": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional MCP server names required by this agent definition."
                    },
                    "isolation": {
                        "type": "string",
                        "enum": ["worktree"],
                        "description": "Isolation mode. \"worktree\" creates a temporary git worktree so the agent works on an isolated copy of the repo."
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Absolute path to run the agent in. Overrides the working directory for all filesystem and shell operations within this agent. Mutually exclusive with isolation: \"worktree\"."
                    }
                },
                "required": ["description", "prompt"],
                "additionalProperties": false
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

fn runtime_agent_abort_handles() -> &'static Mutex<HashMap<String, tokio::task::AbortHandle>> {
    static HANDLES: OnceLock<Mutex<HashMap<String, tokio::task::AbortHandle>>> = OnceLock::new();
    HANDLES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn abort_runtime_agent_task(session_key: &str) -> bool {
    let handle = runtime_agent_abort_handles()
        .lock()
        .expect("runtime agent abort handle map")
        .remove(session_key);
    if let Some(handle) = handle {
        handle.abort();
        return true;
    }
    false
}

fn register_runtime_agent_task(session_key: &str, abort_handle: tokio::task::AbortHandle) {
    runtime_agent_abort_handles()
        .lock()
        .expect("runtime agent abort handle map")
        .insert(session_key.to_string(), abort_handle);
}

fn unregister_runtime_agent_task(session_key: &str) {
    runtime_agent_abort_handles()
        .lock()
        .expect("runtime agent abort handle map")
        .remove(session_key);
}

fn session_tool_is_agent_alias(kind: SessionToolKind) -> bool {
    matches!(kind, SessionToolKind::Agent | SessionToolKind::Task)
}

fn subagent_prompt_param(kind: SessionToolKind, input: &Value) -> pi::sdk::Result<String> {
    if session_tool_is_agent_alias(kind) {
        required_param(kind, input, &["prompt", "task", "message"])
    } else {
        required_param(kind, input, &["task", "message", "prompt"])
    }
}

fn subagent_label_param(input: &Value, task: &str) -> Option<String> {
    string_param(input, &["name", "label", "title", "description"])
        .or_else(|| string_param(input, &["subagent_type", "subagentType", "agentType"]))
        .or_else(|| {
            let label = task
                .split_whitespace()
                .take(5)
                .collect::<Vec<_>>()
                .join(" ");
            (!label.is_empty()).then_some(label)
        })
}

fn subagent_model_selection(input: &Value) -> AgentModelSelection {
    let model = input
        .get("model")
        .and_then(|value| {
            value.as_str().map(str::to_string).or_else(|| {
                value
                    .as_object()
                    .and_then(|object| object.get("model"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
        })
        .or_else(|| string_param(input, &["modelId"]))
        .unwrap_or_else(|| "configured".to_string());
    let provider = input
        .get("model")
        .and_then(Value::as_object)
        .and_then(|object| object.get("provider"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| string_param(input, &["provider"]))
        .unwrap_or_else(|| "configured".to_string());
    AgentModelSelection {
        provider,
        model,
        reasoning_level: string_param(input, &["reasoningLevel", "thinking"]),
    }
}

fn string_array_input(input: &Value, key: &str) -> Option<Vec<String>> {
    let values = input.get(key)?.as_array()?;
    let out = values
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    (!out.is_empty()).then_some(out)
}

fn subagent_enabled_tools(input: &Value) -> Vec<String> {
    string_array_input(input, "enabledTools")
        .or_else(|| string_array_input(input, "allowedTools"))
        .or_else(|| {
            input
                .get("options")
                .and_then(|options| string_array_input(options, "enabledTools"))
        })
        .or_else(|| {
            input
                .get("options")
                .and_then(|options| string_array_input(options, "allowedTools"))
        })
        .unwrap_or_default()
}

fn subagent_run_options(input: &Value) -> BTreeMap<String, Value> {
    let mut options = input
        .get("options")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    for key in [
        "systemPrompt",
        "system_prompt",
        "subagent_type",
        "subagentType",
        "agentType",
        "description",
        "name",
        "team_name",
        "teamName",
        "mode",
        "permissionMode",
        "permission_mode",
        "mcpServers",
        "parentContextPolicy",
    ] {
        if let Some(value) = input.get(key) {
            options
                .entry(key.to_string())
                .or_insert_with(|| value.clone());
        }
    }
    options
}

fn subagent_run_request(
    run_id: String,
    session_key: String,
    parent: String,
    task: String,
    input: &Value,
) -> AgentRunRequest {
    let mut metadata = BTreeMap::new();
    metadata.insert("parentSessionKey".to_string(), json!(parent.clone()));
    if input.get("fork").and_then(Value::as_bool) == Some(true) {
        metadata.insert(
            "parentContextPolicy".to_string(),
            json!("fork_messages_only"),
        );
    } else if let Some(policy) = string_param(input, &["parentContextPolicy"]) {
        metadata.insert("parentContextPolicy".to_string(), json!(policy));
    }
    if let Some(agent_type) = string_param(input, &["subagent_type", "subagentType", "agentType"]) {
        metadata.insert("agentType".to_string(), json!(agent_type));
    }
    if let Some(name) = string_param(input, &["name"]) {
        metadata.insert("name".to_string(), json!(name));
    }
    if let Some(team_name) = string_param(input, &["team_name", "teamName"]) {
        metadata.insert("teamName".to_string(), json!(team_name));
    }
    if let Some(mode) = string_param(input, &["mode"]) {
        metadata.insert("mode".to_string(), json!(mode));
    }
    AgentRunRequest {
        run_id: run_id.clone(),
        agent_id: string_param(input, &["agentId", "subagent_type", "subagentType"])
            .unwrap_or_else(|| "subagent".to_string()),
        session_key: session_key.clone(),
        inbound: ChannelInboundEnvelope {
            channel: "subagent".to_string(),
            account_id: Some("rust-runtime".to_string()),
            from: parent,
            to: "agent:subagent".to_string(),
            chat_type: ChannelChatType::Direct,
            body: task,
            raw_body: None,
            message_id: Some(format!("{run_id}:input")),
            thread_id: Some(session_key),
            media_urls: Vec::new(),
            metadata,
        },
        model: subagent_model_selection(input),
        enabled_tools: subagent_enabled_tools(input),
        profile: Some(AgentRunProfileRequest {
            kind: AgentRunProfileKind::Subagent,
            special_agent: None,
            memory_after_turn: Some(true),
        }),
        options: subagent_run_options(input),
    }
}

enum SendMessageContent {
    Plain(String),
    Structured {
        kind: &'static str,
        text: String,
        request_id: Option<String>,
        approve: Option<bool>,
    },
}

impl SendMessageContent {
    fn as_str(&self) -> &str {
        match self {
            Self::Plain(message) => message,
            Self::Structured { text, .. } => text,
        }
    }

    fn is_plain(&self) -> bool {
        matches!(self, Self::Plain(_))
    }

    fn is_structured(&self) -> bool {
        matches!(self, Self::Structured { .. })
    }

    fn request_id(&self) -> Option<&str> {
        match self {
            Self::Structured {
                request_id: Some(request_id),
                ..
            } => Some(request_id),
            _ => None,
        }
    }

    fn kind(&self) -> Option<&'static str> {
        match self {
            Self::Structured { kind, .. } => Some(*kind),
            _ => None,
        }
    }

    fn approve(&self) -> Option<bool> {
        match self {
            Self::Structured { approve, .. } => *approve,
            _ => None,
        }
    }
}

fn send_message_required_string(object: &Map<String, Value>, key: &str) -> pi::sdk::Result<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| pi::sdk::Error::validation(format!("SendMessage message.{key} is required")))
}

fn send_message_optional_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn send_message_required_semantic_bool(
    object: &Map<String, Value>,
    key: &str,
) -> pi::sdk::Result<bool> {
    let Some(value) = object.get(key) else {
        return Err(pi::sdk::Error::validation(format!(
            "SendMessage message.{key} is required"
        )));
    };
    if let Some(boolean) = value.as_bool() {
        return Ok(boolean);
    }
    if let Some(text) = value.as_str() {
        return match text {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err(pi::sdk::Error::validation(format!(
                "SendMessage message.{key} must be true or false."
            ))),
        };
    }
    Err(pi::sdk::Error::validation(format!(
        "SendMessage message.{key} must be true or false."
    )))
}

fn send_message_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn send_message_json_text(object: Map<String, Value>) -> pi::sdk::Result<String> {
    serde_json::to_string(&Value::Object(object)).map_err(|error| {
        pi::sdk::Error::validation(format!("SendMessage message must be serializable: {error}"))
    })
}

fn send_message_structured_content(
    target: &str,
    object: &Map<String, Value>,
) -> pi::sdk::Result<SendMessageContent> {
    let Some(message_type) = object.get("type").and_then(Value::as_str) else {
        return Err(pi::sdk::Error::validation(
            "SendMessage structured message requires type".to_string(),
        ));
    };
    match message_type {
        "shutdown_request" => {
            let request_id = format!("shutdown-{}@{}", session_tool_now_millis(), target);
            let reason = send_message_optional_string(object, "reason");
            let mut message = Map::new();
            message.insert(
                "type".to_string(),
                Value::String("shutdown_request".to_string()),
            );
            message.insert("requestId".to_string(), Value::String(request_id.clone()));
            message.insert("from".to_string(), Value::String("team-lead".to_string()));
            if let Some(reason) = reason {
                message.insert("reason".to_string(), Value::String(reason));
            }
            message.insert(
                "timestamp".to_string(),
                Value::String(send_message_timestamp()),
            );
            let text = send_message_json_text(message)?;
            Ok(SendMessageContent::Structured {
                kind: "shutdown_request",
                text,
                request_id: Some(request_id),
                approve: None,
            })
        }
        "shutdown_response" => {
            let request_id = send_message_required_string(object, "request_id")?;
            let approve = send_message_required_semantic_bool(object, "approve")?;
            let reason = send_message_optional_string(object, "reason");
            if !approve && reason.is_none() {
                return Err(pi::sdk::Error::validation(
                    "reason is required when rejecting a shutdown request".to_string(),
                ));
            }
            let mut message = Map::new();
            message.insert(
                "type".to_string(),
                Value::String(if approve {
                    "shutdown_approved".to_string()
                } else {
                    "shutdown_rejected".to_string()
                }),
            );
            message.insert("requestId".to_string(), Value::String(request_id.clone()));
            message.insert("from".to_string(), Value::String("teammate".to_string()));
            if let Some(reason) = reason {
                message.insert("reason".to_string(), Value::String(reason));
            }
            message.insert(
                "timestamp".to_string(),
                Value::String(send_message_timestamp()),
            );
            let text = send_message_json_text(message)?;
            Ok(SendMessageContent::Structured {
                kind: "shutdown_response",
                text,
                request_id: Some(request_id),
                approve: Some(approve),
            })
        }
        "plan_approval_response" => {
            let request_id = send_message_required_string(object, "request_id")?;
            let approve = send_message_required_semantic_bool(object, "approve")?;
            let feedback = send_message_optional_string(object, "feedback")
                .or_else(|| (!approve).then_some("Plan needs revision".to_string()));
            let mut message = Map::new();
            message.insert(
                "type".to_string(),
                Value::String("plan_approval_response".to_string()),
            );
            message.insert("requestId".to_string(), Value::String(request_id.clone()));
            message.insert("approved".to_string(), Value::Bool(approve));
            if let Some(feedback) = feedback {
                message.insert("feedback".to_string(), Value::String(feedback));
            }
            message.insert(
                "timestamp".to_string(),
                Value::String(send_message_timestamp()),
            );
            let text = send_message_json_text(message)?;
            Ok(SendMessageContent::Structured {
                kind: "plan_approval_response",
                text,
                request_id: Some(request_id),
                approve: Some(approve),
            })
        }
        _ => Err(pi::sdk::Error::validation(format!(
            "SendMessage unsupported structured message type: {message_type}"
        ))),
    }
}

fn send_message_content(input: &Value) -> pi::sdk::Result<SendMessageContent> {
    let target = required_tool_param("SendMessage", input, &["to"])?;
    match input.get("message") {
        Some(Value::String(message)) if !message.trim().is_empty() => {
            Ok(SendMessageContent::Plain(message.trim().to_string()))
        }
        Some(Value::String(_)) | None => Err(pi::sdk::Error::validation(
            "SendMessage requires message".to_string(),
        )),
        Some(Value::Object(object)) => send_message_structured_content(&target, object),
        Some(_) => Err(pi::sdk::Error::validation(
            "SendMessage message must be a string or structured object".to_string(),
        )),
    }
}

fn normalize_send_message_target(target: &str) -> String {
    target.trim().trim_start_matches('@').trim().to_string()
}

enum TeamRecipientResolution {
    NoActiveTeam,
    Found(String),
    NotFound,
    Ambiguous,
}

fn resolve_active_team_recipient_session(
    runtime_root: &Path,
    target: &str,
) -> pi::sdk::Result<TeamRecipientResolution> {
    let Some(team) = active_team(runtime_root)? else {
        return Ok(TeamRecipientResolution::NoActiveTeam);
    };
    let target_lower = target.to_lowercase();
    let members = team
        .get("members")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let matches = members
        .into_iter()
        .filter(|member| {
            ["name", "agentId", "sessionKey"].iter().any(|key| {
                member
                    .get(*key)
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.to_lowercase() == target_lower)
            })
        })
        .filter_map(|member| {
            member
                .get("sessionKey")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<BTreeSet<_>>();
    match matches.len() {
        0 => Ok(TeamRecipientResolution::NotFound),
        1 => Ok(TeamRecipientResolution::Found(
            matches.into_iter().next().unwrap_or_default(),
        )),
        _ => Ok(TeamRecipientResolution::Ambiguous),
    }
}

fn resolve_send_message_session(
    runtime_root: &Path,
    store: &DesktopSessionStore,
    target: &str,
) -> pi::sdk::Result<String> {
    let target = normalize_send_message_target(target);
    if target.is_empty() {
        return Err(pi::sdk::Error::validation("SendMessage requires to"));
    }
    if target.eq_ignore_ascii_case("team-lead") {
        return Ok("main".to_string());
    }
    match resolve_active_team_recipient_session(runtime_root, &target)? {
        TeamRecipientResolution::Found(session_key) => return Ok(session_key),
        TeamRecipientResolution::NotFound => {
            return Err(pi::sdk::Error::validation(format!(
                "SendMessage target not found in active team: {target}"
            )));
        }
        TeamRecipientResolution::Ambiguous => {
            return Err(pi::sdk::Error::validation(format!(
                "SendMessage target is ambiguous in active team: {target}"
            )));
        }
        TeamRecipientResolution::NoActiveTeam => {}
    }
    if store
        .session_status(&target)
        .map_err(|error| tool_error("SendMessage", error.to_string()))?
        .is_some()
    {
        return Ok(target);
    }
    let target_lower = target.to_lowercase();
    let matches = store
        .list_summaries()
        .map_err(|error| tool_error("SendMessage", error.to_string()))?
        .into_iter()
        .filter(|summary| {
            summary.key.to_lowercase() == target_lower
                || summary.title.to_lowercase() == target_lower
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [summary] => Ok(summary.key.clone()),
        [] => Err(pi::sdk::Error::validation(format!(
            "SendMessage target not found: {target}"
        ))),
        _ => Err(pi::sdk::Error::validation(format!(
            "SendMessage target is ambiguous: {target}"
        ))),
    }
}

fn send_message_structured_output_message(payload: &SendMessageContent, target: &str) -> String {
    match (payload.kind(), payload.approve(), payload.request_id()) {
        (Some("shutdown_request"), _, Some(request_id)) => {
            format!("Shutdown request sent to {target}. Request ID: {request_id}")
        }
        (Some("shutdown_response"), Some(true), Some(request_id)) => {
            format!("Shutdown approved. Sent confirmation to team-lead. Request ID: {request_id}")
        }
        (Some("shutdown_response"), Some(false), Some(request_id)) => {
            format!("Shutdown rejected. Request ID: {request_id}")
        }
        (Some("plan_approval_response"), Some(true), Some(request_id)) => {
            format!("Plan approved for {target}. Request ID: {request_id}")
        }
        (Some("plan_approval_response"), Some(false), Some(request_id)) => {
            format!("Plan rejected for {target}. Request ID: {request_id}")
        }
        _ => format!("Message sent to {target}"),
    }
}

fn send_message_broadcast(
    runtime_root: &Path,
    store: &DesktopSessionStore,
    message: &str,
) -> pi::sdk::Result<Vec<String>> {
    let recipients = active_team_broadcast_recipients(runtime_root)?.ok_or_else(|| {
        pi::sdk::Error::validation(
            "Not in a team context. Create a team with TeamCreate first.".to_string(),
        )
    })?;
    for recipient in &recipients {
        store
            .send_to_session(&recipient.session_key, message)
            .map_err(|error| tool_error("SendMessage", error.to_string()))?;
    }
    Ok(recipients
        .into_iter()
        .map(|recipient| recipient.name)
        .collect())
}

fn teams_dir(runtime_root: &Path) -> PathBuf {
    runtime_root.join("teams")
}

fn active_team_path(runtime_root: &Path) -> PathBuf {
    teams_dir(runtime_root).join("active.json")
}

fn sanitize_team_name(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

fn sanitize_agent_name(input: &str) -> String {
    input.replace('@', "-")
}

fn format_team_agent_id(agent_name: &str, team_name: &str) -> String {
    format!("{}@{team_name}", sanitize_agent_name(agent_name))
}

fn team_manifest_path(runtime_root: &Path, team_name: &str) -> PathBuf {
    teams_dir(runtime_root).join(format!("{}.json", sanitize_team_name(team_name)))
}

fn unique_team_name(runtime_root: &Path, requested_name: &str) -> String {
    if !team_manifest_path(runtime_root, requested_name).exists() {
        return requested_name.to_string();
    }
    let now = session_tool_now_millis();
    for suffix in 0..1000 {
        let candidate = if suffix == 0 {
            format!("team-{now}")
        } else {
            format!("team-{now}-{suffix}")
        };
        if !team_manifest_path(runtime_root, &candidate).exists() {
            return candidate;
        }
    }
    format!("team-{}-{now}", session_tool_now_millis())
}

fn write_team_json(path: &Path, value: &Value) -> pi::sdk::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| pi::sdk::Error::tool("TeamCreate", error.to_string()))?;
    }
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| pi::sdk::Error::tool("TeamCreate", error.to_string()))?;
    fs::write(path, raw).map_err(|error| pi::sdk::Error::tool("TeamCreate", error.to_string()))
}

fn read_team_json(path: &Path, tool: &str) -> pi::sdk::Result<Option<Value>> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|error| pi::sdk::Error::tool(tool, error.to_string())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(pi::sdk::Error::tool(tool, error.to_string())),
    }
}

fn active_team(runtime_root: &Path) -> pi::sdk::Result<Option<Value>> {
    let Some(active) = read_team_json(&active_team_path(runtime_root), "TeamCreate")? else {
        return Ok(None);
    };
    let Some(path) = active.get("path").and_then(Value::as_str) else {
        return Ok(None);
    };
    read_team_json(Path::new(path), "TeamCreate")
}

fn active_team_name(runtime_root: &Path) -> pi::sdk::Result<Option<String>> {
    Ok(active_team(runtime_root)?.and_then(|team| {
        team.get("name")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    }))
}

struct BroadcastRecipient {
    session_key: String,
    name: String,
}

fn active_team_broadcast_recipients(
    runtime_root: &Path,
) -> pi::sdk::Result<Option<Vec<BroadcastRecipient>>> {
    let Some(team) = active_team(runtime_root)? else {
        return Ok(None);
    };
    let members = team
        .get("members")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(Some(
        members
            .into_iter()
            .filter_map(|member| {
                let session_key = member
                    .get("sessionKey")
                    .and_then(Value::as_str)
                    .filter(|key| *key != "main")?;
                let name = member
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.eq_ignore_ascii_case("team-lead"))
                    .unwrap_or(session_key);
                Some(BroadcastRecipient {
                    session_key: session_key.to_string(),
                    name: name.to_string(),
                })
            })
            .collect(),
    ))
}

fn add_session_to_team(
    runtime_root: &Path,
    requested_team_name: Option<&str>,
    session_key: &str,
    name: Option<&str>,
    agent_type: Option<&str>,
) -> pi::sdk::Result<()> {
    let mut team = if let Some(requested_team_name) = requested_team_name {
        let path = team_manifest_path(runtime_root, requested_team_name);
        read_team_json(&path, "Agent")?.ok_or_else(|| {
            pi::sdk::Error::validation(format!("Team \"{requested_team_name}\" does not exist."))
        })?
    } else {
        let Some(team) = active_team(runtime_root)? else {
            return Ok(());
        };
        team
    };
    let Some(team_name) = team.get("name").and_then(Value::as_str).map(str::to_string) else {
        return Ok(());
    };
    let Some(object) = team.as_object_mut() else {
        return Ok(());
    };
    let members = object
        .entry("members".to_string())
        .or_insert_with(|| json!([]));
    let Some(members) = members.as_array_mut() else {
        return Ok(());
    };
    if members
        .iter()
        .any(|member| member.get("sessionKey").and_then(Value::as_str) == Some(session_key))
    {
        return Ok(());
    }
    let member_name = name.unwrap_or(session_key);
    let joined_at = session_tool_now_millis();
    members.push(json!({
        "agentId": format_team_agent_id(member_name, &team_name),
        "sessionKey": session_key,
        "name": member_name,
        "agentType": agent_type.unwrap_or("subagent"),
        "isActive": true,
        "joinedAt": joined_at,
        "joinedAtMs": joined_at,
        "tmuxPaneId": "",
        "cwd": runtime_root.to_string_lossy(),
        "subscriptions": []
    }));
    let path = team_manifest_path(runtime_root, &team_name);
    write_team_json(&path, &team)
}

fn set_team_member_active(
    runtime_root: &Path,
    session_key: &str,
    is_active: bool,
) -> Result<(), String> {
    if let Some(team) = active_team(runtime_root).map_err(|error| error.to_string())? {
        if let Some(team_name) = team.get("name").and_then(Value::as_str) {
            let path = team_manifest_path(runtime_root, team_name);
            if update_team_member_active(&path, team, session_key, is_active)? {
                return Ok(());
            }
        }
    }
    let teams = match fs::read_dir(teams_dir(runtime_root)) {
        Ok(teams) => teams,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    for entry in teams.flatten() {
        let path = entry.path();
        if path.file_name().and_then(|name| name.to_str()) == Some("active.json") {
            continue;
        }
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        if let Some(team) =
            read_team_json(&path, "TeamCreate").map_err(|error| error.to_string())?
        {
            if update_team_member_active(&path, team, session_key, is_active)? {
                return Ok(());
            }
        }
    }
    Ok(())
}

fn update_team_member_active(
    path: &Path,
    mut team: Value,
    session_key: &str,
    is_active: bool,
) -> Result<bool, String> {
    let Some(members) = team.get_mut("members").and_then(Value::as_array_mut) else {
        return Ok(false);
    };
    let mut changed = false;
    for member in members {
        if member.get("sessionKey").and_then(Value::as_str) == Some(session_key) {
            if let Some(member) = member.as_object_mut() {
                member.insert("isActive".to_string(), Value::Bool(is_active));
                changed = true;
            }
        }
    }
    if changed {
        write_team_json(path, &team).map_err(|error| error.to_string())?;
    }
    Ok(changed)
}

fn active_non_lead_members(team: &Value) -> Vec<String> {
    let lead_agent_id = team.get("leadAgentId").and_then(Value::as_str);
    team.get("members")
        .and_then(Value::as_array)
        .map(|members| {
            members
                .iter()
                .filter(|member| {
                    let is_lead = member
                        .get("name")
                        .and_then(Value::as_str)
                        .is_some_and(|name| name == "team-lead")
                        || member
                            .get("agentId")
                            .and_then(Value::as_str)
                            .is_some_and(|agent_id| Some(agent_id) == lead_agent_id)
                        || member
                            .get("sessionKey")
                            .and_then(Value::as_str)
                            .is_some_and(|key| key == "main");
                    !is_lead
                        && member
                            .get("isActive")
                            .and_then(Value::as_bool)
                            .unwrap_or(true)
                })
                .map(|member| {
                    member
                        .get("name")
                        .or_else(|| member.get("sessionKey"))
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn require_session_tool_keys(
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

fn validate_agent_alias_input(kind: SessionToolKind, input: &Value) -> pi::sdk::Result<()> {
    require_session_tool_keys(
        input,
        &[
            "description",
            "prompt",
            "subagent_type",
            "model",
            "run_in_background",
            "name",
            "team_name",
            "mode",
            "permissionMode",
            "permission_mode",
            "mcpServers",
        ],
        kind.name(),
    )?;
    let _ = required_param(kind, input, &["description"])?;
    let _ = required_param(kind, input, &["prompt"])?;
    for key in ["subagent_type", "name", "team_name"] {
        if input.get(key).is_some_and(|value| !value.is_string()) {
            return Err(pi::sdk::Error::validation(format!(
                "{} {key} must be a string",
                kind.name()
            )));
        }
    }
    if let Some(model) = input.get("model") {
        let Some(model) = model.as_str() else {
            return Err(pi::sdk::Error::validation(format!(
                "{} model must be a string",
                kind.name()
            )));
        };
        if !matches!(model, "sonnet" | "opus" | "haiku" | "inherit") {
            return Err(pi::sdk::Error::validation(format!(
                "{} model must be sonnet, opus, haiku, or inherit",
                kind.name()
            )));
        }
    }
    if input
        .get("run_in_background")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err(pi::sdk::Error::validation(format!(
            "{} run_in_background must be a boolean",
            kind.name()
        )));
    }
    if let Some(mode) = input.get("mode") {
        let Some(mode) = mode.as_str() else {
            return Err(pi::sdk::Error::validation(format!(
                "{} mode must be a string",
                kind.name()
            )));
        };
        if !matches!(
            mode,
            "acceptEdits" | "bypassPermissions" | "default" | "dontAsk" | "plan" | "auto"
        ) {
            return Err(pi::sdk::Error::validation(format!(
                "{} mode must be acceptEdits, bypassPermissions, default, dontAsk, plan, or auto",
                kind.name()
            )));
        }
    }
    if let Some(permission_mode) = input
        .get("permissionMode")
        .or_else(|| input.get("permission_mode"))
    {
        let Some(permission_mode) = permission_mode.as_str() else {
            return Err(pi::sdk::Error::validation(format!(
                "{} permissionMode must be a string",
                kind.name()
            )));
        };
        if !matches!(
            permission_mode,
            "acceptEdits"
                | "bypassPermissions"
                | "default"
                | "dontAsk"
                | "plan"
                | "auto"
                | "readOnly"
                | "workspace"
                | "fullAccess"
        ) {
            return Err(pi::sdk::Error::validation(format!(
                "{} permissionMode must be acceptEdits, bypassPermissions, default, dontAsk, plan, auto, readOnly, workspace, or fullAccess",
                kind.name()
            )));
        }
    }
    if let Some(mcp_servers) = input.get("mcpServers") {
        let Some(mcp_servers) = mcp_servers.as_array() else {
            return Err(pi::sdk::Error::validation(format!(
                "{} mcpServers must be an array",
                kind.name()
            )));
        };
        if mcp_servers.iter().any(|value| !value.is_string()) {
            return Err(pi::sdk::Error::validation(format!(
                "{} mcpServers entries must be strings",
                kind.name()
            )));
        }
    }
    Ok(())
}

fn create_team(runtime_root: &Path, input: &Value) -> pi::sdk::Result<Value> {
    require_session_tool_keys(
        input,
        &["team_name", "description", "agent_type"],
        "TeamCreate",
    )?;
    let requested_name = required_tool_param("TeamCreate", input, &["team_name"])?;
    if let Some(existing) = active_team_name(runtime_root)? {
        return Err(pi::sdk::Error::validation(format!(
            "Already leading team \"{existing}\". A leader can only manage one team at a time. Use TeamDelete to end the current team before creating a new one."
        )));
    }
    let team_name = unique_team_name(runtime_root, &requested_name);
    let path = team_manifest_path(runtime_root, &team_name);
    let lead_agent_type =
        string_param(input, &["agent_type"]).unwrap_or_else(|| "team-lead".to_string());
    let lead_agent_id = format_team_agent_id("team-lead", &team_name);
    let created_at = session_tool_now_millis();
    let team = json!({
        "name": team_name,
        "description": string_param(input, &["description"]),
        "createdAt": created_at,
        "createdAtMs": created_at,
        "leadAgentId": lead_agent_id,
        "leadSessionId": "main",
        "members": [{
            "agentId": lead_agent_id,
            "sessionKey": "main",
            "name": "team-lead",
            "agentType": lead_agent_type,
            "joinedAt": created_at,
            "joinedAtMs": created_at,
            "tmuxPaneId": "",
            "cwd": runtime_root.to_string_lossy(),
            "subscriptions": []
        }]
    });
    write_team_json(&path, &team)?;
    write_team_json(
        &active_team_path(runtime_root),
        &json!({
            "name": team_name,
            "path": path.to_string_lossy()
        }),
    )?;
    Ok(json!({
        "team_name": team_name,
        "team_file_path": path.to_string_lossy(),
        "lead_agent_id": lead_agent_id,
        "team": team
    }))
}

fn delete_team(runtime_root: &Path, input: &Value) -> pi::sdk::Result<Value> {
    let Some(input) = input.as_object() else {
        return Err(pi::sdk::Error::validation(
            "TeamDelete input must be an object".to_string(),
        ));
    };
    if !input.is_empty() {
        return Err(pi::sdk::Error::validation(
            "TeamDelete does not accept parameters".to_string(),
        ));
    }
    let active = read_team_json(&active_team_path(runtime_root), "TeamDelete")?;
    let team_name = active
        .as_ref()
        .and_then(|active| active.get("name"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let Some(team_name) = team_name else {
        return Ok(json!({
            "success": true,
            "message": "No team name found, nothing to clean up"
        }));
    };
    let path = active
        .as_ref()
        .and_then(|active| active.get("path"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| team_manifest_path(runtime_root, &team_name));
    if let Some(team) = read_team_json(&path, "TeamDelete")? {
        let active_members = active_non_lead_members(&team);
        if !active_members.is_empty() {
            return Ok(json!({
                "success": false,
                "message": format!(
                    "Cannot cleanup team with {} active member(s): {}. Use requestShutdown to gracefully terminate teammates first.",
                    active_members.len(),
                    active_members.join(", ")
                ),
                "team_name": team_name
            }));
        }
    }
    let existed = path.exists();
    if existed {
        fs::remove_file(&path).map_err(|error| {
            pi::sdk::Error::tool(
                "TeamDelete",
                format!("failed to remove team manifest: {error}"),
            )
        })?;
    }
    let active_path = active_team_path(runtime_root);
    if active_path.exists() {
        fs::remove_file(&active_path).map_err(|error| {
            pi::sdk::Error::tool(
                "TeamDelete",
                format!("failed to clear active team: {error}"),
            )
        })?;
    }
    Ok(json!({
        "success": true,
        "message": format!("Cleaned up directories and worktrees for team \"{team_name}\""),
        "team_name": team_name,
        "removed": existed
    }))
}

async fn run_subagent_request(
    runtime_root: PathBuf,
    session_key: String,
    request: AgentRunRequest,
) -> Result<(AgentRunResult, DesktopSessionStatus), String> {
    let store = DesktopSessionStore::new(runtime_root.clone());
    store
        .patch_session(&session_key, None, None, None, Some("running"))
        .map_err(|error| error.to_string())?;
    let result = match AgentRuntime::new(runtime_root.clone())
        .run_turn(request)
        .await
    {
        Ok(result) => result,
        Err(error) => {
            let _ = store.patch_session(&session_key, None, None, None, Some("failed"));
            let _ = set_team_member_active(&runtime_root, &session_key, false);
            return Err(format!("subagent runtime failed: {}", error.message()));
        }
    };
    let completed_session = store
        .patch_session(&session_key, None, None, None, Some("completed"))
        .map_err(|error| error.to_string())?;
    let _ = set_team_member_active(&runtime_root, &session_key, false);
    Ok((result, completed_session))
}

fn subagent_tool_use_count(events: &[AgentRunEvent]) -> usize {
    events
        .iter()
        .filter(|event| matches!(event, AgentRunEvent::ToolCall { .. }))
        .count()
}

fn agent_alias_result(
    input: &Value,
    session_key: &str,
    task: &str,
    result: &AgentRunResult,
    duration_ms: u128,
) -> Value {
    json!({
        "status": "completed",
        "prompt": task,
        "agentId": session_key,
        "agentType": string_param(input, &["subagent_type", "subagentType", "agentType"]),
        "content": [{
            "type": "text",
            "text": result.assistant_text
        }],
        "totalToolUseCount": subagent_tool_use_count(&result.events),
        "totalDurationMs": duration_ms,
        "totalTokens": result.context_summary.estimated_tokens,
        "usage": {
            "input_tokens": result.context_summary.estimated_tokens,
            "output_tokens": 0,
            "cache_creation_input_tokens": null,
            "cache_read_input_tokens": null,
            "server_tool_use": null,
            "service_tier": null,
            "cache_creation": null
        }
    })
}

fn agent_alias_tool_result_text(result: &Value) -> String {
    match result.get("status").and_then(Value::as_str) {
        Some("async_launched") => {
            let agent_id = result
                .get("agentId")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let output_file = result
                .get("outputFile")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let can_read_output_file = result
                .get("canReadOutputFile")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let prefix = format!(
                "Async agent launched successfully.\nagentId: {agent_id} (internal ID - do not mention to user. Use SendMessage with to: '{agent_id}' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes."
            );
            let instructions = if can_read_output_file {
                format!(
                    "Do not duplicate this agent's work - avoid working with the same files or topics it is using. Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.\noutput_file: {output_file}\nIf asked, you can check progress before completion by using Read or Bash tail on the output file."
                )
            } else {
                "Briefly tell the user what you launched and end your response. Do not generate any other text - agent results will arrive in a subsequent message.".to_string()
            };
            format!("{prefix}\n{instructions}")
        }
        Some("completed") => {
            let mut text = agent_alias_content_text(result)
                .unwrap_or_else(|| "(Subagent completed but returned no output.)".to_string());
            let agent_type = result.get("agentType").and_then(Value::as_str);
            let worktree_info = result
                .get("worktreePath")
                .and_then(Value::as_str)
                .map(|worktree_path| {
                    format!(
                        "\nworktreePath: {worktree_path}\nworktreeBranch: {}",
                        result
                            .get("worktreeBranch")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                    )
                })
                .unwrap_or_default();
            if matches!(agent_type, Some("Explore" | "Plan")) && worktree_info.is_empty() {
                return text;
            }
            let agent_id = result
                .get("agentId")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let total_tokens = result
                .get("totalTokens")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let tool_uses = result
                .get("totalToolUseCount")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let duration_ms = result
                .get("totalDurationMs")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            text.push_str(&format!(
                "\n\nagentId: {agent_id} (use SendMessage with to: '{agent_id}' to continue this agent){worktree_info}\n<usage>total_tokens: {total_tokens}\ntool_uses: {tool_uses}\nduration_ms: {duration_ms}</usage>"
            ));
            text
        }
        Some("spawned") => {
            let session = result.get("session").unwrap_or(&Value::Null);
            let agent_id = session
                .get("key")
                .or_else(|| session.get("sessionKey"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let name = session
                .get("title")
                .or_else(|| session.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("subagent");
            format!(
                "Spawned successfully.\nagent_id: {agent_id}\nname: {name}\nThe agent is now running and will receive instructions via mailbox."
            )
        }
        _ => serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string()),
    }
}

fn agent_alias_content_text(result: &Value) -> Option<String> {
    let content = result.get("content").and_then(Value::as_array)?;
    let text = content
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
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
            SessionToolKind::SendMessage => {
                require_session_tool_keys(&input, &["to", "summary", "message"], "SendMessage")?;
                let target = required_param(self.kind, &input, &["to"])?;
                let message = send_message_content(&input)?;
                let summary = string_param(&input, &["summary"]);
                if message.is_plain() && summary.is_none() {
                    return Err(pi::sdk::Error::validation(
                        "summary is required when message is a string",
                    ));
                }
                if target.trim() == "*" {
                    if message.is_structured() {
                        return Err(pi::sdk::Error::validation(
                            "structured messages cannot be broadcast (to: \"*\")".to_string(),
                        ));
                    }
                    let recipients =
                        send_message_broadcast(&self.runtime_root, &store, message.as_str())?;
                    let output_message = if recipients.is_empty() {
                        "No teammates to broadcast to (you are the only team member)".to_string()
                    } else {
                        format!(
                            "Message broadcast to {} teammate(s): {}",
                            recipients.len(),
                            recipients.join(", ")
                        )
                    };
                    json!({
                        "success": true,
                        "message": output_message,
                        "recipients": recipients,
                        "routing": {
                            "sender": "main",
                            "target": "*",
                            "summary": summary,
                            "content": message.as_str()
                        }
                    })
                } else {
                    if message.kind() == Some("shutdown_response")
                        && !target.trim().eq_ignore_ascii_case("team-lead")
                    {
                        return Err(pi::sdk::Error::validation(
                            "shutdown_response must be sent to \"team-lead\"".to_string(),
                        ));
                    }
                    let session_key =
                        resolve_send_message_session(&self.runtime_root, &store, &target)?;
                    let session = store
                        .send_to_session(&session_key, message.as_str())
                        .map_err(|error| session_tool_error(self.kind, error))?;
                    let output_message = if message.is_structured() {
                        send_message_structured_output_message(&message, &target)
                    } else {
                        format!("Message sent to {target}'s inbox")
                    };
                    json!({
                        "success": true,
                        "message": output_message,
                        "request_id": message.request_id(),
                        "routing": {
                            "sender": "main",
                            "target": target,
                            "summary": summary,
                            "content": message.as_str()
                        },
                        "session": session
                    })
                }
            }
            SessionToolKind::TeamCreate => create_team(&self.runtime_root, &input)?,
            SessionToolKind::TeamDelete => delete_team(&self.runtime_root, &input)?,
            SessionToolKind::Agent | SessionToolKind::Task | SessionToolKind::Spawn => {
                if session_tool_is_agent_alias(self.kind) {
                    validate_agent_alias_input(self.kind, &input)?;
                }
                let task = subagent_prompt_param(self.kind, &input)?;
                let label = subagent_label_param(&input, &task);
                let agent_type =
                    string_param(&input, &["subagent_type", "subagentType", "agentType"]);
                let parent = string_param(&input, &["parentSessionKey", "parent", "spawnedBy"])
                    .unwrap_or_else(|| "main".to_string());
                let session = store
                    .spawn_session(Some(&parent), label.as_deref(), &task)
                    .map_err(|error| session_tool_error(self.kind, error))?;
                add_session_to_team(
                    &self.runtime_root,
                    string_param(&input, &["team_name", "teamName"]).as_deref(),
                    &session.key,
                    label.as_deref(),
                    agent_type.as_deref(),
                )?;
                let run_id = format!("subagent-run-{}", session_tool_now_millis());
                let request =
                    subagent_run_request(run_id, session.key.clone(), parent, task.clone(), &input);
                let run_in_background = input
                    .get("run_in_background")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if run_in_background {
                    let runtime_root = self.runtime_root.clone();
                    let session_key = session.key.clone();
                    let spawned_session_key = session_key.clone();
                    let description = label.clone().unwrap_or_else(|| session.title.clone());
                    let background_task = tokio::spawn(async move {
                        let _ = run_subagent_request(
                            runtime_root,
                            spawned_session_key.clone(),
                            request,
                        )
                        .await;
                        unregister_runtime_agent_task(&spawned_session_key);
                    });
                    register_runtime_agent_task(&session_key, background_task.abort_handle());
                    json!({
                        "status": "async_launched",
                        "agentId": session.key.clone(),
                        "description": description,
                        "prompt": task,
                        "outputFile": format!("sessions/{}.jsonl", session.key),
                        "canReadOutputFile": true,
                        "session": session
                    })
                } else if input.get("run").and_then(Value::as_bool) != Some(false) {
                    let started_at = session_tool_now_millis();
                    let (result, completed_session) = run_subagent_request(
                        self.runtime_root.clone(),
                        session.key.clone(),
                        request,
                    )
                    .await
                    .map_err(|error| session_tool_error(self.kind, error))?;
                    let duration_ms = session_tool_now_millis().saturating_sub(started_at);
                    if session_tool_is_agent_alias(self.kind) {
                        agent_alias_result(&input, &session.key, &task, &result, duration_ms)
                    } else {
                        json!({
                            "status": "completed",
                            "session": completed_session,
                            "runId": result.run_id,
                            "assistantText": result.assistant_text
                        })
                    }
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
        if matches!(
            self.kind,
            SessionToolKind::SendMessage
                | SessionToolKind::TeamCreate
                | SessionToolKind::TeamDelete
        ) {
            let text = serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string());
            return Ok(native_tool_output(tool_envelope(text, result, false)));
        }
        if session_tool_is_agent_alias(self.kind) {
            let text = agent_alias_tool_result_text(&result);
            return Ok(native_tool_output(tool_envelope(text, result, false)));
        }
        Ok(native_tool_output(result))
    }
}

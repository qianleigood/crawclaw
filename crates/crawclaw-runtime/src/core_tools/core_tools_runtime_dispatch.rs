use super::*;

#[derive(Clone, Copy)]
pub(super) enum CoreRuntimeToolKind {
    Canvas,
    Config,
    SendUserMessage,
    Brief,
    SendUserFile,
    Message,
    Sleep,
    Image,
    Pdf,
    Tts,
    ToolSearch,
    DiscoverSkills,
    Skill,
    LoadSkill,
    Workflow,
    Workflowize,
}

impl CoreRuntimeToolKind {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Canvas => "canvas",
            Self::Config => "Config",
            Self::SendUserMessage => "SendUserMessage",
            Self::Brief => "Brief",
            Self::SendUserFile => "SendUserFile",
            Self::Message => "message",
            Self::Sleep => "Sleep",
            Self::Image => "image",
            Self::Pdf => "pdf",
            Self::Tts => "tts",
            Self::ToolSearch => "tool_search",
            Self::DiscoverSkills => "discover_skills",
            Self::Skill => "Skill",
            Self::LoadSkill => "load_skill",
            Self::Workflow => "workflow",
            Self::Workflowize => "workflowize",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Canvas => "Canvas control is unavailable in current CrawClaw builds.",
            Self::Config => "Get or set Claude Code configuration settings.",
            Self::SendUserMessage => "Send a message to the user",
            Self::Brief => "Send a message to the user",
            Self::SendUserFile => "Send one or more local files to the user.",
            Self::Message => "Send messages and channel actions through Rust outbound delivery.",
            Self::Sleep => "Wait for a specified duration",
            Self::Image => "Describe images through the Rust native media-understanding registry.",
            Self::Pdf => "Analyze PDF documents through the Rust runtime.",
            Self::Tts => "Convert text to speech through the Rust native TTS provider.",
            Self::ToolSearch => {
                "Search deferred tools and activate matching schemas for the next model request."
            }
            Self::DiscoverSkills => "Search available skills from the Rust runtime skill roots.",
            Self::Skill => "Invoke a skill by loading its instructions into the main conversation.",
            Self::LoadSkill => "Load full instructions for an already surfaced skill.",
            Self::Workflow => "Manage local workflow registry entries through the Rust runtime.",
            Self::Workflowize => "Create a local workflow draft through the Rust runtime.",
        }
    }

    fn parameters(self) -> Value {
        match self {
            Self::Canvas => json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["present", "hide", "navigate", "eval", "snapshot"] }
                },
                "required": ["action"]
            }),
            Self::Config => json!({
                "type": "object",
                "properties": {
                    "setting": {
                        "type": "string",
                        "description": "The setting key (e.g., \"theme\", \"model\", \"permissions.defaultMode\")"
                    },
                    "value": {
                        "type": ["string", "boolean", "number"],
                        "description": "The new value. Omit to get current value."
                    }
                },
                "required": ["setting"],
                "additionalProperties": false
            }),
            Self::SendUserMessage | Self::Brief => json!({
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "The message for the user. Supports markdown formatting."
                    },
                    "attachments": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional file paths (absolute or relative to cwd) to attach. Use for photos, screenshots, diffs, logs, or any file the user should see alongside your message."
                    },
                    "status": {
                        "type": "string",
                        "enum": ["normal", "proactive"],
                        "description": "Use 'proactive' when you're surfacing something the user hasn't asked for and needs to see now - task completion while they're away, a blocker you hit, an unsolicited status update. Use 'normal' when replying to something the user just said."
                    }
                },
                "required": ["message", "status"],
                "additionalProperties": false
            }),
            Self::SendUserFile => json!({
                "type": "object",
                "properties": {
                    "files": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "File paths, absolute or relative to the runtime root, to send to the user."
                    },
                    "attachments": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Alias for files."
                    },
                    "path": {
                        "type": "string",
                        "description": "Single file path to send."
                    },
                    "message": {
                        "type": "string",
                        "description": "Optional message to send with the files."
                    },
                    "status": {
                        "type": "string",
                        "enum": ["normal", "proactive"],
                        "description": "normal when replying to the user, proactive when surfacing an unsolicited update."
                    }
                }
            }),
            Self::Message => json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["send", "poll", "action"] },
                    "channel": { "type": "string" },
                    "accountId": { "type": "string" },
                    "target": { "type": "string" },
                    "to": { "type": "string" },
                    "text": { "type": "string" },
                    "message": { "type": "string" },
                    "mediaUrls": { "type": "array", "items": { "type": "string" } },
                    "threadId": { "type": "string" },
                    "replyToId": { "type": "string" }
                }
            }),
            Self::Sleep => json!({
                "type": "object",
                "properties": {
                    "durationMs": {
                        "type": "integer",
                        "description": "Duration to wait in milliseconds."
                    },
                    "duration_ms": {
                        "type": "integer",
                        "description": "Duration to wait in milliseconds."
                    },
                    "milliseconds": {
                        "type": "integer",
                        "description": "Duration to wait in milliseconds."
                    },
                    "seconds": {
                        "type": "number",
                        "description": "Duration to wait in seconds."
                    },
                    "duration": {
                        "type": "number",
                        "description": "Duration to wait in seconds."
                    }
                }
            }),
            Self::Image => json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "image": { "type": "string" },
                    "images": { "type": "array", "items": { "type": "string" } },
                    "model": { "type": "string" },
                    "provider": { "type": "string" },
                    "apiKey": { "type": "string" },
                    "baseUrl": { "type": "string" },
                    "maxTokens": { "type": "number" }
                }
            }),
            Self::Pdf => json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "pdf": { "type": "string" },
                    "pdfs": { "type": "array", "items": { "type": "string" } },
                    "pages": { "type": "string" },
                    "model": { "type": "string" },
                    "maxBytesMb": { "type": "number" }
                }
            }),
            Self::Tts => json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "channel": { "type": "string" },
                    "voice": { "type": "string" },
                    "outputFormat": { "type": "string" },
                    "providerOverrides": { "type": "object" },
                    "providerConfig": { "type": "object" },
                    "baseUrl": { "type": "string" }
                },
                "required": ["text"]
            }),
            Self::ToolSearch => json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Query to find deferred tools. Use \"select:<tool_name>\" for direct selection, or keywords to search."
                    },
                    "max_results": {
                        "type": "number",
                        "description": "Maximum number of results to return (default: 5)"
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            Self::DiscoverSkills => json!({
                "type": "object",
                "properties": {
                    "taskDescription": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "required": ["taskDescription"]
            }),
            Self::LoadSkill => json!({
                "type": "object",
                "properties": {
                    "skill": { "type": "string" },
                    "name": { "type": "string" }
                }
            }),
            Self::Skill => json!({
                "type": "object",
                "properties": {
                    "skill": {
                        "type": "string",
                        "description": "The skill name. E.g., \"commit\", \"review-pr\", or \"pdf\""
                    },
                    "args": {
                        "type": "string",
                        "description": "Optional arguments for the skill."
                    }
                },
                "required": ["skill"],
                "additionalProperties": false
            }),
            Self::Workflow => json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string" },
                    "workflow": { "type": "string" },
                    "query": { "type": "string" },
                    "limit": { "type": "number" },
                    "inputs": { "type": "object" },
                    "patch": { "type": "object" }
                },
                "required": ["action"]
            }),
            Self::Workflowize => json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "goal": { "type": "string" },
                    "topology": { "type": "string" },
                    "description": { "type": "string" },
                    "sourceSummary": { "type": "string" },
                    "steps": { "type": "array", "items": { "type": "string" } },
                    "stepSpecs": { "type": "array", "items": { "type": "object" } },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "inputs": { "type": "array", "items": { "type": "string" } },
                    "outputs": { "type": "array", "items": { "type": "string" } },
                    "safeForAutoRun": { "type": "boolean" },
                    "requiresApproval": { "type": "boolean" }
                },
                "required": ["name", "goal"]
            }),
        }
    }

    fn is_read_only(self) -> bool {
        matches!(
            self,
            Self::Canvas
                | Self::Image
                | Self::Pdf
                | Self::SendUserMessage
                | Self::Brief
                | Self::SendUserFile
                | Self::Sleep
                | Self::ToolSearch
                | Self::DiscoverSkills
                | Self::LoadSkill
        )
    }
}

#[derive(Clone)]
pub(super) struct CoreRuntimeTool {
    runtime_root: PathBuf,
    kind: CoreRuntimeToolKind,
}

impl CoreRuntimeTool {
    pub(super) fn new(runtime_root: &Path, kind: CoreRuntimeToolKind) -> Self {
        Self {
            runtime_root: runtime_root.to_path_buf(),
            kind,
        }
    }
}

#[async_trait]
impl pi::sdk::Tool for CoreRuntimeTool {
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
        let result = match self.kind {
            CoreRuntimeToolKind::Canvas => run_canvas_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Config => run_config_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::SendUserMessage | CoreRuntimeToolKind::Brief => {
                run_user_message_tool(&self.runtime_root, self.kind.name(), input)
                    .map_err(|error| tool_error(self.kind.name(), error))?
            }
            CoreRuntimeToolKind::SendUserFile => run_send_user_file_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Message => run_message_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Sleep => run_sleep_tool(input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Image => run_image_tool(&self.runtime_root, input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Pdf => run_pdf_tool(&self.runtime_root, input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Tts => run_tts_tool(&self.runtime_root, input)
                .await
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::ToolSearch => run_tool_search_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::DiscoverSkills => {
                run_discover_skills_tool(&self.runtime_root, input)
                    .map_err(|error| tool_error(self.kind.name(), error))?
            }
            CoreRuntimeToolKind::Skill => run_skill_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::LoadSkill => run_load_skill_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Workflow => run_workflow_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
            CoreRuntimeToolKind::Workflowize => run_workflowize_tool(&self.runtime_root, input)
                .map_err(|error| tool_error(self.kind.name(), error))?,
        };
        Ok(native_tool_output(result))
    }

    fn is_read_only(&self) -> bool {
        self.kind.is_read_only()
    }
}

fn runtime_config_tool_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("config").join("crawclaw.json")
}

fn require_runtime_dispatch_keys(
    input: &Value,
    allowed_keys: &[&str],
    tool_name: &str,
) -> Result<(), String> {
    let Some(object) = input.as_object() else {
        return Err(format!("{tool_name} input must be an object"));
    };
    for key in object.keys() {
        if !allowed_keys.contains(&key.as_str()) {
            return Err(format!("{tool_name} input contains unknown field: {key}"));
        }
    }
    Ok(())
}

fn run_config_tool(runtime_root: &Path, input: Value) -> Result<Value, String> {
    require_runtime_dispatch_keys(&input, &["setting", "value"], "Config")?;
    let setting =
        string_param(&input, &["setting"]).ok_or_else(|| "Config requires setting".to_string())?;
    let path = match normalize_config_setting(&setting) {
        Ok(path) => path,
        Err(error) => return Ok(config_tool_error(&setting, None, error)),
    };
    let config_path = runtime_config_tool_path(runtime_root);
    let mut config = read_runtime_config_value(&config_path)?;
    let previous = get_config_json_path(&config, &path).cloned();
    let Some(value) = input.get("value") else {
        let current = previous.unwrap_or(Value::Null);
        return Ok(tool_envelope(
            format!("{} = {}", setting, stable_json_string(&current)),
            json!({
            "success": true,
            "operation": "get",
            "setting": setting,
            "path": path,
            "value": current,
            "configPath": config_path.to_string_lossy()
            }),
            false,
        ));
    };
    if !matches!(value, Value::String(_) | Value::Bool(_) | Value::Number(_)) {
        return Ok(config_tool_error(
            &setting,
            Some("set"),
            "Config value must be a string, boolean, or number.",
        ));
    }
    let unset_remote_control_default = setting == "remoteControlAtStartup"
        && value
            .as_str()
            .is_some_and(|raw| raw.trim().eq_ignore_ascii_case("default"));
    if unset_remote_control_default {
        delete_config_json_path(&mut config, &path);
    } else {
        let value = match normalize_config_value(&setting, value.clone()) {
            Ok(value) => value,
            Err(error) => return Ok(config_tool_error(&setting, Some("set"), error)),
        };
        if let Err(error) = validate_config_value(&setting, &value) {
            return Ok(config_tool_error(&setting, Some("set"), error));
        }
        set_config_json_path(&mut config, &path, value)?;
    }
    write_runtime_config_value(&config_path, &config)?;
    let new_value = get_config_json_path(&config, &path)
        .cloned()
        .unwrap_or(Value::Null);
    Ok(tool_envelope(
        format!("Set {} to {}", setting, stable_json_string(&new_value)),
        json!({
        "success": true,
        "operation": "set",
        "setting": setting,
        "path": path,
        "previousValue": previous.unwrap_or(Value::Null),
        "newValue": new_value,
        "configPath": config_path.to_string_lossy()
        }),
        false,
    ))
}

fn config_tool_error(setting: &str, operation: Option<&str>, error: impl Into<String>) -> Value {
    let error = error.into();
    let text = format!("Error: {error}");
    let mut details = json!({
        "success": false,
        "setting": setting,
        "error": error
    });
    if let Some(operation) = operation {
        details["operation"] = json!(operation);
    }
    tool_envelope(text, details, true)
}

fn stable_json_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn normalize_config_setting(setting: &str) -> Result<String, String> {
    let setting = setting.trim();
    if setting.is_empty() || setting.contains("..") || setting.contains('/') {
        return Err("Config setting must be a non-empty dot path".to_string());
    }
    let mapped = match setting {
        "permissionMode" | "permission_mode" | "permissions.defaultMode" => {
            "claudeCode.permissionMode".to_string()
        }
        "maxThinkingTokens" | "max_thinking_tokens" => "claudeCode.maxThinkingTokens".to_string(),
        "model" => "claudeCode.model".to_string(),
        "reasoningLevel" | "thinking" => "claudeCode.model.reasoningLevel".to_string(),
        value if value.starts_with("flags.") => {
            format!("claudeCode.flags.{}", value.trim_start_matches("flags."))
        }
        value if claude_code_config_setting(value) => format!("claudeCode.{value}"),
        value
            if value.starts_with("claudeCode.")
                || value.starts_with("tools.")
                || value.starts_with("mcpServers.") =>
        {
            value.to_string()
        }
        _ => return Err(format!("Unknown setting: \"{setting}\"")),
    };
    if mapped.split('.').any(|part| part.trim().is_empty()) {
        return Err("Config setting must not contain empty path segments".to_string());
    }
    Ok(mapped)
}

fn normalize_config_value(setting: &str, value: Value) -> Result<Value, String> {
    if claude_code_boolean_config_setting(setting) {
        return normalize_boolean_config_value(setting, value);
    }
    if setting == "model" {
        if let Some(raw) = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Some((provider, model)) = raw.split_once('/') {
                return Ok(json!({
                    "provider": provider.trim(),
                    "model": model.trim()
                }));
            }
            return Ok(json!({ "model": raw }));
        }
    }
    Ok(value)
}

fn validate_config_value(setting: &str, value: &Value) -> Result<(), String> {
    let Some(options) = claude_code_config_setting_options(setting) else {
        return Ok(());
    };
    let Some(raw) = value.as_str() else {
        return Err(format!(
            "Invalid value {}. Options: {}",
            value,
            options.join(", ")
        ));
    };
    if options.contains(&raw) {
        return Ok(());
    }
    Err(format!(
        "Invalid value \"{}\". Options: {}",
        raw,
        options.join(", ")
    ))
}

fn claude_code_config_setting_options(setting: &str) -> Option<&'static [&'static str]> {
    match setting {
        "theme" => Some(&[
            "auto",
            "dark",
            "light",
            "light-daltonized",
            "dark-daltonized",
            "light-ansi",
            "dark-ansi",
        ]),
        "editorMode" => Some(&["normal", "vim"]),
        "preferredNotifChannel" => Some(&[
            "auto",
            "iterm2",
            "iterm2_with_bell",
            "terminal_bell",
            "kitty",
            "ghostty",
            "notifications_disabled",
        ]),
        "permissionMode" | "permission_mode" | "permissions.defaultMode" => {
            Some(&["default", "plan", "acceptEdits", "dontAsk", "auto"])
        }
        "teammateMode" => Some(&["auto", "tmux", "in-process"]),
        _ => None,
    }
}

fn claude_code_config_setting(setting: &str) -> bool {
    matches!(
        setting,
        "theme"
            | "editorMode"
            | "verbose"
            | "preferredNotifChannel"
            | "autoCompactEnabled"
            | "autoMemoryEnabled"
            | "autoDreamEnabled"
            | "fileCheckpointingEnabled"
            | "showTurnDuration"
            | "terminalProgressBarEnabled"
            | "todoFeatureEnabled"
            | "alwaysThinkingEnabled"
            | "language"
            | "teammateMode"
            | "classifierPermissionsEnabled"
            | "voiceEnabled"
            | "remoteControlAtStartup"
            | "taskCompleteNotifEnabled"
            | "inputNeededNotifEnabled"
            | "agentPushNotifEnabled"
    )
}

fn claude_code_boolean_config_setting(setting: &str) -> bool {
    matches!(
        setting,
        "verbose"
            | "autoCompactEnabled"
            | "autoMemoryEnabled"
            | "autoDreamEnabled"
            | "fileCheckpointingEnabled"
            | "showTurnDuration"
            | "terminalProgressBarEnabled"
            | "todoFeatureEnabled"
            | "alwaysThinkingEnabled"
            | "classifierPermissionsEnabled"
            | "voiceEnabled"
            | "remoteControlAtStartup"
            | "taskCompleteNotifEnabled"
            | "inputNeededNotifEnabled"
            | "agentPushNotifEnabled"
    )
}

fn normalize_boolean_config_value(setting: &str, value: Value) -> Result<Value, String> {
    match value {
        Value::Bool(_) => Ok(value),
        Value::String(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            _ => Err(format!("{setting} requires true or false.")),
        },
        _ => Err(format!("{setting} requires true or false.")),
    }
}

fn read_runtime_config_value(path: &Path) -> Result<Value, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Value::Object(serde_json::Map::new()));
        }
        Err(error) => return Err(format!("failed to read runtime config: {error}")),
    };
    serde_json::from_str(&raw).map_err(|error| format!("failed to parse runtime config: {error}"))
}

fn write_runtime_config_value(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create runtime config dir: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("serialize runtime config: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("write runtime config: {error}"))
}

fn get_config_json_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn set_config_json_path(value: &mut Value, path: &str, next: Value) -> Result<(), String> {
    if !value.is_object() {
        *value = Value::Object(serde_json::Map::new());
    }
    let segments = path.split('.').collect::<Vec<_>>();
    let mut current = value;
    for segment in &segments[..segments.len().saturating_sub(1)] {
        let object = current
            .as_object_mut()
            .ok_or_else(|| format!("Config path segment is not an object: {segment}"))?;
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if !current.is_object() {
            *current = Value::Object(serde_json::Map::new());
        }
    }
    let leaf = segments
        .last()
        .ok_or_else(|| "Config setting path is empty".to_string())?;
    let object = current
        .as_object_mut()
        .ok_or_else(|| "Config parent path is not an object".to_string())?;
    object.insert((*leaf).to_string(), next);
    Ok(())
}

fn delete_config_json_path(value: &mut Value, path: &str) -> bool {
    let segments = path.split('.').collect::<Vec<_>>();
    let Some((leaf, parents)) = segments.split_last() else {
        return false;
    };
    let mut current = value;
    for segment in parents {
        let Some(next) = current.get_mut(*segment) else {
            return false;
        };
        current = next;
    }
    current
        .as_object_mut()
        .map(|object| object.remove(*leaf).is_some())
        .unwrap_or(false)
}

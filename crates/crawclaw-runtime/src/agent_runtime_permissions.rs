use super::*;

pub(super) const PERMISSION_UPDATE_EVENT_KEY: &str = "crawclawEvent";
pub(super) const PERMISSION_UPDATE_EVENT_REQUESTED: &str = "permissionRequested";
pub(super) const PERMISSION_UPDATE_REQUEST_ID_KEY: &str = "requestId";
pub(super) const PERMISSION_UPDATE_TOOL_NAME_KEY: &str = "toolName";
pub(super) const PERMISSION_UPDATE_REASON_KEY: &str = "reason";
pub(super) const HOOK_UPDATE_EVENT_KEY: &str = "crawclawEvent";
pub(super) const HOOK_UPDATE_EVENT_DECISION: &str = "hookDecision";
pub(super) const HOOK_UPDATE_HOOK_KEY: &str = "hook";
pub(super) const HOOK_UPDATE_DECISION_KEY: &str = "decision";
pub(super) const HOOK_UPDATE_MESSAGE_KEY: &str = "message";

type SharedToolUpdateSink = Arc<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>;

#[derive(Clone)]
pub struct AgentRuntimePermissionPolicy {
    pub mode: AgentRuntimePermissionMode,
    pub confirmations: AgentRuntimeConfirmationPolicy,
    pub requester: Option<Arc<dyn AgentRuntimePermissionRequester>>,
}

#[derive(Clone, Default)]
pub struct AgentRuntimeToolHookPolicy {
    pub pre_tool_use: Option<Arc<dyn AgentRuntimePreToolUseHook>>,
    pub post_tool_use: Option<Arc<dyn AgentRuntimePostToolUseHook>>,
}

impl AgentRuntimeToolHookPolicy {
    pub fn with_pre_tool_use(hook: Arc<dyn AgentRuntimePreToolUseHook>) -> Self {
        Self {
            pre_tool_use: Some(hook),
            post_tool_use: None,
        }
    }

    pub fn with_tool_hooks(
        pre_tool_use: Option<Arc<dyn AgentRuntimePreToolUseHook>>,
        post_tool_use: Option<Arc<dyn AgentRuntimePostToolUseHook>>,
    ) -> Self {
        Self {
            pre_tool_use,
            post_tool_use,
        }
    }
}

impl AgentRuntimePermissionPolicy {
    pub fn workspace() -> Self {
        Self {
            mode: AgentRuntimePermissionMode::Workspace,
            confirmations: AgentRuntimeConfirmationPolicy::default(),
            requester: None,
        }
    }

    pub fn read_only() -> Self {
        Self {
            mode: AgentRuntimePermissionMode::ReadOnly,
            confirmations: AgentRuntimeConfirmationPolicy::default(),
            requester: None,
        }
    }

    pub fn full_access() -> Self {
        Self {
            mode: AgentRuntimePermissionMode::FullAccess,
            confirmations: AgentRuntimeConfirmationPolicy::default(),
            requester: None,
        }
    }

    pub fn with_confirm_file_changes(mut self, value: bool) -> Self {
        self.confirmations.confirm_file_changes = value;
        self
    }

    pub fn with_confirm_commands(mut self, value: bool) -> Self {
        self.confirmations.confirm_commands = value;
        self
    }

    pub fn with_confirm_external_apps(mut self, value: bool) -> Self {
        self.confirmations.confirm_external_apps = value;
        self
    }

    pub fn with_confirm_high_risk(mut self, value: bool) -> Self {
        self.confirmations.confirm_high_risk = value;
        self
    }

    pub fn with_requester(mut self, requester: Arc<dyn AgentRuntimePermissionRequester>) -> Self {
        self.requester = Some(requester);
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentRuntimePermissionMode {
    Workspace,
    ReadOnly,
    FullAccess,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AgentRuntimeConfirmationPolicy {
    pub confirm_file_changes: bool,
    pub confirm_commands: bool,
    pub confirm_external_apps: bool,
    pub confirm_high_risk: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRuntimePermissionRequest {
    pub tool_call_id: String,
    pub tool_name: String,
    pub title: String,
    pub detail: String,
    pub category: AgentRuntimePermissionCategory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentRuntimePermissionCategory {
    FileChange,
    Command,
    ExternalApp,
    HighRisk,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentRuntimePermissionDecision {
    Approved,
    Denied,
}

pub trait AgentRuntimePermissionRequester: Send + Sync {
    fn request_permission<'a>(
        &'a self,
        request: AgentRuntimePermissionRequest,
    ) -> Pin<Box<dyn Future<Output = AgentRuntimePermissionDecision> + Send + 'a>>;
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentRuntimePreToolUseRequest {
    pub tool_call_id: String,
    pub tool_name: String,
    pub input: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AgentRuntimePreToolUseDecision {
    Continue {
        input: Value,
        additional_context: Vec<String>,
    },
    Block {
        message: String,
    },
}

pub trait AgentRuntimePreToolUseHook: Send + Sync {
    fn pre_tool_use<'a>(
        &'a self,
        request: AgentRuntimePreToolUseRequest,
    ) -> Pin<Box<dyn Future<Output = AgentRuntimePreToolUseDecision> + Send + 'a>>;
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentRuntimePostToolUseRequest {
    pub tool_call_id: String,
    pub tool_name: String,
    pub input: Value,
    pub output: Option<Value>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AgentRuntimePostToolUseDecision {
    Continue {
        updated_mcp_tool_output: Option<Value>,
        additional_context: Vec<String>,
    },
}

pub trait AgentRuntimePostToolUseHook: Send + Sync {
    fn post_tool_use<'a>(
        &'a self,
        request: AgentRuntimePostToolUseRequest,
    ) -> Pin<Box<dyn Future<Output = AgentRuntimePostToolUseDecision> + Send + 'a>>;
}

pub(super) fn apply_permission_policy_to_registry(
    registry: pi::sdk::ToolRegistry,
    policy: Option<AgentRuntimePermissionPolicy>,
) -> pi::sdk::ToolRegistry {
    let Some(policy) = policy else {
        return registry;
    };
    let tools = registry
        .into_tools()
        .into_iter()
        .filter_map(|tool| {
            let category = permission_category(tool.name());
            if policy.mode == AgentRuntimePermissionMode::ReadOnly
                && !is_read_only_allowed_tool(tool.name(), tool.is_read_only(), category)
            {
                return None;
            }
            if category.is_some_and(|category| should_confirm(&policy, category)) {
                return Some(Box::new(PermissionCheckedTool {
                    inner: tool,
                    policy: policy.clone(),
                    category: category.expect("permission category"),
                }) as Box<dyn pi::sdk::Tool>);
            }
            Some(tool)
        })
        .collect();
    pi::sdk::ToolRegistry::from_tools(tools)
}

pub(super) fn apply_tool_hook_policy_to_registry(
    registry: pi::sdk::ToolRegistry,
    policy: Option<AgentRuntimeToolHookPolicy>,
) -> pi::sdk::ToolRegistry {
    let Some(policy) = policy else {
        return registry;
    };
    if policy.pre_tool_use.is_none() && policy.post_tool_use.is_none() {
        return registry;
    }
    let tools = registry
        .into_tools()
        .into_iter()
        .map(|tool| {
            Box::new(ToolHookCheckedTool {
                inner: tool,
                pre_hook: policy.pre_tool_use.as_ref().map(Arc::clone),
                post_hook: policy.post_tool_use.as_ref().map(Arc::clone),
            }) as Box<dyn pi::sdk::Tool>
        })
        .collect();
    pi::sdk::ToolRegistry::from_tools(tools)
}

struct PermissionCheckedTool {
    inner: Box<dyn pi::sdk::Tool>,
    policy: AgentRuntimePermissionPolicy,
    category: AgentRuntimePermissionCategory,
}

#[async_trait::async_trait]
impl pi::sdk::Tool for PermissionCheckedTool {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn label(&self) -> &str {
        self.inner.label()
    }

    fn description(&self) -> &str {
        self.inner.description()
    }

    fn parameters(&self) -> Value {
        self.inner.parameters()
    }

    async fn execute(
        &self,
        tool_call_id: &str,
        input: Value,
        on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let tool_name = self.name().to_string();
        let Some(requester) = &self.policy.requester else {
            return Err(permission_error(
                &tool_name,
                "permission confirmation is required",
            ));
        };
        let request = permission_request(tool_call_id, &tool_name, self.category, &input);
        if let Some(on_update) = on_update.as_ref() {
            on_update(permission_requested_tool_update(&request));
        }
        tracing::info!(
            tool_name = %tool_name,
            tool_call_id,
            "agent_runtime_permission_confirmation_requested"
        );
        match requester.request_permission(request).await {
            AgentRuntimePermissionDecision::Approved => {
                tracing::info!(
                    tool_name = %tool_name,
                    tool_call_id,
                    "agent_runtime_permission_approved"
                );
                self.inner.execute(tool_call_id, input, on_update).await
            }
            AgentRuntimePermissionDecision::Denied => {
                tracing::info!(
                    tool_name = %tool_name,
                    tool_call_id,
                    "agent_runtime_permission_denied"
                );
                Err(permission_error(&tool_name, "permission denied"))
            }
        }
    }

    fn is_read_only(&self) -> bool {
        self.inner.is_read_only()
    }
}

struct ToolHookCheckedTool {
    inner: Box<dyn pi::sdk::Tool>,
    pre_hook: Option<Arc<dyn AgentRuntimePreToolUseHook>>,
    post_hook: Option<Arc<dyn AgentRuntimePostToolUseHook>>,
}

#[async_trait::async_trait]
impl pi::sdk::Tool for ToolHookCheckedTool {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn label(&self) -> &str {
        self.inner.label()
    }

    fn description(&self) -> &str {
        self.inner.description()
    }

    fn parameters(&self) -> Value {
        self.inner.parameters()
    }

    async fn execute(
        &self,
        tool_call_id: &str,
        input: Value,
        on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
    ) -> pi::sdk::Result<pi::sdk::ToolOutput> {
        let update_sink = shared_tool_update_sink(on_update);
        let tool_name = self.name().to_string();
        let mut additional_context = Vec::new();
        let input = if let Some(hook) = &self.pre_hook {
            let request = AgentRuntimePreToolUseRequest {
                tool_call_id: tool_call_id.to_string(),
                tool_name: tool_name.clone(),
                input,
            };
            match hook.pre_tool_use(request).await {
                AgentRuntimePreToolUseDecision::Continue {
                    input,
                    additional_context: context,
                } => {
                    emit_tool_hook_decision_update(
                        &update_sink,
                        "PreToolUse",
                        "continue",
                        hook_context_message(&context),
                    );
                    additional_context.extend(context);
                    input
                }
                AgentRuntimePreToolUseDecision::Block { message } => {
                    let message = message
                        .trim()
                        .is_empty()
                        .then_some("blocked by PreToolUse hook")
                        .unwrap_or(message.as_str())
                        .to_string();
                    emit_tool_hook_decision_update(
                        &update_sink,
                        "PreToolUse",
                        "block",
                        Some(message.clone()),
                    );
                    return Err(permission_error(&tool_name, &message));
                }
            }
        } else {
            input
        };

        let result = self
            .inner
            .execute(
                tool_call_id,
                input.clone(),
                boxed_tool_update_sink(&update_sink),
            )
            .await;
        let Some(hook) = &self.post_hook else {
            return result.map(|mut output| {
                append_hook_additional_context(&mut output, additional_context);
                output
            });
        };
        match result {
            Ok(output) => {
                let request = AgentRuntimePostToolUseRequest {
                    tool_call_id: tool_call_id.to_string(),
                    tool_name: tool_name.clone(),
                    input,
                    output: Some(tool_output_to_hook_value(&output)),
                    error: None,
                };
                match hook.post_tool_use(request).await {
                    AgentRuntimePostToolUseDecision::Continue {
                        updated_mcp_tool_output,
                        additional_context: context,
                    } => {
                        emit_tool_hook_decision_update(
                            &update_sink,
                            "PostToolUse",
                            "continue",
                            hook_context_message(&context),
                        );
                        let mut output = apply_updated_mcp_tool_output(
                            &tool_name,
                            output,
                            updated_mcp_tool_output,
                        );
                        additional_context.extend(context);
                        append_hook_additional_context(&mut output, additional_context);
                        Ok(output)
                    }
                }
            }
            Err(error) => {
                let request = AgentRuntimePostToolUseRequest {
                    tool_call_id: tool_call_id.to_string(),
                    tool_name: tool_name.clone(),
                    input,
                    output: None,
                    error: Some(error.to_string()),
                };
                let AgentRuntimePostToolUseDecision::Continue {
                    additional_context: context,
                    ..
                } = hook.post_tool_use(request).await;
                emit_tool_hook_decision_update(
                    &update_sink,
                    "PostToolUse",
                    "continue",
                    hook_context_message(&context),
                );
                if context.is_empty() {
                    return Err(error);
                }
                additional_context.extend(context);
                Err(pi::sdk::Error::tool(
                    &tool_name,
                    error_message_with_hook_context(error.to_string(), additional_context),
                ))
            }
        }
    }

    fn is_read_only(&self) -> bool {
        self.inner.is_read_only()
    }
}

fn shared_tool_update_sink(
    on_update: Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>>,
) -> Option<SharedToolUpdateSink> {
    on_update.map(Arc::from)
}

fn boxed_tool_update_sink(
    update_sink: &Option<SharedToolUpdateSink>,
) -> Option<Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>> {
    update_sink.as_ref().map(|sink| {
        let sink = Arc::clone(sink);
        Box::new(move |update| sink(update)) as Box<dyn Fn(pi::sdk::ToolUpdate) + Send + Sync>
    })
}

fn emit_tool_hook_decision_update(
    update_sink: &Option<SharedToolUpdateSink>,
    hook: &str,
    decision: &str,
    message: Option<String>,
) {
    let Some(update_sink) = update_sink else {
        return;
    };
    update_sink(tool_hook_decision_update(hook, decision, message));
}

fn tool_hook_decision_update(
    hook: &str,
    decision: &str,
    message: Option<String>,
) -> pi::sdk::ToolUpdate {
    let content = message
        .as_ref()
        .map(|message| {
            vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                message.clone(),
            ))]
        })
        .unwrap_or_default();
    pi::sdk::ToolUpdate {
        content,
        details: Some(json!({
            HOOK_UPDATE_EVENT_KEY: HOOK_UPDATE_EVENT_DECISION,
            HOOK_UPDATE_HOOK_KEY: hook,
            HOOK_UPDATE_DECISION_KEY: decision,
            HOOK_UPDATE_MESSAGE_KEY: message,
        })),
    }
}

fn hook_context_message(contexts: &[String]) -> Option<String> {
    let message = contexts
        .iter()
        .map(|context| context.trim())
        .filter(|context| !context.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    (!message.is_empty()).then_some(message)
}

fn append_hook_additional_context(output: &mut pi::sdk::ToolOutput, contexts: Vec<String>) {
    for context in contexts {
        let context = context.trim();
        if context.is_empty() {
            continue;
        }
        output
            .content
            .push(pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                format!("<system-reminder>\n{context}\n</system-reminder>"),
            )));
    }
}

fn error_message_with_hook_context(message: String, contexts: Vec<String>) -> String {
    let mut text = message;
    for context in contexts {
        let context = context.trim();
        if context.is_empty() {
            continue;
        }
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str("<system-reminder>\n");
        text.push_str(context);
        text.push_str("\n</system-reminder>");
    }
    text
}

fn tool_output_to_hook_value(output: &pi::sdk::ToolOutput) -> Value {
    serde_json::to_value(output).unwrap_or_else(|_| {
        json!({
            "content": [],
            "details": output.details,
            "isError": output.is_error
        })
    })
}

fn apply_updated_mcp_tool_output(
    tool_name: &str,
    mut output: pi::sdk::ToolOutput,
    updated_mcp_tool_output: Option<Value>,
) -> pi::sdk::ToolOutput {
    let Some(updated) = updated_mcp_tool_output else {
        return output;
    };
    if !tool_name.starts_with("mcp__") {
        return output;
    }
    let text = mcp_updated_output_text(&updated);
    output.content = vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(text))];
    output.is_error = updated
        .get("isError")
        .or_else(|| updated.get("is_error"))
        .and_then(Value::as_bool)
        .unwrap_or(output.is_error);
    output.details = Some(updated_mcp_output_details(output.details, updated));
    output
}

fn updated_mcp_output_details(previous: Option<Value>, updated: Value) -> Value {
    if let Some(Value::Object(mut object)) = previous {
        object.insert("result".to_string(), updated);
        object.insert("hookUpdatedMcpToolOutput".to_string(), Value::Bool(true));
        return Value::Object(object);
    }
    json!({
        "hookUpdatedMcpToolOutput": true,
        "result": updated
    })
}

fn mcp_updated_output_text(updated: &Value) -> String {
    if let Some(text) = updated.as_str() {
        return text.to_string();
    }
    let mut text_blocks = Vec::new();
    if let Some(structured_content) = updated
        .get("structuredContent")
        .or_else(|| updated.get("structured_content"))
    {
        text_blocks.push(
            serde_json::to_string_pretty(structured_content)
                .unwrap_or_else(|_| structured_content.to_string()),
        );
    }
    if let Some(content) = updated.get("content").and_then(Value::as_array) {
        for block in content {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        text_blocks.push(text.to_string());
                    }
                }
                Some("image") => {
                    let mime_type = block
                        .get("mimeType")
                        .or_else(|| block.get("mime_type"))
                        .and_then(Value::as_str)
                        .unwrap_or("image/*");
                    text_blocks.push(format!("[Image content: {mime_type}]"));
                }
                Some("resource") => {
                    if let Some(resource) = block.get("resource") {
                        let uri = resource
                            .get("uri")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        if let Some(text) = resource.get("text").and_then(Value::as_str) {
                            text_blocks.push(format!("[Resource at {uri}] {text}"));
                        } else {
                            let mime_type = resource
                                .get("mimeType")
                                .or_else(|| resource.get("mime_type"))
                                .and_then(Value::as_str)
                                .unwrap_or("application/octet-stream");
                            text_blocks
                                .push(format!("[Resource at {uri}] Binary resource ({mime_type})"));
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if !text_blocks.is_empty() {
        return text_blocks.join("\n\n");
    }
    serde_json::to_string_pretty(updated).unwrap_or_else(|_| updated.to_string())
}

fn permission_error(tool_name: &str, message: &str) -> pi::sdk::Error {
    pi::sdk::Error::tool(tool_name, message)
}

fn permission_requested_tool_update(
    request: &AgentRuntimePermissionRequest,
) -> pi::sdk::ToolUpdate {
    pi::sdk::ToolUpdate {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            request.detail.clone(),
        ))],
        details: Some(json!({
            PERMISSION_UPDATE_EVENT_KEY: PERMISSION_UPDATE_EVENT_REQUESTED,
            PERMISSION_UPDATE_REQUEST_ID_KEY: request.tool_call_id,
            PERMISSION_UPDATE_TOOL_NAME_KEY: request.tool_name,
            PERMISSION_UPDATE_REASON_KEY: request.detail,
            "title": request.title,
            "category": permission_category_name(request.category),
        })),
    }
}

fn permission_category_name(category: AgentRuntimePermissionCategory) -> &'static str {
    match category {
        AgentRuntimePermissionCategory::FileChange => "fileChange",
        AgentRuntimePermissionCategory::Command => "command",
        AgentRuntimePermissionCategory::ExternalApp => "externalApp",
        AgentRuntimePermissionCategory::HighRisk => "highRisk",
    }
}

fn is_read_only_allowed_tool(
    tool_name: &str,
    read_only: bool,
    category: Option<AgentRuntimePermissionCategory>,
) -> bool {
    read_only
        && !matches!(
            category,
            Some(
                AgentRuntimePermissionCategory::Command
                    | AgentRuntimePermissionCategory::FileChange
                    | AgentRuntimePermissionCategory::HighRisk
            )
        )
        && !is_native_plugin_tool(tool_name)
}

fn should_confirm(
    policy: &AgentRuntimePermissionPolicy,
    category: AgentRuntimePermissionCategory,
) -> bool {
    match category {
        AgentRuntimePermissionCategory::FileChange => policy.confirmations.confirm_file_changes,
        AgentRuntimePermissionCategory::Command => policy.confirmations.confirm_commands,
        AgentRuntimePermissionCategory::ExternalApp => policy.confirmations.confirm_external_apps,
        AgentRuntimePermissionCategory::HighRisk => policy.confirmations.confirm_high_risk,
    }
}

fn permission_category(tool_name: &str) -> Option<AgentRuntimePermissionCategory> {
    if matches!(
        tool_name,
        "workflow"
            | "workflowize"
            | "Config"
            | "cron"
            | "CronCreate"
            | "CronDelete"
            | "RemoteTrigger"
            | "message"
            | "SendUserMessage"
            | "SendUserFile"
            | "SendMessage"
            | "TeamCreate"
            | "TeamDelete"
            | "EnterWorktree"
            | "ExitWorktree"
            | "Brief"
            | "review_task"
            | "ExitPlanMode"
    ) {
        return Some(AgentRuntimePermissionCategory::HighRisk);
    }
    if matches!(
        tool_name,
        "bash" | "Bash" | "PowerShell" | "process" | "TaskStop" | "KillShell"
    ) {
        return Some(AgentRuntimePermissionCategory::Command);
    }
    if matches!(
        tool_name,
        "write"
            | "Write"
            | "edit"
            | "Edit"
            | "NotebookEdit"
            | "apply_patch"
            | "knowledge_ingest"
            | "knowledge_model_create"
            | "session_summary_file_edit"
    ) {
        return Some(AgentRuntimePermissionCategory::FileChange);
    }
    if is_mcp_tool(tool_name) {
        return Some(AgentRuntimePermissionCategory::ExternalApp);
    }
    if is_native_plugin_tool(tool_name) {
        return Some(AgentRuntimePermissionCategory::ExternalApp);
    }
    None
}

fn is_native_plugin_tool(tool_name: &str) -> bool {
    if is_mcp_tool(tool_name) {
        return false;
    }
    !rust_core_tool_definitions()
        .iter()
        .any(|definition| definition.id == tool_name)
}

fn is_mcp_tool(tool_name: &str) -> bool {
    tool_name.starts_with("mcp__")
}

fn permission_request(
    tool_call_id: &str,
    tool_name: &str,
    category: AgentRuntimePermissionCategory,
    input: &Value,
) -> AgentRuntimePermissionRequest {
    let (title, detail) = match category {
        AgentRuntimePermissionCategory::FileChange => (
            "确认修改文件",
            format!("工具 {tool_name} 想写入或修改本地文件。"),
        ),
        AgentRuntimePermissionCategory::Command => {
            let command = input
                .get("command")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("本机命令");
            (
                "确认执行命令",
                format!("工具 {tool_name} 想运行：{command}"),
            )
        }
        AgentRuntimePermissionCategory::ExternalApp => (
            "确认操作外部应用",
            format!("工具 {tool_name} 想调用浏览器、本机插件或外部服务。"),
        ),
        AgentRuntimePermissionCategory::HighRisk => (
            "确认高风险操作",
            format!("工具 {tool_name} 想执行消息、自动化或工作流操作。"),
        ),
    };
    AgentRuntimePermissionRequest {
        tool_call_id: tool_call_id.to_string(),
        tool_name: tool_name.to_string(),
        title: title.to_string(),
        detail,
        category,
    }
}

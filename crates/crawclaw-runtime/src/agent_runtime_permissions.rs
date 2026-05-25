use super::*;

#[derive(Clone)]
pub struct AgentRuntimePermissionPolicy {
    pub mode: AgentRuntimePermissionMode,
    pub confirmations: AgentRuntimeConfirmationPolicy,
    pub requester: Option<Arc<dyn AgentRuntimePermissionRequester>>,
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

fn permission_error(tool_name: &str, message: &str) -> pi::sdk::Error {
    pi::sdk::Error::tool(tool_name, message)
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
                    | AgentRuntimePermissionCategory::ExternalApp
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
        "workflow" | "workflowize" | "cron" | "message" | "review_task"
    ) {
        return Some(AgentRuntimePermissionCategory::HighRisk);
    }
    if matches!(tool_name, "bash" | "process") {
        return Some(AgentRuntimePermissionCategory::Command);
    }
    if matches!(
        tool_name,
        "write"
            | "edit"
            | "apply_patch"
            | "memory_note_write"
            | "memory_note_edit"
            | "memory_note_delete"
            | "session_summary_file_edit"
            | "write_experience_note"
    ) {
        return Some(AgentRuntimePermissionCategory::FileChange);
    }
    if is_native_plugin_tool(tool_name) {
        return Some(AgentRuntimePermissionCategory::ExternalApp);
    }
    None
}

fn is_native_plugin_tool(tool_name: &str) -> bool {
    !matches!(
        tool_name,
        "read"
            | "write"
            | "edit"
            | "apply_patch"
            | "bash"
            | "process"
            | "grep"
            | "find"
            | "ls"
            | "web_search"
            | "web_fetch"
            | "session_status"
            | "sessions_list"
            | "sessions_history"
            | "sessions_send"
            | "sessions_spawn"
            | "sessions_yield"
            | "subagents"
            | "canvas"
            | "message"
            | "cron"
            | "image"
            | "pdf"
            | "tts"
            | "discover_skills"
            | "workflow"
            | "workflowize"
            | "review_task"
            | "write_experience_note"
            | "memory_manifest_read"
            | "memory_note_read"
            | "memory_note_write"
            | "memory_note_edit"
            | "memory_note_delete"
            | "session_summary_file_read"
            | "session_summary_file_edit"
    )
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

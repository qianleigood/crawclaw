use super::*;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RustCoreToolStatus {
    RustNative,
    PendingNative,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RustCoreToolDefinition {
    pub id: &'static str,
    pub backing_runtime_id: &'static str,
    pub status: RustCoreToolStatus,
    pub default_enabled: bool,
    pub read_only: bool,
    pub label: &'static str,
    pub description: &'static str,
    pub section_id: &'static str,
    pub default_profiles: &'static [&'static str],
    pub lifecycle: &'static str,
    #[serde(rename = "includeInCrawClawGroup")]
    pub include_in_crawclaw_group: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustAgentToolDescriptor {
    pub name: String,
    pub label: String,
    pub description: String,
    pub parameters: Value,
    pub read_only: bool,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RustCoreToolSection {
    pub id: &'static str,
    pub label: &'static str,
}

pub(super) const PROFILE_MINIMAL_CODING_FULL: &[&str] = &["minimal", "coding", "full"];
pub(super) const PROFILE_CODING_FULL: &[&str] = &["coding", "full"];
pub(super) const PROFILE_MESSAGING: &[&str] = &["messaging"];
pub(super) const PROFILE_FULL: &[&str] = &["full"];
pub(super) const PROFILE_NONE: &[&str] = &[];

pub(super) const RUST_CORE_TOOL_SECTIONS: &[RustCoreToolSection] = &[
    RustCoreToolSection {
        id: "fs",
        label: "Files",
    },
    RustCoreToolSection {
        id: "runtime",
        label: "Runtime",
    },
    RustCoreToolSection {
        id: "web",
        label: "Web",
    },
    RustCoreToolSection {
        id: "sessions",
        label: "Sessions",
    },
    RustCoreToolSection {
        id: "ui",
        label: "UI",
    },
    RustCoreToolSection {
        id: "messaging",
        label: "Messaging",
    },
    RustCoreToolSection {
        id: "automation",
        label: "Automation",
    },
    RustCoreToolSection {
        id: "skills",
        label: "Skills",
    },
    RustCoreToolSection {
        id: "workflow",
        label: "Workflow",
    },
    RustCoreToolSection {
        id: "review",
        label: "Review",
    },
    RustCoreToolSection {
        id: "memory",
        label: "Memory",
    },
    RustCoreToolSection {
        id: "session_summary",
        label: "Session Summary",
    },
    RustCoreToolSection {
        id: "media",
        label: "Media",
    },
];

pub(super) const fn core_tool(
    id: &'static str,
    label: &'static str,
    description: &'static str,
    section_id: &'static str,
    default_profiles: &'static [&'static str],
    read_only: bool,
    include_in_crawclaw_group: bool,
) -> RustCoreToolDefinition {
    RustCoreToolDefinition {
        id,
        backing_runtime_id: id,
        status: RustCoreToolStatus::RustNative,
        default_enabled: true,
        read_only,
        label,
        description,
        section_id,
        default_profiles,
        lifecycle: "profile_default",
        include_in_crawclaw_group,
    }
}

pub(super) const fn special_agent_tool(
    id: &'static str,
    label: &'static str,
    description: &'static str,
    section_id: &'static str,
    read_only: bool,
) -> RustCoreToolDefinition {
    RustCoreToolDefinition {
        lifecycle: "special_agent_only",
        ..core_tool(
            id,
            label,
            description,
            section_id,
            PROFILE_NONE,
            read_only,
            false,
        )
    }
}

pub(super) const RUST_CORE_TOOL_DEFINITIONS: &[RustCoreToolDefinition] = &[
    core_tool(
        "read",
        "read",
        "Read file contents",
        "fs",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        false,
    ),
    core_tool(
        "write",
        "write",
        "Create or overwrite files",
        "fs",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "edit",
        "edit",
        "Make precise edits",
        "fs",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "apply_patch",
        "apply_patch",
        "Patch files",
        "fs",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "bash",
        "bash",
        "Run shell commands",
        "runtime",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "process",
        "process",
        "Manage background processes",
        "runtime",
        PROFILE_CODING_FULL,
        false,
        false,
    ),
    core_tool(
        "grep",
        "grep",
        "Search file contents",
        "runtime",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        false,
    ),
    core_tool(
        "find",
        "find",
        "Find files and directories",
        "runtime",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        false,
    ),
    core_tool(
        "ls",
        "ls",
        "List directory contents",
        "runtime",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        false,
    ),
    core_tool(
        "web_search",
        "web_search",
        "Search the web",
        "web",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "web_fetch",
        "web_fetch",
        "Fetch web content",
        "web",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "session_status",
        "session_status",
        "Session status",
        "sessions",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "sessions_list",
        "sessions_list",
        "List sessions",
        "sessions",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "sessions_history",
        "sessions_history",
        "Session history",
        "sessions",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "sessions_send",
        "sessions_send",
        "Send to session",
        "sessions",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    core_tool(
        "subagents_spawn",
        "subagents_spawn",
        "Spawn sub-agent",
        "sessions",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    core_tool(
        "sessions_yield",
        "sessions_yield",
        "End turn to receive sub-agent results",
        "sessions",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    core_tool(
        "subagents",
        "subagents",
        "Manage sub-agents",
        "sessions",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "canvas",
        "canvas",
        "Control canvases",
        "ui",
        PROFILE_NONE,
        true,
        true,
    ),
    core_tool(
        "message",
        "message",
        "Send messages",
        "messaging",
        PROFILE_MESSAGING,
        false,
        true,
    ),
    core_tool(
        "cron",
        "cron",
        "Schedule tasks",
        "automation",
        PROFILE_FULL,
        false,
        true,
    ),
    core_tool(
        "image",
        "image",
        "Image understanding",
        "media",
        PROFILE_FULL,
        true,
        true,
    ),
    core_tool(
        "pdf",
        "pdf",
        "PDF analysis",
        "media",
        PROFILE_FULL,
        true,
        true,
    ),
    core_tool(
        "tts",
        "tts",
        "Text-to-speech conversion",
        "media",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    core_tool(
        "tool_search",
        "tool_search",
        "Search deferred tools",
        "runtime",
        PROFILE_MINIMAL_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "discover_skills",
        "discover_skills",
        "Search available skills",
        "skills",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "load_skill",
        "load_skill",
        "Load full skill instructions",
        "skills",
        PROFILE_CODING_FULL,
        true,
        true,
    ),
    core_tool(
        "workflow",
        "workflow",
        "Manage and run workflows",
        "workflow",
        PROFILE_FULL,
        false,
        true,
    ),
    core_tool(
        "workflowize",
        "workflowize",
        "Create workflow drafts",
        "workflow",
        PROFILE_FULL,
        false,
        true,
    ),
    core_tool(
        "review_task",
        "review_task",
        "Review task completion",
        "review",
        PROFILE_FULL,
        true,
        true,
    ),
    core_tool(
        "write_experience_note",
        "write_experience_note",
        "Write reusable experience notes",
        "memory",
        PROFILE_CODING_FULL,
        false,
        true,
    ),
    special_agent_tool(
        "memory_manifest_read",
        "memory_manifest_read",
        "Read scoped durable-memory manifest",
        "memory",
        true,
    ),
    special_agent_tool(
        "memory_note_read",
        "memory_note_read",
        "Read scoped durable-memory notes",
        "memory",
        true,
    ),
    special_agent_tool(
        "memory_note_write",
        "memory_note_write",
        "Write scoped durable-memory notes",
        "memory",
        false,
    ),
    special_agent_tool(
        "memory_note_edit",
        "memory_note_edit",
        "Edit scoped durable-memory notes",
        "memory",
        false,
    ),
    special_agent_tool(
        "memory_note_delete",
        "memory_note_delete",
        "Delete scoped durable-memory notes",
        "memory",
        false,
    ),
    special_agent_tool(
        "session_summary_file_read",
        "session_summary_file_read",
        "Read session-summary files",
        "session_summary",
        true,
    ),
    special_agent_tool(
        "session_summary_file_edit",
        "session_summary_file_edit",
        "Edit session-summary files",
        "session_summary",
        false,
    ),
];

pub fn rust_core_tool_definitions() -> &'static [RustCoreToolDefinition] {
    RUST_CORE_TOOL_DEFINITIONS
}

pub fn rust_core_tool_sections() -> &'static [RustCoreToolSection] {
    RUST_CORE_TOOL_SECTIONS
}

pub fn native_plugin_descriptors() -> Vec<crawclaw_plugin_sdk::NativePluginDescriptor> {
    crawclaw_native_plugins::registry::builtin_native_plugin_descriptors()
}

pub fn native_plugin_tool_descriptors() -> Vec<(String, crawclaw_plugin_sdk::NativeToolDescriptor)>
{
    crawclaw_native_plugins::registry::builtin_native_tool_descriptors()
}

pub fn rust_tool_catalog_json_payload() -> Value {
    let native_tools = native_plugin_tool_descriptors()
        .into_iter()
        .map(|(plugin_id, descriptor)| {
            json!({
                "id": descriptor.name,
                "label": descriptor.label,
                "description": descriptor.description,
                "sectionId": "runtime",
                "defaultProfiles": descriptor.default_profiles,
                "lifecycle": "runtime_conditional",
                "includeInCrawClawGroup": true,
                "defaultEnabled": descriptor.default_enabled,
                "readOnly": descriptor.read_only,
                "status": "rust-native",
                "source": "native-plugin",
                "pluginId": plugin_id
            })
        })
        .collect::<Vec<_>>();

    json!({
        "sections": rust_core_tool_sections(),
        "coreTools": rust_core_tool_definitions(),
        "nativeTools": native_tools,
        "mcpTools": []
    })
}

pub fn render_rust_tool_catalog_artifact() -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(&rust_tool_catalog_json_payload())
            .expect("Rust tool catalog encodes as JSON")
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustToolCatalogWriteResult {
    pub changed: bool,
    pub wrote: bool,
    pub output_path: PathBuf,
}

pub fn write_rust_tool_catalog_artifact(
    output_path: impl AsRef<Path>,
    check: bool,
) -> Result<RustToolCatalogWriteResult, String> {
    let output_path = output_path.as_ref().to_path_buf();
    let next = render_rust_tool_catalog_artifact();
    let current = match fs::read_to_string(&output_path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("failed to read {}: {error}", output_path.display())),
    };
    let changed = current.as_deref() != Some(next.as_str());
    if check {
        return Ok(RustToolCatalogWriteResult {
            changed,
            wrote: false,
            output_path,
        });
    }
    if changed {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        }
        fs::write(&output_path, next)
            .map_err(|error| format!("failed to write {}: {error}", output_path.display()))?;
    }
    Ok(RustToolCatalogWriteResult {
        changed,
        wrote: changed,
        output_path,
    })
}

pub fn native_plugin_registry(runtime_root: &Path) -> NativePluginRegistry {
    load_native_plugin_registry(runtime_root)
}

pub fn native_plugin_descriptors_for_runtime_root(
    runtime_root: &Path,
) -> Vec<crawclaw_plugin_sdk::NativePluginDescriptor> {
    native_plugin_registry(runtime_root).descriptors()
}

pub fn native_plugin_tool_descriptors_for_runtime_root(
    runtime_root: &Path,
) -> Vec<(String, crawclaw_plugin_sdk::NativeToolDescriptor)> {
    native_plugin_registry(runtime_root).tool_descriptors()
}

pub fn pi_agent_rust_tool_names() -> Vec<String> {
    let mut names = RUST_CORE_TOOL_DEFINITIONS
        .iter()
        .map(|definition| definition.id)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let native_names = native_plugin_tool_descriptors()
        .into_iter()
        .map(|(_, descriptor)| descriptor.name)
        .collect::<Vec<_>>();
    let insert_at = names
        .iter()
        .position(|name| name == "grep")
        .unwrap_or(names.len());
    names.splice(insert_at..insert_at, native_names);
    names
}

pub fn pi_agent_rust_tool_names_for_runtime_root(runtime_root: &Path) -> Vec<String> {
    let mut names = RUST_CORE_TOOL_DEFINITIONS
        .iter()
        .map(|definition| definition.id)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let native_names = native_plugin_tool_descriptors_for_runtime_root(runtime_root)
        .into_iter()
        .map(|(_, descriptor)| descriptor.name)
        .collect::<Vec<_>>();
    let insert_at = names
        .iter()
        .position(|name| name == "grep")
        .unwrap_or(names.len());
    names.splice(insert_at..insert_at, native_names);
    names
}

pub fn pi_agent_rust_tool_descriptors_for_runtime_root(
    runtime_root: &Path,
) -> Vec<RustAgentToolDescriptor> {
    build_pi_agent_rust_tool_registry(runtime_root)
        .tools()
        .iter()
        .map(|tool| RustAgentToolDescriptor {
            name: tool.name().to_string(),
            label: tool.label().to_string(),
            description: tool.description().to_string(),
            parameters: tool.parameters(),
            read_only: tool.is_read_only(),
        })
        .collect()
}

pub(crate) fn is_special_agent_only_tool(tool_name: &str) -> bool {
    RUST_CORE_TOOL_DEFINITIONS.iter().any(|definition| {
        definition.id == tool_name && definition.lifecycle == "special_agent_only"
    })
}

#[doc(hidden)]
pub fn build_pi_agent_rust_tool_registry_for_test(runtime_root: &Path) -> pi::sdk::ToolRegistry {
    build_pi_agent_rust_tool_registry(runtime_root)
}

#[doc(hidden)]
pub fn build_pi_agent_rust_tool_registry_with_permission_policy_for_test(
    runtime_root: &Path,
    policy: AgentRuntimePermissionPolicy,
) -> pi::sdk::ToolRegistry {
    apply_permission_policy_to_registry(
        build_pi_agent_rust_tool_registry(runtime_root),
        Some(policy),
    )
}

pub async fn execute_rust_core_tool(
    runtime_root: &Path,
    tool_name: &str,
    input: Value,
) -> Result<Value, String> {
    execute_rust_core_tool_with_profile_guard(runtime_root, tool_name, input, None).await
}

#[derive(Clone, Debug)]
pub struct ToolExecutionRuntime {
    runtime_root: PathBuf,
    active_profile: Option<(AgentRunProfileKind, Option<String>)>,
}

impl ToolExecutionRuntime {
    pub fn new(runtime_root: impl Into<PathBuf>) -> Self {
        Self {
            runtime_root: runtime_root.into(),
            active_profile: None,
        }
    }

    pub fn with_profile(
        runtime_root: impl Into<PathBuf>,
        profile_kind: AgentRunProfileKind,
        special_agent: Option<String>,
    ) -> Self {
        Self {
            runtime_root: runtime_root.into(),
            active_profile: Some((profile_kind, special_agent)),
        }
    }

    pub async fn execute(&self, tool_name: &str, input: Value) -> Result<Value, String> {
        execute_rust_core_tool_with_profile_guard(
            &self.runtime_root,
            tool_name,
            input,
            self.active_profile.clone(),
        )
        .await
    }
}

pub async fn execute_rust_core_tool_for_profile(
    runtime_root: &Path,
    tool_name: &str,
    input: Value,
    profile_kind: AgentRunProfileKind,
    special_agent: Option<&str>,
) -> Result<Value, String> {
    execute_rust_core_tool_with_profile_guard(
        runtime_root,
        tool_name,
        input,
        Some((profile_kind, special_agent.map(ToOwned::to_owned))),
    )
    .await
}

async fn execute_rust_core_tool_with_profile_guard(
    runtime_root: &Path,
    tool_name: &str,
    input: Value,
    active_profile: Option<(AgentRunProfileKind, Option<String>)>,
) -> Result<Value, String> {
    if is_special_agent_only_tool(tool_name) && active_profile.is_none() {
        return Err(format!(
            "Rust runtime tool {tool_name} is special-agent-only and requires an active special-agent profile"
        ));
    }
    let registry = build_pi_agent_rust_tool_registry(runtime_root);
    let tool = registry
        .get(tool_name)
        .ok_or_else(|| format!("unknown Rust runtime tool: {tool_name}"))?;
    let output = tool
        .execute("runtime-worker", input, None)
        .await
        .map_err(|error| error.to_string())?;
    let mut value = tool_output_to_value(&output);
    if let Some((profile_kind, special_agent)) = active_profile {
        enrich_profiled_tool_output(&mut value, profile_kind, special_agent.as_deref());
    }
    Ok(value)
}

fn enrich_profiled_tool_output(
    output: &mut Value,
    profile_kind: AgentRunProfileKind,
    special_agent: Option<&str>,
) {
    let details = output
        .as_object_mut()
        .and_then(|object| object.get_mut("details"))
        .and_then(Value::as_object_mut);
    let Some(details) = details else {
        return;
    };
    details.insert(
        "profileKind".to_string(),
        json!(profile_kind_summary(profile_kind)),
    );
    if let Some(special_agent) = special_agent {
        details.insert("specialAgent".to_string(), json!(special_agent));
    }
    details.insert(
        "toolExecution".to_string(),
        json!({
            "status": "completed",
            "runtime": "rust-native",
            "profileGuard": "active"
        }),
    );
}

fn profile_kind_summary(kind: AgentRunProfileKind) -> &'static str {
    match kind {
        AgentRunProfileKind::Normal => "normal",
        AgentRunProfileKind::Btw => "btw",
        AgentRunProfileKind::Subagent => "subagent",
        AgentRunProfileKind::SpecialAgent => "special_agent",
        AgentRunProfileKind::Compaction => "compaction",
        AgentRunProfileKind::MemoryMaintenance => "memory_maintenance",
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativePluginInvokeWorkerRequest {
    plugin_id: String,
    operation: String,
    #[serde(default)]
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativePluginServiceWorkerRequest {
    plugin_id: String,
    service_id: String,
    #[serde(default = "default_true")]
    start: bool,
    #[serde(default)]
    input: Value,
}

pub(super) fn default_true() -> bool {
    true
}

pub(super) fn native_target_matches(
    target: &NativeInvocationTarget,
    plugin_id: &str,
    operation: &str,
) -> bool {
    target.plugin_id == plugin_id && target.operation == operation
}

pub(super) fn native_descriptor_declares_invocation(
    descriptor: &NativePluginDescriptor,
    plugin_id: &str,
    operation: &str,
) -> bool {
    descriptor
        .tools
        .iter()
        .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor
            .gateway_methods
            .iter()
            .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor
            .web_search_providers
            .iter()
            .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor
            .web_fetch_providers
            .iter()
            .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor
            .speech_providers
            .iter()
            .any(|entry| native_target_matches(&entry.synthesize, plugin_id, operation))
        || descriptor
            .media_understanding_providers
            .iter()
            .any(|entry| native_target_matches(&entry.invocation, plugin_id, operation))
        || descriptor.services.iter().any(|entry| {
            native_target_matches(&entry.start, plugin_id, operation)
                || native_target_matches(&entry.stop, plugin_id, operation)
        })
}

pub async fn execute_native_plugin_invoke_operation(
    runtime_root: &Path,
    input: Value,
) -> Result<Value, String> {
    let request = serde_json::from_value::<NativePluginInvokeWorkerRequest>(input)
        .map_err(|error| format!("invalid native_plugin_invoke request: {error}"))?;
    let registry = load_native_plugin_registry(runtime_root);
    let entry = registry
        .entries
        .into_iter()
        .find(|entry| entry.descriptor.plugin_id == request.plugin_id)
        .ok_or_else(|| format!("unknown native plugin: {}", request.plugin_id))?;
    if !native_descriptor_declares_invocation(
        &entry.descriptor,
        &request.plugin_id,
        &request.operation,
    ) {
        return Err(format!(
            "native plugin operation is not declared by descriptor: {}/{}",
            request.plugin_id, request.operation
        ));
    }
    let runtime = entry.runtime;
    let input = if matches!(&runtime, NativePluginRuntime::Builtin) {
        with_native_runtime_context(runtime_root, request.input)
    } else {
        request.input
    };
    invoke_native_plugin_operation(
        runtime,
        NativeInvocationTarget {
            plugin_id: request.plugin_id,
            operation: request.operation,
        },
        input,
    )
    .await
}

pub async fn execute_native_plugin_service_lifecycle_operation(
    runtime_root: &Path,
    input: Value,
) -> Result<Value, String> {
    let request = serde_json::from_value::<NativePluginServiceWorkerRequest>(input)
        .map_err(|error| format!("invalid native_plugin_service request: {error}"))?;
    let registry = load_native_plugin_registry(runtime_root);
    let is_builtin = registry
        .entries
        .iter()
        .find(|entry| entry.descriptor.plugin_id == request.plugin_id)
        .map(|entry| matches!(&entry.runtime, NativePluginRuntime::Builtin))
        .unwrap_or(false);
    let input = if is_builtin {
        with_native_runtime_context(runtime_root, request.input)
    } else {
        request.input
    };
    dispatch_native_service_lifecycle(
        registry,
        &request.plugin_id,
        &request.service_id,
        request.start,
        input,
    )
    .await
}

pub async fn execute_agent_run_turn_operation(
    runtime_root: &Path,
    input: Value,
) -> Result<Value, String> {
    let request = serde_json::from_value::<AgentRunRequest>(input)
        .map_err(|error| format!("invalid agent_run_turn request: {error}"))?;
    let result = AgentRuntime::new(runtime_root.to_path_buf())
        .run_turn(request)
        .await
        .map_err(|error| format!("{}: {}", error.code(), error.message()))?;
    serde_json::to_value(result)
        .map_err(|error| format!("failed to serialize agent_run_turn result: {error}"))
}

pub async fn execute_memory_runtime_operation(
    runtime_root: &Path,
    operation: &str,
    input: Value,
) -> Result<Value, String> {
    memory::execute_memory_runtime_operation(runtime_root, operation, input).await
}

pub async fn execute_cron_runtime_operation(
    runtime_root: &Path,
    operation: &str,
    input: Value,
) -> Result<Value, String> {
    cron::execute_cron_runtime_operation(runtime_root, operation, input).await
}

pub(super) fn tool_output_to_value(output: &pi::sdk::ToolOutput) -> Value {
    let mut text_blocks = Vec::new();
    let content = output
        .content
        .iter()
        .map(|block| match block {
            pi::sdk::ContentBlock::Text(text) => {
                text_blocks.push(text.text.clone());
                json!({ "type": "text", "text": text.text })
            }
            pi::sdk::ContentBlock::Image(image) => json!({
                "type": "image",
                "data": image.data,
                "mimeType": image.mime_type
            }),
            _ => {
                let text = "unsupported tool content block".to_string();
                text_blocks.push(text.clone());
                json!({ "type": "text", "text": text })
            }
        })
        .collect::<Vec<_>>();
    json!({
        "content": content,
        "text": text_blocks.join("\n"),
        "details": output.details,
        "isError": output.is_error
    })
}

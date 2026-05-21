use serde::{Deserialize, Serialize};

pub use crawclaw_core::{RuntimeCompatStatus, RuntimeStatusValue};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub status: RuntimeStatusValue,
    pub detail: String,
    pub runtime_root: String,
    pub binary_path: String,
    pub compat: RuntimeCompatStatus,
    #[serde(default)]
    pub node_path: String,
    #[serde(default)]
    pub entrypoint_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResponse {
    pub app: DesktopAppInfo,
    pub api: DesktopApiInfo,
    pub runtime: RuntimeStatus,
    pub desktop_state: DesktopState,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAppInfo {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopApiInfo {
    pub base_url: String,
    pub events_url: String,
    pub session_token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEvent {
    #[serde(rename = "type")]
    pub event_type: &'static str,
    pub status: RuntimeStatusValue,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DesktopEvent {
    Runtime {
        status: RuntimeStatusValue,
        detail: String,
    },
    RuntimeChanged {
        runtime: RuntimeStatus,
    },
    SessionStarted {
        thread_id: String,
    },
    MessageDelta {
        thread_id: String,
        text: String,
    },
    ToolCall {
        thread_id: String,
        tool_id: String,
    },
    ToolResult {
        thread_id: String,
        tool_id: String,
        ok: bool,
    },
    MessageFinal {
        thread_id: String,
        text: String,
    },
    PermissionRequested {
        permission_request: PermissionRequest,
    },
    OperationFailed {
        code: String,
        message: String,
    },
    StateChanged {
        desktop_state: DesktopState,
    },
    PermissionChanged {
        permission_request: PermissionRequest,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopState {
    pub active_nav_id: String,
    pub sidebar: SidebarState,
    pub conversation: ConversationState,
    pub agent_workspace: AgentWorkspaceState,
    pub memory_workspace: MemoryWorkspaceState,
    pub plugins_workspace: PluginsWorkspaceState,
    pub preferences: DesktopPreferences,
    pub permission_request: PermissionRequest,
    pub search_suggestions: Vec<SearchSuggestion>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarState {
    pub nav_items: Vec<NavItem>,
    pub pinned_threads: Vec<SidebarThread>,
    pub threads: Vec<SidebarThread>,
    pub discussion_threads: Vec<SidebarThread>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NavItem {
    pub id: String,
    pub label: String,
    pub icon: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarThread {
    pub id: String,
    pub title: String,
    pub time: String,
    pub active: bool,
    pub agent_avatar: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationState {
    pub result_items: Vec<String>,
    pub runtime_checks: Vec<RuntimeCheck>,
    pub slash_commands: Vec<CommandSuggestion>,
    pub skill_commands: Vec<SkillSuggestion>,
    pub draft_messages: Vec<DraftMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCheck {
    pub label: String,
    pub value: String,
    pub tone: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestion {
    pub id: String,
    pub label: String,
    pub command: String,
    pub detail: String,
    pub icon: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSuggestion {
    pub id: String,
    pub label: String,
    pub mention: String,
    pub detail: String,
    pub icon: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftMessage {
    pub id: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceState {
    pub selected_agent_id: String,
    pub agents: Vec<AgentProfile>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    pub role: String,
    pub description: String,
    pub status: String,
    pub model: String,
    pub thinking: String,
    pub permission_mode: String,
    pub emotion: AgentEmotionProfile,
    pub voice: AgentVoiceConfig,
    pub channels: Vec<AgentChannelBinding>,
    pub avatar: AgentAvatarProfile,
    pub tools: Vec<AgentTool>,
    pub skills: Vec<AgentSkill>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEmotionProfile {
    pub style: String,
    pub tone: String,
    pub boundaries: Vec<String>,
    #[serde(default)]
    pub prompt_md: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentVoiceConfig {
    pub enabled: bool,
    pub input_enabled: bool,
    pub output_enabled: bool,
    pub wake_enabled: bool,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub preset_voice: String,
    #[serde(default)]
    pub design_prompt: String,
    #[serde(default)]
    pub clone_voice_name: String,
    #[serde(default)]
    pub clone_sample_name: String,
    pub style: String,
    pub pace: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentChannelBinding {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<AgentChannelConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentChannelConfig {
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub dm_policy: String,
    #[serde(default)]
    pub fields: Vec<AgentChannelConfigField>,
    #[serde(default)]
    pub group_policy: String,
    #[serde(default)]
    pub target: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentChannelConfigField {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAvatarProfile {
    pub initials: String,
    pub gradient: String,
    #[serde(default)]
    pub image_data_url: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub permission: String,
    pub icon: String,
    pub open: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkill {
    pub id: String,
    pub name: String,
    pub trigger: String,
    pub description: String,
    pub status: String,
    pub source: String,
    pub icon: String,
    pub open: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryWorkspaceState {
    pub selected_agent_id: String,
    pub selected_item_id: String,
    pub filter: String,
    pub query: String,
    pub dream: MemoryDreamState,
    pub items: Vec<MemoryItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDreamState {
    pub status: String,
    pub agent_id: String,
    pub message: String,
    pub last_run_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
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
pub struct CreateMemoryItemInput {
    pub title: String,
    pub summary: String,
    pub content: String,
    pub category: String,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryItemPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentInput {
    pub name: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emotion: Option<AgentEmotionProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice: Option<AgentVoiceConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channels: Option<Vec<AgentChannelBinding>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<AgentAvatarProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddAgentSkillInput {
    pub name: String,
    pub trigger: String,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginsWorkspaceState {
    pub tools: Vec<PluginTool>,
    pub skills: Vec<PluginSkill>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub permission: String,
    pub icon: String,
    pub open: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkill {
    pub id: String,
    pub name: String,
    pub trigger: String,
    pub description: String,
    pub status: String,
    pub source: String,
    pub icon: String,
    pub open: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddPluginSkillInput {
    pub name: String,
    pub trigger: String,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub selected_model: String,
    pub selected_thinking: String,
    pub permission_mode: String,
    pub model_options: Vec<String>,
    #[serde(default)]
    pub provider_descriptors: serde_json::Value,
    #[serde(default)]
    pub provider_setup_options: serde_json::Value,
    #[serde(default)]
    pub provider_model_picker_entries: serde_json::Value,
    #[serde(default)]
    pub web_provider_boundaries: serde_json::Value,
    pub thinking_options: Vec<String>,
    pub permission_mode_options: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub id: String,
    pub status: PermissionStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionStatus {
    Pending,
    Approved,
    Denied,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSuggestion {
    pub id: String,
    pub label: String,
    pub meta: String,
    pub icon: String,
    pub target_nav_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_item_id: Option<String>,
}

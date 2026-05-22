use crate::models::{
    AgentWorkspaceState, ConversationState, DesktopPreferences, DesktopState, MemoryDreamState,
    MemoryWorkspaceState, NavItem, PermissionRequest, PermissionStatus, PluginsWorkspaceState,
    RuntimeCheck, RuntimeStatus, RuntimeStatusValue, SidebarState,
};

pub fn initial_desktop_state(runtime: &RuntimeStatus) -> DesktopState {
    DesktopState {
        active_nav_id: "new-chat".to_string(),
        sidebar: SidebarState {
            nav_items: vec![
                nav_item("new-chat", "新对话", "squarePen"),
                nav_item("search", "搜索", "search"),
                nav_item("agent", "智能体", "bot"),
                nav_item("plugins", "插件", "blocks"),
                nav_item("automation", "自动化", "clock3"),
                nav_item("memory", "记忆", "brain"),
            ],
            pinned_threads: Vec::new(),
            threads: Vec::new(),
            discussion_threads: Vec::new(),
        },
        conversation: ConversationState {
            messages: Vec::new(),
            result_items: vec![runtime.detail.clone()],
            runtime_checks: vec![
                RuntimeCheck {
                    label: "Desktop Shell".to_string(),
                    value: "已加载".to_string(),
                    tone: "ok".to_string(),
                },
                RuntimeCheck {
                    label: "Desktop API".to_string(),
                    value: "ready".to_string(),
                    tone: "ok".to_string(),
                },
                RuntimeCheck {
                    label: "Runtime".to_string(),
                    value: runtime_status_label(&runtime.status).to_string(),
                    tone: runtime_status_tone(&runtime.status).to_string(),
                },
            ],
            slash_commands: Vec::new(),
            skill_commands: Vec::new(),
            draft_messages: Vec::new(),
        },
        agent_workspace: AgentWorkspaceState {
            selected_agent_id: String::new(),
            agents: Vec::new(),
        },
        memory_workspace: MemoryWorkspaceState {
            selected_agent_id: String::new(),
            selected_item_id: String::new(),
            filter: "全部".to_string(),
            query: String::new(),
            dream: MemoryDreamState {
                status: "idle".to_string(),
                agent_id: String::new(),
                message: String::new(),
                last_run_at: String::new(),
            },
            items: Vec::new(),
        },
        plugins_workspace: PluginsWorkspaceState {
            tools: Vec::new(),
            skills: Vec::new(),
        },
        preferences: DesktopPreferences {
            selected_model: "gpt-5.5".to_string(),
            selected_thinking: "high".to_string(),
            permission_mode: "工作区模式".to_string(),
            model_options: crawclaw_providers::default_model_options(),
            provider_descriptors: serde_json::to_value(
                crawclaw_providers::bundled_provider_descriptors(),
            )
            .unwrap_or_else(|_| serde_json::json!([])),
            provider_setup_options: serde_json::to_value(
                crawclaw_providers::bundled_provider_setup_options(),
            )
            .unwrap_or_else(|_| serde_json::json!([])),
            provider_model_picker_entries: serde_json::to_value(
                crawclaw_providers::bundled_provider_model_picker_entries(),
            )
            .unwrap_or_else(|_| serde_json::json!([])),
            web_provider_boundaries: serde_json::to_value(
                crawclaw_providers::bundled_web_provider_boundaries(),
            )
            .unwrap_or_else(|_| serde_json::json!([])),
            thinking_options: vec!["high".to_string(), "medium".to_string(), "low".to_string()],
            permission_mode_options: vec![
                "工作区模式".to_string(),
                "只读模式".to_string(),
                "完全访问".to_string(),
            ],
        },
        permission_request: PermissionRequest {
            id: String::new(),
            status: PermissionStatus::Denied,
        },
        search_suggestions: Vec::new(),
    }
}

fn nav_item(id: &str, label: &str, icon: &str) -> NavItem {
    NavItem {
        id: id.to_string(),
        label: label.to_string(),
        icon: icon.to_string(),
    }
}

fn runtime_status_label(status: &RuntimeStatusValue) -> &'static str {
    match status {
        RuntimeStatusValue::Missing => "missing",
        RuntimeStatusValue::Checking => "checking",
        RuntimeStatusValue::Ready => "ready",
        RuntimeStatusValue::Error => "error",
    }
}

fn runtime_status_tone(status: &RuntimeStatusValue) -> &'static str {
    match status {
        RuntimeStatusValue::Ready => "ok",
        RuntimeStatusValue::Checking => "neutral",
        RuntimeStatusValue::Missing | RuntimeStatusValue::Error => "danger",
    }
}

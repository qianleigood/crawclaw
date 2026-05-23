use crate::models::{
    AdvancedDefaults, AgentWorkspaceState, ConfirmationDefaults, ConversationState,
    DesktopPreferences, DesktopState, MemoryDefaults, MemoryDreamState, MemoryWorkspaceState,
    NavItem, NotificationDefaults, PermissionRequest, PermissionStatus, PluginsWorkspaceState,
    PrivacyDefaults, RuntimeCheck, RuntimeStatus, RuntimeStatusValue, SidebarState, TaskDefaults,
    UiDefaults,
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
            task_defaults: task_defaults(),
            confirmation_defaults: confirmation_defaults(),
            notification_defaults: notification_defaults(),
            ui_defaults: ui_defaults(),
            memory_defaults: memory_defaults(),
            privacy_defaults: privacy_defaults(),
            advanced_defaults: advanced_defaults(),
            model_options: crawclaw_providers::default_model_options(),
            model_profiles: Vec::new(),
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
            title: String::new(),
            detail: String::new(),
            status: PermissionStatus::Denied,
        },
        search_suggestions: Vec::new(),
    }
}

fn task_defaults() -> TaskDefaults {
    TaskDefaults {
        selected_model: "gpt-5.5".to_string(),
        selected_thinking: "high".to_string(),
        permission_mode: "工作区模式".to_string(),
        response_speed: "标准".to_string(),
        allow_tools: true,
        show_reasoning_summary: false,
    }
}

fn confirmation_defaults() -> ConfirmationDefaults {
    ConfirmationDefaults {
        confirm_file_changes: true,
        confirm_commands: true,
        confirm_external_apps: true,
        confirm_high_risk: true,
    }
}

fn notification_defaults() -> NotificationDefaults {
    NotificationDefaults {
        notify_task_done: true,
        notify_confirm_needed: true,
        notify_dream_done: true,
        notify_automation_failed: true,
        notification_sound: false,
    }
}

fn ui_defaults() -> UiDefaults {
    UiDefaults {
        default_page: "新对话".to_string(),
        language: "中文".to_string(),
        appearance: "跟随系统".to_string(),
        launch_at_login: false,
        show_in_menu_bar: true,
    }
}

fn memory_defaults() -> MemoryDefaults {
    MemoryDefaults {
        remember_preferences: true,
        remember_project_context: true,
        memory_dream_enabled: true,
        memory_dream_frequency: "空闲时".to_string(),
        memory_cleanup_confirmation: "每次确认".to_string(),
    }
}

fn privacy_defaults() -> PrivacyDefaults {
    PrivacyDefaults {
        data_location: "本机默认位置".to_string(),
    }
}

fn advanced_defaults() -> AdvancedDefaults {
    AdvancedDefaults {
        log_level: "标准".to_string(),
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

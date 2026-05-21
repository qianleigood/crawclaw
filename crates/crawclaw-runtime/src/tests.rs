use super::*;
use futures::StreamExt;
use pi::sdk::Provider;
use serde_json::json;
use std::future::Future;
use std::io::Read;
use std::net::TcpListener;
use std::pin::Pin;
use std::sync::mpsc;
use std::thread;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("repo root")
        .to_path_buf()
}

fn collect_ts_files(root: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(root).expect("read source directory") {
        let entry = entry.expect("source directory entry");
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == "node_modules") {
                continue;
            }
            collect_ts_files(&path, files);
        } else if path.is_file()
            && path
                .extension()
                .is_some_and(|ext| ext == "ts" || ext == "tsx")
        {
            files.push(path);
        }
    }
}

fn collect_script_files(root: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(root).expect("read source directory") {
        let entry = entry.expect("source directory entry");
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == "node_modules") {
                continue;
            }
            collect_script_files(&path, files);
        } else if path.is_file()
            && path.extension().is_some_and(|ext| {
                matches!(
                    ext.to_string_lossy().as_ref(),
                    "ts" | "tsx" | "mts" | "cts" | "js" | "mjs" | "cjs"
                )
            })
        {
            files.push(path);
        }
    }
}

fn tracked_files(root: &Path) -> Vec<String> {
    let output = std::process::Command::new("git")
        .args(["ls-files"])
        .current_dir(root)
        .output()
        .expect("run git ls-files");
    assert!(
        output.status.success(),
        "git ls-files failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(ToOwned::to_owned)
        .collect()
}

fn slash_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn is_core_src_ts_test_surface(relative: &str) -> bool {
    (relative.starts_with("src/")
        || relative.starts_with("test/")
        || relative.starts_with("apps/crawclaw-desktop/"))
        && (relative.ends_with(".test.ts")
            || relative.ends_with(".test.tsx")
            || relative.ends_with(".live.test.ts")
            || relative.ends_with(".e2e.test.ts")
            || relative.ends_with(".e2e.test.tsx")
            || relative.ends_with(".suite.ts")
            || relative.ends_with(".test-helpers.ts")
            || relative.ends_with(".test-utils.ts")
            || relative.ends_with(".test-support.ts")
            || relative.ends_with(".test-mocks.ts")
            || relative.ends_with(".test-harness.ts")
            || relative.ends_with(".e2e-harness.ts")
            || relative.ends_with("-test-helpers.ts")
            || relative.ends_with("/test-helpers.ts")
            || relative.ends_with("/test-utils.ts")
            || relative.contains("/test-helpers/")
            || relative.contains("/test-utils/")
            || relative.starts_with("apps/crawclaw-desktop/src/test/")
            || relative.starts_with("test/"))
}

fn is_ts_declaration(relative: &str) -> bool {
    relative.ends_with(".d.ts") || relative.ends_with(".d.tsx")
}

fn is_script_source(relative: &str) -> bool {
    [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]
        .iter()
        .any(|extension| relative.ends_with(extension))
}

fn is_allowed_desktop_script_surface(relative: &str) -> bool {
    relative.starts_with("apps/crawclaw-desktop/src/")
        || relative == "apps/crawclaw-desktop/vite.config.ts"
}

#[test]
fn rust_runtime_repo_guardrails_keep_desktop_renderer_fixture_runtime_absent() {
    let root = repo_root();
    let source_path = root.join("apps/crawclaw-desktop/src/desktop-api.ts");
    let source = fs::read_to_string(&source_path).expect("read desktop API client");
    let forbidden_needles = [
        "createDesktopFixtureState",
        "VITE_CRAWCLAW_DESKTOP_FIXTURE",
        "mode: 'fixture'",
        "fixtureState",
        "mutateFixture",
        "searchFixture",
        "fixture-session",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
        hits.is_empty(),
        "removed TypeScript desktop fixture runtime came back: {hits:?}"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_desktop_api_barrel_thin() {
    let root = repo_root();
    let source_path = root.join("apps/crawclaw-desktop/src/desktop-api.ts");
    let source = fs::read_to_string(&source_path).expect("read desktop API barrel");
    let forbidden_needles = [
        "await fetch(",
        "new EventSource",
        "invoke<",
        "interface DesktopApiContext",
        "let apiContext",
        "function requestDesktop",
        "export interface",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            hits.is_empty(),
            "desktop-api.ts must stay a thin barrel around Rust-owned contract and api modules: {hits:?}"
        );
    assert!(
        source.contains("./generated/desktop-api-contract.generated"),
        "desktop-api.ts must re-export the Rust-generated desktop API contract"
    );
    assert!(
        source.contains("./api/desktop-client")
            && source.contains("./api/desktop-events")
            && source.contains("./api/desktop-initial-state")
            && source.contains("./api/desktop-transport"),
        "desktop-api.ts must re-export focused desktop API modules"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_desktop_memory_view_split() {
    let root = repo_root();
    let app_path = root.join("apps/crawclaw-desktop/src/App.tsx");
    let memory_view_path = root.join("apps/crawclaw-desktop/src/views/memory-workspace.tsx");
    let app_source = fs::read_to_string(&app_path).expect("read desktop app");
    assert!(
            memory_view_path.is_file(),
            "desktop memory workspace view must live in apps/crawclaw-desktop/src/views/memory-workspace.tsx"
        );
    assert!(
        !app_source.contains("const renderMemoryWorkspace"),
        "App.tsx should compose MemoryWorkspace instead of owning the memory workspace render tree"
    );
    let forbidden_needles = [
        "blankMemoryDraft",
        "memoryDraft",
        "isMemoryFormOpen",
        "isMemoryEditing",
        "visibleMemories",
        "selectedMemory",
        "submitMemory",
        "saveMemoryEdit",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| app_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            hits.is_empty(),
            "memory workspace form/edit/search state must stay inside memory-workspace.tsx, not App.tsx: {hits:?}"
        );
}

#[test]
fn rust_runtime_repo_guardrails_keep_desktop_plugins_view_split() {
    let root = repo_root();
    let app_path = root.join("apps/crawclaw-desktop/src/App.tsx");
    let plugins_view_path = root.join("apps/crawclaw-desktop/src/views/plugins-workspace.tsx");
    let app_source = fs::read_to_string(&app_path).expect("read desktop app");
    assert!(
            plugins_view_path.is_file(),
            "desktop plugins workspace view must live in apps/crawclaw-desktop/src/views/plugins-workspace.tsx"
        );
    assert!(
            !app_source.contains("const renderPluginWorkspace"),
            "App.tsx should compose PluginsWorkspace instead of owning the plugins workspace render tree"
        );
    let forbidden_needles = [
        "PluginSkillDialogPhase",
        "pluginSourceFilter",
        "pluginStatusFilter",
        "pluginSearchQuery",
        "pluginSkillAddress",
        "pluginSkillDialogPhase",
        "pluginSkillInstallStatuses",
        "visiblePluginSkills",
        "submitPluginSkill",
        "deriveSkillFromAddress",
        "formatSkillAddressSource",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| app_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            hits.is_empty(),
            "plugin workspace search/filter/dialog state must stay inside plugins-workspace.tsx, not App.tsx: {hits:?}"
        );
}

#[test]
fn rust_runtime_repo_guardrails_keep_desktop_settings_view_split() {
    let root = repo_root();
    let app_path = root.join("apps/crawclaw-desktop/src/App.tsx");
    let settings_view_path = root.join("apps/crawclaw-desktop/src/views/settings-workspace.tsx");
    let app_source = fs::read_to_string(&app_path).expect("read desktop app");
    assert!(
            settings_view_path.is_file(),
            "desktop settings workspace view must live in apps/crawclaw-desktop/src/views/settings-workspace.tsx"
        );
    assert!(
            !app_source.contains("const renderSettingsWorkspace")
                && !app_source.contains("const renderSettingsSidebar"),
            "App.tsx should compose SettingsWorkspace and SettingsSidebar instead of owning settings render trees"
        );
    let forbidden_needles = [
        "settingsUi",
        "isAddingModel",
        "modelDraftName",
        "setSettingsValue",
        "toggleSettingsValue",
        "submitCustomModel",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| app_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            hits.is_empty(),
            "settings workspace form and local UI state must stay inside settings-workspace.tsx, not App.tsx: {hits:?}"
        );
}

#[test]
fn rust_runtime_repo_guardrails_keep_desktop_agent_view_split() {
    let root = repo_root();
    let app_path = root.join("apps/crawclaw-desktop/src/App.tsx");
    let agent_view_path = root.join("apps/crawclaw-desktop/src/views/agent-workspace.tsx");
    let agent_wizard_path = root.join("apps/crawclaw-desktop/src/views/agent-create-wizard.tsx");
    let agent_wizard_model_path =
        root.join("apps/crawclaw-desktop/src/views/agent-create-wizard-model.ts");
    let agent_wizard_steps_path =
        root.join("apps/crawclaw-desktop/src/views/agent-create-wizard-steps.tsx");
    let agent_wizard_channel_step_path =
        root.join("apps/crawclaw-desktop/src/views/agent-create-wizard-channel-step.tsx");
    let agent_wizard_voice_step_path =
        root.join("apps/crawclaw-desktop/src/views/agent-create-wizard-voice-step.tsx");
    let app_source = fs::read_to_string(&app_path).expect("read desktop app");
    let agent_source = fs::read_to_string(&agent_view_path).expect("read agent workspace");
    let agent_wizard_source =
        fs::read_to_string(&agent_wizard_path).expect("read agent create wizard");
    let agent_wizard_steps_source =
        fs::read_to_string(&agent_wizard_steps_path).unwrap_or_default();
    assert!(
            agent_view_path.is_file(),
            "desktop agent workspace view must live in apps/crawclaw-desktop/src/views/agent-workspace.tsx"
        );
    assert!(
            agent_wizard_path.is_file(),
            "desktop agent creation wizard must live in apps/crawclaw-desktop/src/views/agent-create-wizard.tsx"
        );
    assert!(
            agent_wizard_model_path.is_file(),
            "desktop agent creation wizard model helpers must live in apps/crawclaw-desktop/src/views/agent-create-wizard-model.ts"
        );
    assert!(
            agent_wizard_steps_path.is_file(),
            "desktop agent creation wizard step renderers must live in apps/crawclaw-desktop/src/views/agent-create-wizard-steps.tsx"
        );
    assert!(
            agent_wizard_channel_step_path.is_file(),
            "desktop agent channel wizard step must live in apps/crawclaw-desktop/src/views/agent-create-wizard-channel-step.tsx"
        );
    assert!(
            agent_wizard_voice_step_path.is_file(),
            "desktop agent voice wizard step must live in apps/crawclaw-desktop/src/views/agent-create-wizard-voice-step.tsx"
        );
    assert!(
            !app_source.contains("const renderAgentWorkspace")
                && !app_source.contains("const renderAgentCreateWizard"),
            "App.tsx should compose AgentWorkspace instead of owning agent workspace and wizard render trees"
        );
    let forbidden_needles = [
        "AgentCreateDraft",
        "agentWizardSteps",
        "createAgentDraft",
        "renderAgentCreateWizard",
        "renderAgentWizardStepContent",
        "renderAgentChannelConfig",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| agent_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            hits.is_empty(),
            "agent creation wizard state and render tree must stay inside agent-create-wizard.tsx, not agent-workspace.tsx: {hits:?}"
        );
    let forbidden_wizard_model_declarations = [
        "const agentWizardSteps =",
        "const agentVoiceSourceOptions =",
        "type AgentCreateDraft =",
        "function createAgentDraft",
        "function createAgentAvatar",
        "function deriveAgentDraftRole",
        "function generateAgentAvatarDraft",
    ];
    let declaration_hits = forbidden_wizard_model_declarations
        .into_iter()
        .filter(|needle| agent_wizard_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            declaration_hits.is_empty(),
            "agent creation wizard pure model data and derivation helpers must stay in agent-create-wizard-model.ts, not agent-create-wizard.tsx: {declaration_hits:?}"
        );
    let forbidden_wizard_step_render_needles = [
        "renderAgentWizardStepContent",
        "renderAgentChannelConfig",
        "agent-create-wizard__identity",
        "agent-create-wizard__voice-source",
        "agent-create-wizard__channel-layout",
        "agent-create-wizard__model-layout",
        "agent-create-wizard__summary",
    ];
    let step_render_hits = forbidden_wizard_step_render_needles
        .into_iter()
        .filter(|needle| agent_wizard_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            step_render_hits.is_empty(),
            "agent creation wizard step render trees must stay in agent-create-wizard-steps.tsx, not agent-create-wizard.tsx: {step_render_hits:?}"
        );
    let forbidden_nested_step_needles = [
        "renderAgentChannelConfig",
        "agent-create-wizard__channel-layout",
        "agent-create-wizard__voice-source",
        "agent-create-wizard__voice-presets",
        "agent-create-wizard__voice-clone",
    ];
    let nested_step_hits = forbidden_nested_step_needles
        .into_iter()
        .filter(|needle| agent_wizard_steps_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            nested_step_hits.is_empty(),
            "agent wizard channel and voice step internals must live in their dedicated step files, not agent-create-wizard-steps.tsx: {nested_step_hits:?}"
        );
}

#[test]
fn rust_runtime_repo_guardrails_keep_desktop_chat_view_split() {
    let root = repo_root();
    let app_path = root.join("apps/crawclaw-desktop/src/App.tsx");
    let chat_view_path = root.join("apps/crawclaw-desktop/src/views/chat-workspace.tsx");
    let chat_model_path = root.join("apps/crawclaw-desktop/src/views/chat-workspace-model.ts");
    let chat_media_preview_path =
        root.join("apps/crawclaw-desktop/src/views/chat-media-preview.tsx");
    let chat_thread_path = root.join("apps/crawclaw-desktop/src/views/chat-thread.tsx");
    let app_source = fs::read_to_string(&app_path).expect("read desktop app");
    let chat_source = fs::read_to_string(&chat_view_path).expect("read chat workspace");
    assert!(
            chat_view_path.is_file(),
            "desktop chat workspace view must live in apps/crawclaw-desktop/src/views/chat-workspace.tsx"
        );
    assert!(
            chat_model_path.is_file(),
            "desktop chat workspace model helpers must live in apps/crawclaw-desktop/src/views/chat-workspace-model.ts"
        );
    assert!(
            chat_media_preview_path.is_file(),
            "desktop chat media preview overlays must live in apps/crawclaw-desktop/src/views/chat-media-preview.tsx"
        );
    assert!(
            chat_thread_path.is_file(),
            "desktop chat thread render tree must live in apps/crawclaw-desktop/src/views/chat-thread.tsx"
        );
    let forbidden_needles = [
        "ChatAvatar",
        "batchImageTiles",
        "ImagePreview",
        "videoPreviewStartSeconds",
        "isAttachmentMenuOpen",
        "isCommandMenuOpen",
        "isListening",
        "imagePreview",
        "videoCurrentSeconds",
        "visibleSlashCommands",
        "visibleSkillCommands",
        "submitDraft",
        "chat-thread",
        "media-stack",
        "Composer",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| app_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            hits.is_empty(),
            "chat/media/composer state and render tree must stay inside chat-workspace.tsx, not App.tsx: {hits:?}"
        );
    let forbidden_chat_workspace_needles = [
        "const batchImageTiles =",
        "type ImagePreview =",
        "const formatVideoTime =",
        "function ChatAvatar",
        "video-preview-overlay",
        "image-preview-overlay",
        "className=\"chat-thread\"",
        "className=\"media-stack\"",
        "className=\"execution-stack\"",
        "className=\"workflow-stack\"",
        "className=\"chat-message voice-message\"",
    ];
    let chat_hits = forbidden_chat_workspace_needles
        .into_iter()
        .filter(|needle| chat_source.contains(needle))
        .collect::<Vec<_>>();

    assert!(
            chat_hits.is_empty(),
            "chat model helpers, preview overlays, and static thread render tree must be split out of chat-workspace.tsx: {chat_hits:?}"
        );
}

#[test]
fn rust_runtime_repo_guardrails_keep_non_desktop_script_sources_absent() {
    let root = repo_root();
    let existing = tracked_files(&root)
        .into_iter()
        .filter(|relative| root.join(relative).is_file())
        .filter(|relative| is_script_source(relative))
        .filter(|relative| !is_allowed_desktop_script_surface(relative))
        .collect::<Vec<_>>();

    assert!(
        existing.is_empty(),
        "non-desktop TypeScript/JavaScript sources came back: {existing:?}"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_legacy_src_script_runtime_absent() {
    let root = repo_root();
    let mut files = Vec::new();
    collect_script_files(&root.join("src"), &mut files);
    let existing = files
        .into_iter()
        .map(|file| slash_path(file.strip_prefix(&root).expect("relative source path")))
        .collect::<Vec<_>>();

    assert!(
        existing.is_empty(),
        "legacy TypeScript/JavaScript src runtime surfaces came back: {existing:?}"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_core_src_ts_tests_absent() {
    let root = repo_root();
    let mut files = Vec::new();
    collect_ts_files(&root.join("src"), &mut files);
    collect_ts_files(&root.join("test"), &mut files);
    collect_ts_files(
        &root.join("apps").join("crawclaw-desktop").join("src"),
        &mut files,
    );
    let existing = files
        .into_iter()
        .map(|file| slash_path(file.strip_prefix(&root).expect("relative source path")))
        .filter(|relative| is_core_src_ts_test_surface(relative))
        .collect::<Vec<_>>();

    assert!(
        existing.is_empty(),
        "removed TypeScript core src tests came back: {existing:?}"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_ts_test_env_toggles_absent() {
    let root = repo_root();
    let mut files = Vec::new();
    collect_ts_files(&root.join("src"), &mut files);

    let forbidden_needles = [
        "process.env.VITEST",
        "process.env.NODE_ENV === \"test\"",
        "process.env.NODE_ENV === 'test'",
        "CRAWCLAW_TEST",
        "__CRAWCLAW_TEST",
    ];
    let mut hits = Vec::new();
    for file in files {
        let relative = slash_path(file.strip_prefix(&root).expect("relative source path"));
        if is_ts_declaration(&relative) || is_core_src_ts_test_surface(&relative) {
            continue;
        }
        let source = fs::read_to_string(&file).expect("read TS source");
        for needle in forbidden_needles {
            if source.contains(needle) {
                hits.push(format!("{relative}: {needle}"));
            }
        }
    }

    assert!(
        hits.is_empty(),
        "removed TypeScript test environment toggles came back: {hits:?}"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_removed_ts_plugin_control_plane_absent() {
    let root = repo_root();
    let removed = [
        "src/config/schema.ts",
        "src/config/schema.shared.ts",
        "src/config/schema.tags.ts",
        "src/generated/config/schema.base.generated.json",
        "src/plugins/bundle-config-shared.ts",
        "src/plugins/bundle-lsp.ts",
        "src/plugins/bundle-manifest.ts",
        "src/plugins/bundle-mcp.ts",
        "src/plugins/discovery.ts",
        "src/plugins/manifest-registry.ts",
        "src/plugins/manifest.ts",
        "src/plugins/schema-validator.ts",
        "scripts/crawclaw-npm-postpublish-verify.ts",
        "scripts/crawclaw-npm-release-check.ts",
        "scripts/ghsa-patch.mjs",
        "scripts/lib/npm-publish-plan.mjs",
        "scripts/lib/plugin-npm-release.ts",
        "scripts/lib/local-heavy-check-runtime.mjs",
        "scripts/plugin-npm-release-check.ts",
        "scripts/plugin-npm-release-plan.ts",
        "scripts/run-oxlint.mjs",
        "scripts/run-tsgo.mjs",
        "scripts/sync-labels.ts",
        "scripts/sync-plugin-versions.ts",
        "scripts/typecheck.mjs",
    ];
    let existing = removed
        .iter()
        .filter(|relative| root.join(relative).exists())
        .copied()
        .collect::<Vec<_>>();

    assert!(
        existing.is_empty(),
        "removed TypeScript plugin/config control-plane surfaces came back: {existing:?}"
    );
}

#[test]
fn runtime_layout_reports_no_default_js_compat() {
    let runtime_root = unique_test_runtime_root("runtime-no-js-compat");
    let layout = RuntimeLayout {
        binary_path: runtime_root.join("bin").join(runtime_binary_name()),
        channel_manifest_path: runtime_root.join("channels").join("manifest.json"),
        manifest_path: runtime_root.join("runtimes").join("manifest.json"),
        runtime_root: runtime_root.clone(),
    };
    fs::create_dir_all(layout.binary_path.parent().expect("binary parent")).unwrap();
    fs::create_dir_all(
        layout
            .channel_manifest_path
            .parent()
            .expect("channels parent"),
    )
    .unwrap();
    fs::create_dir_all(layout.manifest_path.parent().expect("manifest parent")).unwrap();
    fs::write(&layout.binary_path, "").unwrap();
    fs::write(layout.gateway_binary_path(), "").unwrap();
    fs::write(layout.native_plugins_binary_path(), "").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let gateway_path = layout.gateway_binary_path();
        let native_plugins_path = layout.native_plugins_binary_path();
        for path in [
            layout.binary_path.as_path(),
            gateway_path.as_path(),
            native_plugins_path.as_path(),
        ] {
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).unwrap();
        }
    }
    fs::write(&layout.channel_manifest_path, "{}").unwrap();
    fs::write(&layout.manifest_path, r#"{"runtime":"rust-native"}"#).unwrap();

    let status = inspect_runtime_layout(&layout);

    assert_eq!(status.status, RuntimeStatusValue::Ready);
    assert_eq!(status.compat, RuntimeCompatStatus::default());

    let _ = fs::remove_dir_all(runtime_root);
}

#[test]
fn desktop_runtime_manifest_advertises_managed_searxng_runtime() {
    let runtime_root = unique_test_runtime_root("runtime-searxng-manifest");

    stage_desktop_runtime_manifests(&runtime_root).expect("stage runtime manifests");
    let raw = fs::read_to_string(runtime_root.join("runtimes").join("manifest.json"))
        .expect("runtime manifest");
    let manifest: Value = serde_json::from_str(&raw).expect("manifest json");

    assert_eq!(manifest["jsPluginRuntime"], "none");
    assert_eq!(
        manifest["managedRuntimes"]["browser"]["runtime"],
        "rust-native-binary"
    );
    assert_eq!(
        manifest["managedRuntimes"]["browser"]["provider"],
        "agent-browser"
    );
    assert_eq!(
        manifest["managedRuntimes"]["searxng"]["runtime"],
        "python-sidecar"
    );
    assert_eq!(
        manifest["managedRuntimes"]["searxng"]["provider"],
        "searxng"
    );
    assert_eq!(
        manifest["managedRuntimes"]["searxng"]["sourceCommit"],
        "afafca93f30939f213c1bc3fa3379e5ed883122d"
    );
    assert_eq!(
        manifest["managedRuntimes"]["searxng"]["license"],
        "AGPL-3.0-or-later"
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[test]
fn pi_agent_rust_core_tool_registry_uses_crawclaw_tool_names() {
    let runtime_root = unique_test_runtime_root("pi-agent-rust-core-tools");
    let registry = build_pi_agent_rust_tool_registry(&runtime_root);
    let tool_names: Vec<&str> = registry.tools().iter().map(|tool| tool.name()).collect();

    let expected_tool_names = vec![
        "read",
        "write",
        "edit",
        "apply_patch",
        "bash",
        "process",
        "browser",
        "lobster",
        "comfyui_workflow",
        "llm-task",
        "grep",
        "find",
        "ls",
        "web_search",
        "web_fetch",
        "session_status",
        "sessions_list",
        "sessions_history",
        "sessions_send",
        "sessions_spawn",
        "sessions_yield",
        "subagents",
        "canvas",
        "message",
        "cron",
        "image",
        "pdf",
        "tts",
        "discover_skills",
        "workflow",
        "workflowize",
        "review_task",
        "write_experience_note",
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
        "session_summary_file_read",
        "session_summary_file_edit",
    ];
    assert_eq!(tool_names, expected_tool_names);
    assert!(registry.get("bash").is_some());
    assert!(registry.get("exec").is_none());
    assert_eq!(
        pi_agent_rust_tool_names(),
        expected_tool_names
            .into_iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    );
}

#[cfg(unix)]
#[tokio::test]
async fn pi_agent_rust_tool_registry_executes_installed_native_sidecar_tool() {
    use std::os::unix::fs::PermissionsExt;

    let runtime_root = unique_test_runtime_root("pi-agent-rust-sidecar-tool");
    let plugin_dir = runtime_root.join("plugins").join("acme-native");
    fs::create_dir_all(&plugin_dir).expect("plugin dir");
    let sidecar = plugin_dir.join("sidecar.sh");
    fs::write(
            &sidecar,
            r#"#!/bin/sh
read line
case "$line" in
  *plugin.invoke*)
    printf '%s\n' '{"jsonrpc":"2.0","id":"describe","result":{"output":{"ok":true}}}'
    ;;
  *)
    printf '%s\n' '{"jsonrpc":"2.0","id":"describe","result":{"descriptors":[{"schemaVersion":1,"pluginId":"acme-native","name":"Acme Native","tools":[{"name":"acme_tool","label":"Acme Tool","description":"Runs native work.","parameters":{"type":"object"},"invocation":{"pluginId":"acme-native","operation":"run"},"readOnly":true}]}]}}'
    ;;
esac
"#,
        )
        .expect("sidecar");
    let mut permissions = fs::metadata(&sidecar).expect("metadata").permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&sidecar, permissions).expect("permissions");
    fs::write(
        plugin_dir.join("crawclaw.plugin.json"),
        serde_json::to_vec_pretty(&json!({
            "id": "acme-native",
            "native": {
                "protocol": "crawclaw-native-plugin-jsonrpc",
                "schemaVersion": 1,
                "bin": "sidecar.sh"
            }
        }))
        .expect("manifest json"),
    )
    .expect("manifest");

    let output = execute_rust_core_tool(&runtime_root, "acme_tool", json!({ "value": 1 }))
        .await
        .expect("sidecar tool output");

    assert_eq!(output["details"], json!({ "ok": true }));

    let _ = fs::remove_dir_all(runtime_root);
}

#[test]
fn grep_find_ls_are_default_rust_native_discovery_tools() {
    let runtime_root = unique_test_runtime_root("pi-agent-rust-discovery-tools");
    let registry = build_pi_agent_rust_tool_registry(&runtime_root);
    let tool_names: Vec<&str> = registry.tools().iter().map(|tool| tool.name()).collect();

    assert_eq!(
        tool_names,
        vec![
            "read",
            "write",
            "edit",
            "apply_patch",
            "bash",
            "process",
            "browser",
            "lobster",
            "comfyui_workflow",
            "llm-task",
            "grep",
            "find",
            "ls",
            "web_search",
            "web_fetch",
            "session_status",
            "sessions_list",
            "sessions_history",
            "sessions_send",
            "sessions_spawn",
            "sessions_yield",
            "subagents",
            "canvas",
            "message",
            "cron",
            "image",
            "pdf",
            "tts",
            "discover_skills",
            "workflow",
            "workflowize",
            "review_task",
            "write_experience_note",
            "memory_manifest_read",
            "memory_note_read",
            "memory_note_write",
            "memory_note_edit",
            "memory_note_delete",
            "session_summary_file_read",
            "session_summary_file_edit",
        ]
    );
    for tool_name in ["grep", "find", "ls"] {
        let tool = registry.get(tool_name).expect("discovery tool");
        assert!(tool.is_read_only(), "{tool_name} should be read-only");
    }
}

#[test]
fn pi_agent_rust_tool_registry_honors_runtime_allowlist() {
    let runtime_root = unique_test_runtime_root("pi-agent-rust-tool-allowlist");
    let registry = build_filtered_pi_agent_rust_tool_registry(
        &runtime_root,
        &[
            "memory_note_read".to_string(),
            "sessions_history".to_string(),
        ],
    );
    let tool_names = registry
        .tools()
        .iter()
        .map(|tool| tool.name())
        .collect::<Vec<_>>();

    assert_eq!(tool_names, vec!["sessions_history", "memory_note_read"]);
    assert!(registry.get("memory_note_write").is_none());
    assert!(registry.get("bash").is_none());
}

#[test]
fn rust_core_tool_inventory_tracks_native_tools() {
    let definition = |tool_id: &str| {
        rust_core_tool_definitions()
            .iter()
            .find(|tool| tool.id == tool_id)
            .expect("tool definition")
    };

    assert_eq!(
        definition("bash"),
        &RustCoreToolDefinition {
            id: "bash",
            backing_runtime_id: "bash",
            status: RustCoreToolStatus::RustNative,
            default_enabled: true,
            read_only: false,
            label: "bash",
            description: "Run shell commands",
            section_id: "runtime",
            default_profiles: &["coding", "full"],
            lifecycle: "profile_default",
            include_in_crawclaw_group: false,
        }
    );
    assert_eq!(
        definition("apply_patch").status,
        RustCoreToolStatus::RustNative
    );
    assert!(definition("apply_patch").default_enabled);
    assert_eq!(definition("process").status, RustCoreToolStatus::RustNative);
    assert!(definition("process").default_enabled);
    assert!(definition("web_search").default_enabled);
    assert!(definition("web_search").read_only);
    assert!(definition("web_fetch").default_enabled);
    assert!(definition("web_fetch").read_only);
    assert!(definition("sessions_send").default_enabled);
    assert!(!definition("sessions_send").read_only);
    assert!(definition("sessions_spawn").default_enabled);
    assert!(!definition("sessions_spawn").read_only);
    assert!(definition("sessions_yield").default_enabled);
    assert!(!definition("sessions_yield").read_only);
    assert!(definition("cron").default_enabled);
    assert!(!definition("cron").read_only);
    assert_eq!(definition("canvas").description, "Control canvases");
    assert!(definition("canvas").default_enabled);
    assert_eq!(definition("message").section_id, "messaging");
    assert!(!definition("message").read_only);
    assert!(definition("image").read_only);
    assert!(definition("pdf").read_only);
    assert!(!definition("tts").read_only);
    assert!(definition("discover_skills").read_only);
    assert!(!definition("workflow").read_only);
    assert!(!definition("workflowize").read_only);
    for tool_name in [
        "session_status",
        "sessions_list",
        "sessions_history",
        "subagents",
        "review_task",
        "memory_manifest_read",
        "memory_note_read",
        "session_summary_file_read",
    ] {
        assert!(definition(tool_name).default_enabled);
        assert!(definition(tool_name).read_only);
    }
    for tool_name in [
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
        "write_experience_note",
        "session_summary_file_edit",
    ] {
        assert!(definition(tool_name).default_enabled);
        assert!(!definition(tool_name).read_only);
    }
    for tool_name in ["grep", "find", "ls"] {
        assert!(definition(tool_name).default_enabled);
        assert!(definition(tool_name).read_only);
    }
    let tool_names = pi_agent_rust_tool_names();
    for expected in [
        "apply_patch",
        "process",
        "sessions_spawn",
        "message",
        "cron",
        "tts",
        "workflow",
        "workflowize",
        "review_task",
        "memory_note_write",
        "write_experience_note",
        "web_search",
        "web_fetch",
        "browser",
        "lobster",
        "comfyui_workflow",
        "llm-task",
    ] {
        assert!(tool_names.contains(&expected.to_string()));
    }
}

#[test]
fn rust_tool_catalog_artifact_uses_runtime_inventory() {
    let payload = rust_tool_catalog_json_payload();
    let sections = payload["sections"].as_array().expect("sections");
    let core_tools = payload["coreTools"].as_array().expect("core tools");
    let native_tools = payload["nativeTools"].as_array().expect("native tools");

    assert!(sections.iter().any(|section| section["id"] == "runtime"));
    assert!(core_tools.iter().any(|tool| tool["id"] == "bash"));
    assert!(native_tools.iter().any(|tool| {
        tool["id"] == "browser"
            && tool["source"] == "native-plugin"
            && tool["status"] == "rust-native"
    }));

    let artifact = render_rust_tool_catalog_artifact();
    assert!(artifact.ends_with('\n'));
    assert!(artifact.contains("\"coreTools\""));
    assert!(artifact.contains("\"nativeTools\""));
}

#[tokio::test]
async fn core_tools_canvas_message_and_discover_skills_are_rust_backed() {
    let runtime_root = unique_test_runtime_root("core-tools-rust-backed");
    fs::create_dir_all(runtime_root.join("skills/demo")).expect("skill dir");
    fs::write(
        runtime_root.join("skills/demo/SKILL.md"),
        "---\nname: demo\ndescription: Demo skill for Rust discovery.\n---\n# Demo\n",
    )
    .expect("skill file");

    let canvas = execute_rust_core_tool(&runtime_root, "canvas", json!({ "action": "snapshot" }))
        .await
        .expect("canvas output");
    assert_eq!(canvas["details"]["status"], "ok");
    assert_eq!(canvas["details"]["implementation"], "rust-native");
    assert_eq!(canvas["details"]["state"]["visible"], false);

    let message = execute_rust_core_tool(
        &runtime_root,
        "message",
        json!({
            "action": "send",
            "channel": "desktop",
            "target": "user",
            "text": "hello"
        }),
    )
    .await
    .expect("message output");
    assert_eq!(message["details"]["deliveryStatus"], "delivered");
    assert_eq!(message["details"]["implementation"], "rust-native");

    let skills = execute_rust_core_tool(
        &runtime_root,
        "discover_skills",
        json!({ "taskDescription": "Need a demo helper", "limit": 5 }),
    )
    .await
    .expect("discover skills output");
    assert_eq!(skills["details"]["status"], "ok");
    assert!(skills["details"]["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .any(|skill| skill["name"] == "demo"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn core_tools_workflow_lifecycle_is_rust_backed() {
    let runtime_root = unique_test_runtime_root("core-tools-workflow-lifecycle");
    let created = execute_rust_core_tool(
        &runtime_root,
        "workflowize",
        json!({
            "name": "Demo workflow",
            "goal": "Exercise Rust workflow lifecycle",
            "safeForAutoRun": true,
            "requiresApproval": false,
            "steps": [{ "id": "one", "title": "First step" }]
        }),
    )
    .await
    .expect("workflow created");
    let workflow_id = created["details"]["workflowId"]
        .as_str()
        .expect("workflow id");
    assert_eq!(created["details"]["target"], "rust-native");

    let updated = execute_rust_core_tool(
        &runtime_root,
        "workflow",
        json!({
            "action": "update",
            "workflow": workflow_id,
            "patch": { "description": "Updated by Rust runtime" }
        }),
    )
    .await
    .expect("workflow updated");
    assert_eq!(updated["details"]["status"], "updated");
    assert_eq!(updated["details"]["workflow"]["specVersion"], 2);

    let versions = execute_rust_core_tool(
        &runtime_root,
        "workflow",
        json!({ "action": "versions", "workflow": workflow_id }),
    )
    .await
    .expect("workflow versions");
    assert_eq!(
        versions["details"]["versions"]
            .as_array()
            .expect("versions")
            .len(),
        2
    );

    let diff = execute_rust_core_tool(
        &runtime_root,
        "workflow",
        json!({
            "action": "diff",
            "workflow": workflow_id,
            "fromSpecVersion": 1,
            "toSpecVersion": 2
        }),
    )
    .await
    .expect("workflow diff");
    assert_eq!(diff["details"]["changed"], true);

    let deployed = execute_rust_core_tool(
        &runtime_root,
        "workflow",
        json!({ "action": "deploy", "workflow": workflow_id }),
    )
    .await
    .expect("workflow deployed");
    assert_eq!(
        deployed["details"]["workflow"]["deploymentState"],
        "deployed"
    );

    let run = execute_rust_core_tool(
        &runtime_root,
        "workflow",
        json!({
            "action": "run",
            "workflow": workflow_id,
            "inputs": { "topic": "rust" }
        }),
    )
    .await
    .expect("workflow run");
    let run_id = run["details"]["runId"].as_str().expect("run id");
    assert_eq!(run["details"]["status"], "running");

    let status = execute_rust_core_tool(
        &runtime_root,
        "workflow",
        json!({ "action": "status", "executionId": run_id }),
    )
    .await
    .expect("workflow status");
    assert_eq!(status["details"]["execution"]["status"], "running");

    let cancelled = execute_rust_core_tool(
        &runtime_root,
        "workflow",
        json!({ "action": "cancel", "executionId": run_id }),
    )
    .await
    .expect("workflow cancel");
    assert_eq!(cancelled["details"]["execution"]["status"], "cancelled");

    let runs = execute_rust_core_tool(
        &runtime_root,
        "workflow",
        json!({ "action": "runs", "workflow": workflow_id }),
    )
    .await
    .expect("workflow runs");
    assert_eq!(
        runs["details"]["runs"][0]["executionId"].as_str(),
        Some(run_id)
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[test]
fn special_agent_registry_tracks_all_native_agents() {
    let definitions = crate::special_agents::special_agent_definitions();
    let ids = definitions
        .iter()
        .map(|definition| definition.id)
        .collect::<Vec<_>>();

    assert_eq!(
        ids,
        vec![
            "review-spec",
            "review-quality",
            "durable-memory",
            "dream",
            "session-summary",
            "experience",
        ]
    );
    assert!(definitions
        .iter()
        .all(|definition| !definition.tool_allowlist.is_empty()));
}

#[test]
fn special_agent_memory_tools_manage_scoped_notes() {
    let runtime_root = unique_test_runtime_root("special-memory-tools");
    let tools = crate::special_agents::SpecialAgentMemoryTools::new(runtime_root.clone());

    let write = tools
        .write_note("main", "reference/test.md", "# Test\nold text")
        .expect("write note");
    assert_eq!(write.status, "ok");

    let read = tools
        .read_note("main", "reference/test.md")
        .expect("read note");
    assert_eq!(read.content, "# Test\nold text");

    let edit = tools
        .edit_note("main", "reference/test.md", "old text", "new text")
        .expect("edit note");
    assert_eq!(edit.replacements, 1);

    let manifest = tools.read_manifest("main").expect("manifest");
    assert_eq!(manifest.entries.len(), 1);
    assert_eq!(manifest.entries[0].note_path, "reference/test.md");

    let deleted = tools
        .delete_note("main", "reference/test.md")
        .expect("delete note");
    assert_eq!(deleted.status, "deleted");

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn rust_native_session_tools_manage_subagent_sessions() {
    let runtime_root = unique_test_runtime_root("pi-agent-rust-session-tools");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let registry = build_pi_agent_rust_tool_registry(&runtime_root);
    let spawn = registry.get("sessions_spawn").expect("sessions_spawn tool");
    let list = registry.get("sessions_list").expect("sessions_list tool");
    let history = registry
        .get("sessions_history")
        .expect("sessions_history tool");
    let send = registry.get("sessions_send").expect("sessions_send tool");
    let yield_tool = registry.get("sessions_yield").expect("sessions_yield tool");
    let subagents = registry.get("subagents").expect("subagents tool");

    let spawned = spawn
        .execute(
            "spawn-call",
            json!({
                "task": "check the Rust gateway",
                "label": "gateway worker",
                "parentSessionKey": "main"
            }),
            None,
        )
        .await
        .expect("spawn session");
    let child_key = spawned
        .details
        .as_ref()
        .and_then(|details| details.get("session"))
        .and_then(|session| session.get("key"))
        .and_then(serde_json::Value::as_str)
        .expect("child key")
        .to_string();

    send.execute(
        "send-call",
        json!({
            "sessionKey": child_key.clone(),
            "message": "follow up"
        }),
        None,
    )
    .await
    .expect("send session message");
    let yielded = yield_tool
        .execute(
            "yield-call",
            json!({
                "sessionKey": child_key.clone()
            }),
            None,
        )
        .await
        .expect("yield session");

    assert_eq!(
        yielded
            .details
            .as_ref()
            .and_then(|details| details.get("session"))
            .and_then(|session| session.get("yielded")),
        Some(&json!(true))
    );
    assert!(tool_output_text(
        &history
            .execute(
                "history-call",
                json!({
                    "sessionKey": child_key.clone()
                }),
                None,
            )
            .await
            .expect("history")
    )
    .contains("follow up"));
    assert!(tool_output_text(
        &subagents
            .execute(
                "subagents-call",
                json!({
                    "parentSessionKey": "main"
                }),
                None,
            )
            .await
            .expect("subagents")
    )
    .contains("gateway worker"));
    assert!(tool_output_text(
        &list
            .execute("list-call", json!({}), None)
            .await
            .expect("list")
    )
    .contains("gateway worker"));
}

#[tokio::test]
async fn rust_native_web_fetch_uses_canonical_tool_name() {
    let runtime_root = unique_test_runtime_root("pi-agent-rust-web-fetch");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let registry = build_pi_agent_rust_tool_registry(&runtime_root);
    let web_search = registry.get("web_search").expect("web_search tool");
    let web_fetch = registry.get("web_fetch").expect("web_fetch tool");
    let listener = TcpListener::bind("127.0.0.1:0").expect("web fetch listener");
    let addr = listener.local_addr().expect("listener addr");
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept web fetch request");
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer);
        let body = "<html><head><title>Rust Web Fetch</title></head><body><main>Rust native web_fetch content</main></body></html>";
        let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
        std::io::Write::write_all(&mut stream, response.as_bytes())
            .expect("write web fetch response");
    });

    assert!(web_search.is_read_only());
    assert!(web_fetch.is_read_only());
    let output = web_fetch
        .execute(
            "web-fetch-call",
            json!({
                "url": format!("http://{addr}/article"),
                "output": "text",
                "maxChars": 2_000
            }),
            None,
        )
        .await
        .expect("web_fetch should execute");

    assert!(tool_output_text(&output).contains("Rust native web_fetch content"));
    assert_eq!(
        output
            .details
            .as_ref()
            .and_then(|details| details.get("provider")),
        Some(&json!("spider"))
    );
}

#[tokio::test]
async fn rust_native_web_search_only_exposes_searxng_provider() {
    let runtime_root = unique_test_runtime_root("pi-agent-rust-web-search-provider");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let registry = build_pi_agent_rust_tool_registry(&runtime_root);
    let web_search = registry.get("web_search").expect("web_search tool");
    let parameters = web_search.parameters();
    let providers = parameters
        .pointer("/properties/provider/enum")
        .and_then(serde_json::Value::as_array)
        .expect("provider enum")
        .iter()
        .map(|value| value.as_str().expect("provider value"))
        .collect::<Vec<_>>();

    assert_eq!(providers, vec!["searxng"]);
    let error = web_search
        .execute(
            "web-search-call",
            json!({
                "query": "rust native",
                "provider": "brave"
            }),
            None,
        )
        .await
        .expect_err("non-searxng provider should not be accepted by web_search");

    assert!(format!("{error}").contains("only supports searxng"));
}

#[tokio::test]
async fn rust_native_apply_patch_updates_workspace_files() {
    let runtime_root = unique_test_runtime_root("pi-agent-rust-apply-patch");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    fs::write(runtime_root.join("sample.txt"), "old\n").expect("sample");
    let registry = build_pi_agent_rust_tool_registry(&runtime_root);
    let apply_patch = registry.get("apply_patch").expect("apply_patch tool");
    let patch = [
        "*** Begin Patch",
        "*** Update File: sample.txt",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
    ]
    .join("\n");

    let output = apply_patch
        .execute(
            "apply-patch-call",
            json!({
                "input": patch
            }),
            None,
        )
        .await
        .expect("apply patch");

    assert_eq!(
        fs::read_to_string(runtime_root.join("sample.txt")).expect("sample after"),
        "new\n"
    );
    assert!(tool_output_text(&output).contains("M sample.txt"));
    assert_eq!(
        output
            .details
            .as_ref()
            .and_then(|details| details.get("summary")),
        Some(&json!({"added":[],"modified":["sample.txt"],"deleted":[]}))
    );
}

#[tokio::test]
async fn rust_native_bash_and_process_manage_background_sessions() {
    let runtime_root = unique_test_runtime_root("pi-agent-rust-process");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let registry = build_pi_agent_rust_tool_registry(&runtime_root);
    let bash = registry.get("bash").expect("bash tool");
    let process = registry.get("process").expect("process tool");

    let started = bash
        .execute(
            "bash-call",
            json!({
                "command": "printf start; sleep 0.05; printf done",
                "background": true
            }),
            None,
        )
        .await
        .expect("start background bash");
    let session_id = started
        .details
        .as_ref()
        .and_then(|details| details.get("sessionId"))
        .and_then(serde_json::Value::as_str)
        .expect("session id")
        .to_string();

    let polled = process
        .execute(
            "process-call",
            json!({
                "action": "poll",
                "sessionId": session_id,
                "timeout": 1000
            }),
            None,
        )
        .await
        .expect("poll background bash");

    assert!(tool_output_text(&polled).contains("startdone"));
    assert_eq!(
        polled
            .details
            .as_ref()
            .and_then(|details| details.get("status")),
        Some(&json!("completed"))
    );
}

#[tokio::test]
async fn agent_runtime_uses_pi_agent_rust_direct_backend_by_default() {
    let runtime_root = unique_test_runtime_root("pi-agent-direct");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let backend = Arc::new(FakeAgentRuntimeBackend {
        reply: "hello from pi_agent_rust".to_string(),
    });
    let runtime = AgentRuntime::with_pi_agent_backend(runtime_root.clone(), backend);
    let result = runtime
        .send_message("thread-pi".to_string(), "hello direct".to_string())
        .await
        .expect("pi direct result");

    assert_eq!(result.assistant_text, "hello from pi_agent_rust");
    let transcript = fs::read_to_string(runtime_root.join("sessions").join("thread-pi.jsonl"))
        .expect("transcript");
    assert!(transcript.contains(r#""content":"hello direct""#));
    assert!(transcript.contains(r#""content":"hello from pi_agent_rust""#));
}

#[tokio::test]
async fn agent_runtime_run_turn_emits_rust_event_contract() {
    let runtime_root = unique_test_runtime_root("agent-run-turn-events");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_pi_agent_backend(
        runtime_root.clone(),
        Arc::new(FakeAgentRuntimeBackend {
            reply: "hello from run_turn".to_string(),
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-1".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-events".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: Some("local".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "hello event loop".to_string(),
                raw_body: Some("hello event loop".to_string()),
                message_id: Some("in-1".to_string()),
                thread_id: Some("thread-events".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            options: BTreeMap::new(),
        })
        .await
        .expect("run turn");

    assert_eq!(result.run_id, "run-1");
    assert_eq!(result.session_key, "thread-events");
    assert_eq!(result.assistant_text, "hello from run_turn");
    assert_eq!(
        serde_json::to_value(&result.events).expect("events json"),
        json!([
            {
                "type": "runStarted",
                "runId": "run-1",
                "agentId": "main",
                "sessionKey": "thread-events"
            },
            {
                "type": "replyPayload",
                "runId": "run-1",
                "payload": {
                    "text": "hello from run_turn"
                }
            },
            {
                "type": "transcriptAppended",
                "runId": "run-1",
                "sessionKey": "thread-events",
                "role": "assistant",
                "messageId": "run-1:assistant"
            },
            {
                "type": "toolResult",
                "runId": "run-1",
                "callId": "run-1:memory-after-turn",
                "toolName": "memory.afterTurn",
                "result": {
                    "status": "ok",
                    "ingest": {
                        "ingestedCount": 2
                    },
                    "durableExtraction": true,
                    "experienceExtraction": true,
                    "sessionSummary": true
                }
            },
            {
                "type": "runCompleted",
                "runId": "run-1"
            }
        ])
    );

    let transcript = fs::read_to_string(runtime_root.join("sessions").join("thread-events.jsonl"))
        .expect("transcript");
    assert!(transcript.contains(r#""content":"hello event loop""#));
    assert!(transcript.contains(r#""content":"hello from run_turn""#));
    let memory_messages =
        crate::memory::RuntimeStore::new(runtime_root.join("memory").join("runtime.db"))
            .list_messages("thread-events", 10)
            .expect("memory messages");
    assert_eq!(memory_messages.len(), 2);
}

#[tokio::test]
async fn memory_runtime_compact_operation_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("memory-runtime-compact-agent");
    let (provider_base_url, request_rx) =
        start_openai_compatible_provider("compact from runtime agent");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    execute_memory_runtime_operation(
        &runtime_root,
        "memory.ingestBatch",
        json!({
            "sessionId": "runtime-compact-session",
            "messages": [
                { "id": "m1", "role": "user", "content": "runtime compact input" },
                { "id": "m2", "role": "assistant", "content": "runtime compact response" }
            ]
        }),
    )
    .await
    .expect("ingest compact messages");
    let compact = execute_memory_runtime_operation(
        &runtime_root,
        "memory.compact",
        json!({
            "sessionId": "runtime-compact-session",
            "force": true
        }),
    )
    .await
    .expect("compact via runtime operation");

    assert_eq!(compact["ok"], true);
    assert_eq!(compact["compacted"], true);
    assert_eq!(compact["result"]["summary"], "compact from runtime agent");
    assert_eq!(
        compact["result"]["implementation"],
        "rust-native-agent-runtime"
    );
    let request = request_rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .expect("captured compact provider request");
    assert!(request.contains("runtime compact input"));

    let summary =
        fs::read_to_string(runtime_root.join("memory/session-summary/runtime-compact-session.md"))
            .expect("summary file");
    assert!(summary.contains("compact from runtime agent"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn review_task_tool_uses_native_agent_runtime() {
    let runtime_root = unique_test_runtime_root("review-task-agent-runtime");
    let (provider_base_url, request_rx) =
        start_openai_compatible_provider("reviewed by runtime agent");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let output = execute_rust_core_tool(
        &runtime_root,
        "review_task",
        json!({
            "stage": "spec",
            "task": "review this Rust migration"
        }),
    )
    .await
    .expect("review task tool");

    assert_eq!(output["details"]["kind"], "review-spec");
    assert_eq!(
        output["details"]["result"]["assistantText"],
        "reviewed by runtime agent"
    );
    let request = request_rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .expect("captured review provider request");
    assert!(request.contains("review this Rust migration"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_run_turn_applies_request_model_selection() {
    let runtime_root = unique_test_runtime_root("agent-run-turn-model-selection");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "provider": "configured-provider",
            "model": "configured-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_pi_agent_backend(
        runtime_root,
        Arc::new(FakeAgentRuntimeBackend {
            reply: "selected model reply".to_string(),
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-model".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-model".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: None,
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "hello selected model".to_string(),
                raw_body: Some("hello selected model".to_string()),
                message_id: None,
                thread_id: Some("thread-model".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            options: BTreeMap::new(),
        })
        .await
        .expect("run turn");

    assert_eq!(result.assistant_text, "selected model reply");
}

#[tokio::test]
async fn agent_runtime_btw_turn_is_ephemeral_and_marks_reply_metadata() {
    let runtime_root = unique_test_runtime_root("agent-run-turn-btw");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_pi_agent_backend(
        runtime_root.clone(),
        Arc::new(FakeAgentRuntimeBackend {
            reply: "side answer".to_string(),
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-btw".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-btw".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "btw".to_string(),
                account_id: None,
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "what changed?".to_string(),
                raw_body: Some("what changed?".to_string()),
                message_id: None,
                thread_id: Some("thread-btw".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: Some("off".to_string()),
            },
            enabled_tools: Vec::new(),
            options: BTreeMap::from([
                ("mode".to_string(), json!("btw")),
                ("btwQuestion".to_string(), json!("what changed?")),
                ("ephemeral".to_string(), json!(true)),
            ]),
        })
        .await
        .expect("btw run turn");

    assert_eq!(result.assistant_text, "side answer");
    assert_eq!(
        serde_json::to_value(&result.events).expect("events json"),
        json!([
            {
                "type": "runStarted",
                "runId": "run-btw",
                "agentId": "main",
                "sessionKey": "thread-btw"
            },
            {
                "type": "replyPayload",
                "runId": "run-btw",
                "payload": {
                    "text": "side answer",
                    "metadata": {
                        "btw": {
                            "question": "what changed?"
                        }
                    }
                }
            },
            {
                "type": "runCompleted",
                "runId": "run-btw"
            }
        ])
    );
    assert!(!runtime_root
        .join("sessions")
        .join("thread-btw.jsonl")
        .exists());
    let memory_db = runtime_root.join("memory").join("runtime.db");
    if memory_db.exists() {
        let memory_messages = crate::memory::RuntimeStore::new(memory_db)
            .list_messages("thread-btw", 10)
            .expect("memory messages");
        assert!(memory_messages.is_empty());
    }
}

#[tokio::test]
async fn pi_agent_rust_direct_backend_uses_crawclaw_provider_transport() {
    let runtime_root = unique_test_runtime_root("pi-agent-direct-provider-bridge");
    let (provider_base_url, request_rx) =
        start_openai_compatible_provider("reply from provider bridge");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "pi-agent-rust",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("config json"),
    )
    .expect("write config");
    let sessions_dir = runtime_root.join("sessions");
    fs::create_dir_all(&sessions_dir).expect("sessions dir");
    fs::write(
        sessions_dir.join("thread-pi.jsonl"),
        [
            r#"{"role":"user","content":"previous user"}"#,
            r#"{"role":"assistant","content":"previous assistant"}"#,
        ]
        .join("\n"),
    )
    .expect("seed transcript");

    let runtime = AgentRuntime::new(runtime_root);
    let result = runtime
        .send_message("thread-pi".to_string(), "hello bridge".to_string())
        .await
        .expect("pi direct provider bridge result");

    assert_eq!(result.assistant_text, "reply from provider bridge");
    let request = request_rx.recv().expect("captured provider request");
    assert!(request.contains(r#""role":"user""#));
    assert!(request.contains(r#""role":"assistant""#));
    assert!(request.contains("previous user"));
    assert!(request.contains("previous assistant"));
    assert!(request.contains("hello bridge"));
}

#[tokio::test]
async fn pi_agent_rust_provider_bridge_passes_streaming_tools_and_images() {
    let (provider_base_url, request_rx) =
        start_openai_compatible_provider("reply from provider bridge");
    let provider = CrawClawPiProvider {
        config: NativeProviderConfig {
            provider: "openai-compatible".to_string(),
            base_url: Some(provider_base_url),
            api_key: Some("test-key".to_string()),
            model: Some("test-model".to_string()),
            api: None,
            api_version: None,
        },
        reasoning_level: None,
    };
    let context = pi::sdk::ProviderContext::owned(
        None,
        vec![pi::sdk::Message::User(pi::sdk::UserMessage {
            content: pi::sdk::UserContent::Blocks(vec![
                pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("describe this")),
                pi::sdk::ContentBlock::Image(pi::sdk::ImageContent {
                    data: "iVBORw0KGgo=".to_string(),
                    mime_type: "image/png".to_string(),
                }),
            ]),
            timestamp: 1,
        })],
        vec![pi::sdk::ToolDef {
            name: "lookup_weather".to_string(),
            description: "Look up weather".to_string(),
            parameters: json!({ "type": "object" }),
        }],
    );

    let stream = provider
        .stream(&context, &pi::sdk::StreamOptions::default())
        .await
        .expect("provider stream");
    let events = stream
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .expect("stream events");

    assert!(!events.is_empty());
    let request = request_rx.recv().expect("captured provider request");
    assert!(request.contains(r#""stream":true"#));
    assert!(request.contains("lookup_weather"));
    assert!(request.contains("iVBORw0KGgo="));
}

#[tokio::test]
async fn native_llm_task_tool_runs_host_agent_without_ts_wrapper() {
    let runtime_root = unique_test_runtime_root("native-llm-task-tool");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    let (provider_base_url, request_rx) = start_openai_compatible_provider(r#"{"ok":true}"#);
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "apiKey": "test-key",
            "model": "test-model"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let registry = build_pi_agent_rust_tool_registry(&runtime_root);
    let tool = registry
        .tools()
        .iter()
        .find(|tool| tool.name() == "llm-task")
        .expect("llm-task tool");
    let output = tool
        .execute(
            "llm-task-call",
            json!({
                "prompt": "return ok",
                "schema": {
                    "type": "object",
                    "properties": { "ok": { "type": "boolean" } },
                    "required": ["ok"]
                }
            }),
            None,
        )
        .await
        .expect("llm-task execute");

    assert_eq!(
        output.details.as_ref().expect("details")["json"],
        json!({ "ok": true })
    );
    let request = request_rx.recv().expect("captured provider request");
    assert!(request.contains("Return ONLY a valid JSON value."));
    assert!(!request.contains("\"tools\""));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_rejects_unknown_runtime_modes() {
    let runtime_root = unique_test_runtime_root("unknown-runtime-mode");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "legacy-sidecar-mode",
            "provider": "test-provider",
            "model": "test-model"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_pi_agent_backend(
        runtime_root,
        Arc::new(FakeAgentRuntimeBackend {
            reply: "should not run".to_string(),
        }),
    );
    let error = runtime
        .send_message("thread-pi".to_string(), "second".to_string())
        .await
        .expect_err("unknown runtime mode should be rejected");

    assert!(error.message().contains("legacy-sidecar-mode"));
}

#[test]
fn resolves_rust_runtime_binary_under_resource_runtime_root() {
    let layout = resolve_runtime_layout(PathBuf::from("/app/Contents/Resources"));

    assert_eq!(
        layout.binary_path,
        PathBuf::from("/app/Contents/Resources/runtime/crawclaw/bin").join(runtime_binary_name())
    );
    assert_eq!(
        layout.manifest_path,
        PathBuf::from("/app/Contents/Resources/runtime/crawclaw/runtimes/manifest.json")
    );
    assert_eq!(
        layout.channel_manifest_path,
        PathBuf::from("/app/Contents/Resources/runtime/crawclaw/channels/manifest.json")
    );
}

#[test]
fn desktop_agent_provider_config_builds_native_provider_config() {
    let runtime_root = unique_test_runtime_root("desktop-agent-provider-config");
    let config = DesktopAgentProviderConfig {
        runtime: DesktopAgentRuntimeMode::NativeProvider,
        provider: "anthropic".to_string(),
        base_url: Some("https://api.anthropic.com".to_string()),
        api_key: Some(json!("secret")),
        model: Some("sonnet-4.6".to_string()),
        api: Some("anthropic-messages".to_string()),
        api_version: Some("2023-06-01".to_string()),
    };

    let native_config = ProviderResolver::resolve_desktop_config(&config, &runtime_root)
        .expect("native provider config");

    assert_eq!(native_config.provider, "anthropic");
    assert_eq!(native_config.model.as_deref(), Some("sonnet-4.6"));
    assert_eq!(native_config.api.as_deref(), Some("anthropic-messages"));
    assert_eq!(native_config.api_version.as_deref(), Some("2023-06-01"));
}

#[test]
fn desktop_agent_provider_config_uses_rust_default_model_catalog() {
    let runtime_root = unique_test_runtime_root("desktop-agent-provider-default-model");
    let config = DesktopAgentProviderConfig {
        runtime: DesktopAgentRuntimeMode::NativeProvider,
        provider: "openai".to_string(),
        base_url: None,
        api_key: Some(json!("secret")),
        model: None,
        api: None,
        api_version: None,
    };

    let native_config = ProviderResolver::resolve_desktop_config(&config, &runtime_root)
        .expect("native provider config");

    assert_eq!(native_config.provider, "openai");
    assert_eq!(native_config.model.as_deref(), Some("gpt-5.4"));
}

#[test]
fn desktop_agent_provider_config_rejects_non_chat_provider_descriptors() {
    let runtime_root = unique_test_runtime_root("desktop-agent-provider-non-chat");
    let config = DesktopAgentProviderConfig {
        runtime: DesktopAgentRuntimeMode::NativeProvider,
        provider: "fal".to_string(),
        base_url: None,
        api_key: Some(json!("secret")),
        model: None,
        api: None,
        api_version: None,
    };

    let error = ProviderResolver::resolve_desktop_config(&config, &runtime_root)
        .expect_err("non-chat provider should be rejected");

    assert!(error
        .message()
        .contains("does not expose a Rust-native chat transport"));
}

#[test]
fn desktop_agent_provider_config_resolves_file_secret_ref_api_key() {
    let runtime_root = unique_test_runtime_root("desktop-agent-provider-secret-ref");
    let secret_path = runtime_root.join("secrets").join("provider-api-key");
    fs::create_dir_all(secret_path.parent().expect("secret parent")).expect("secret dir");
    fs::write(&secret_path, "resolved-secret\n").expect("write secret");
    let config = DesktopAgentProviderConfig {
        runtime: DesktopAgentRuntimeMode::NativeProvider,
        provider: "openai-compatible".to_string(),
        base_url: Some("https://api.example.test/v1".to_string()),
        api_key: Some(json!({
            "source": "file",
            "provider": "default",
            "id": secret_path.to_string_lossy()
        })),
        model: Some("model-a".to_string()),
        api: None,
        api_version: None,
    };

    let native_config = ProviderResolver::resolve_desktop_config(&config, &runtime_root)
        .expect("native provider config");

    assert_eq!(native_config.api_key.as_deref(), Some("resolved-secret"));
}

#[derive(Clone)]
struct FakeAgentRuntimeBackend {
    reply: String,
}

impl AgentRuntimeBackend for FakeAgentRuntimeBackend {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<String, AgentRuntimeError>> + Send + 'a>> {
        Box::pin(async move {
            assert_eq!(request.provider_config.provider, "test-provider");
            assert_eq!(request.provider_config.model.as_deref(), Some("test-model"));
            assert_eq!(request.provider_config.api_key.as_deref(), Some("test-key"));
            assert!(request.history.is_empty());
            Ok(self.reply.clone())
        })
    }
}

fn unique_test_runtime_root(name: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "crawclaw-runtime-{name}-{}-{unique}",
        std::process::id()
    ))
}

fn start_openai_compatible_provider(reply: &str) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("provider listener");
    let addr = listener.local_addr().expect("provider addr");
    let reply = reply.to_string();
    let (request_tx, request_rx) = mpsc::channel();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("provider request");
        let request = read_http_request(&mut stream);
        let request_text = String::from_utf8_lossy(&request).to_string();
        request_tx
            .send(request_text.clone())
            .expect("send captured request");
        let (content_type, body) = if request_text.contains(r#""stream":true"#) {
            let chunk = serde_json::to_string(&json!({
                "choices": [
                    {
                        "delta": {
                            "content": reply
                        }
                    }
                ]
            }))
            .expect("response chunk");
            (
                "text/event-stream",
                format!("data: {chunk}\n\ndata: [DONE]\n\n"),
            )
        } else {
            (
                "application/json",
                serde_json::to_string(&json!({
                    "choices": [
                        {
                            "message": {
                                "content": reply
                            }
                        }
                    ]
                }))
                .expect("response body"),
            )
        };
        write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write response");
    });
    (format!("http://{addr}/v1"), request_rx)
}

fn read_http_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
    let mut request = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = stream.read(&mut buffer).expect("read request");
        if count == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..count]);
        if http_request_complete(&request) {
            break;
        }
    }
    request
}

fn http_request_complete(request: &[u8]) -> bool {
    let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    let headers = String::from_utf8_lossy(&request[..header_end]);
    let content_length = headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse::<usize>().ok()
        } else {
            None
        }
    });
    let Some(content_length) = content_length else {
        return true;
    };
    request.len() >= header_end + 4 + content_length
}

fn tool_output_text(output: &pi::sdk::ToolOutput) -> String {
    output
        .content
        .iter()
        .filter_map(|block| match block {
            pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

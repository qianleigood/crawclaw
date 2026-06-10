use super::*;
use serde_json::json;
use sha2::{Digest, Sha256};
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
        || relative.starts_with("apps/crawclaw-desktop/e2e/")
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
fn rust_runtime_repo_guardrails_keep_automation_environment_in_settings() {
    let root = repo_root();
    let automation_view_path =
        root.join("apps/crawclaw-desktop/src/views/automation-workspace.tsx");
    let settings_view_path = root.join("apps/crawclaw-desktop/src/views/settings-workspace.tsx");
    let automation_source =
        fs::read_to_string(&automation_view_path).expect("read automation workspace view");
    let settings_source =
        fs::read_to_string(&settings_view_path).expect("read settings workspace view");
    let automation_environment_path =
        root.join("apps/crawclaw-desktop/src/views/automation-environment.tsx");
    let automation_environment_source = fs::read_to_string(&automation_environment_path)
        .expect("read automation environment view");

    assert!(
        !automation_source.contains("Automation Runtime Manager")
            && !automation_source.contains("automation-runtime-panel")
            && !automation_source.contains("automation-environment-strip")
            && !automation_source.contains("automation-environment-panel")
            && !automation_source.contains("安装环境")
            && !automation_source.contains("Endpoint")
            && !automation_source.contains("Health"),
        "Automation workspace should focus on execution tabs; runtime install/config UI belongs in Settings"
    );
    assert!(
        settings_source.contains("自动化环境") && settings_source.contains("'automation'"),
        "Settings workspace must expose the n8n / ComfyUI automation environment section"
    );
    assert!(
        !settings_source.contains("Automation Runtime Manager"),
        "Settings workspace should use the product name 自动化环境 instead of Automation Runtime Manager"
    );
    assert!(
        !settings_source.contains("本机自动化环境"),
        "Settings automation copy should avoid repeating 自动化环境 in the section detail"
    );
    assert!(
        !settings_source.contains("Cron scheduler"),
        "Cron is built in and should not be presented as an installable automation environment"
    );
    assert!(
        automation_source.contains("automation-execution-board")
            && automation_source.contains("automation-execution-overview")
            && automation_source.contains("automation-command-bar")
            && automation_source.contains("automation-section-grid")
            && automation_source.contains("automation-workspace__summary"),
        "Automation workspace should use the execution-board layout with command controls and four sections"
    );
    assert!(
        automation_environment_source.contains("automation-environment-services")
            && automation_environment_source.contains("automation-environment-overview")
            && automation_environment_source.contains("automation-environment-service")
            && automation_environment_source.contains("automation-environment-service__quick-status")
            && automation_environment_source.contains("automation-environment-install-center")
            && automation_environment_source.contains("automation-environment-install")
            && automation_environment_source.contains("automation-environment-run-control")
            && automation_environment_source.contains("onInstallRuntime")
            && automation_environment_source.contains("'install'")
            && automation_environment_source.contains("data-runtime-action=\"install\"")
            && automation_environment_source.contains("安装环境")
            && automation_environment_source.contains("更新环境")
            && automation_environment_source.contains("显卡 profile")
            && automation_environment_source.contains("PyTorch index URL")
            && automation_environment_source.contains("'start'")
            && automation_environment_source.contains("'stop'")
            && automation_environment_source.contains("'refresh'"),
        "Automation environment settings must keep install/start/stop/refresh controls for n8n and ComfyUI"
    );
    assert!(
        !automation_environment_source.contains("automation-environment-panel__header")
            && !automation_environment_source.contains("<h3>自动化环境</h3>"),
        "Automation environment should not duplicate the Settings section title"
    );
    assert!(
        !automation_environment_source.contains(".toSorted("),
        "Automation environment settings must stay compatible with the desktop WebView runtime"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_agents_desktop_guidance_current() {
    let root = repo_root();
    let agents_path = root.join("AGENTS.md");
    let agents_source = fs::read_to_string(&agents_path).expect("read AGENTS.md");

    for needle in [
        "desktop:tauri:build",
        "desktop:tauri:dev",
        "desktop:tauri:release-check",
        "desktop:tauri:stage-runtime",
        "apps/crawclaw-desktop/package.json",
        "apps/crawclaw-desktop/src-tauri/Cargo.toml",
        "apps/crawclaw-desktop/src-tauri/tauri.conf.json",
        "scripts/codesign-mac-app.sh",
        "scripts/notarize-mac-artifact.sh",
    ] {
        assert!(
            agents_source.contains(needle),
            "AGENTS.md should reference current desktop packaging/version guidance: {needle}"
        );
    }

    for stale_path in [
        "scripts/package-mac-app.sh",
        "scripts/restart-mac.sh",
        "apps/android/app/build.gradle.kts",
        "apps/ios/Sources/Info.plist",
        "apps/macos/Sources/CrawClaw/Resources/Info.plist",
        "src/canvas-host/a2ui/.bundle.hash",
        "scripts/bundle-a2ui.sh",
    ] {
        assert!(
            !agents_source.contains(stale_path),
            "AGENTS.md should not reference removed repo paths: {stale_path}"
        );
    }
}

#[test]
fn rust_runtime_repo_guardrails_keep_copilot_instructions_aligned_with_commit_flow() {
    let root = repo_root();
    let instructions_path = root.join(".github/instructions/copilot.instructions.md");
    let instructions_source =
        fs::read_to_string(&instructions_path).expect("read copilot instructions");

    assert!(
        instructions_source.contains("scripts/committer"),
        "Copilot instructions should reference the repo scoped commit helper"
    );
    assert!(
        !instructions_source.contains("do NOT use scripts/committer"),
        "Copilot instructions must not contradict AGENTS.md scoped commit guidance"
    );
    assert!(
        instructions_source.contains("pnpm check") && instructions_source.contains("pnpm test"),
        "Copilot instructions should keep the same local verification gate names as AGENTS.md"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_desktop_dialogs_app_owned() {
    let root = repo_root();
    let desktop_src = root.join("apps/crawclaw-desktop/src");
    let mut files = Vec::new();
    collect_ts_files(&desktop_src, &mut files);

    let window_confirm_hits = files
        .iter()
        .filter_map(|path| {
            let source = fs::read_to_string(path).expect("read desktop renderer source");
            source
                .contains("window.confirm")
                .then(|| slash_path(path.strip_prefix(&root).expect("relative path")))
        })
        .collect::<Vec<_>>();
    assert!(
        window_confirm_hits.is_empty(),
        "desktop confirmations must use app-owned dialogs, not native window.confirm: {window_confirm_hits:?}"
    );

    let app_source = fs::read_to_string(root.join("apps/crawclaw-desktop/src/App.tsx"))
        .expect("read desktop app");
    assert!(
        !app_source.contains("addPluginSkillLocally"),
        "plugin skill additions must surface backend failure instead of creating a local fallback skill"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_plugin_workspace_full_chain_ui() {
    let root = repo_root();
    let plugin_workspace_path = root.join("apps/crawclaw-desktop/src/views/plugins-workspace.tsx");
    let plugin_source = fs::read_to_string(&plugin_workspace_path).expect("read plugin workspace");
    for needle in [
        "Tools",
        "Skills",
        "Installed",
        "onInstallPlugin",
        "onInvokePluginTool",
        "tools:",
        "installed:",
    ] {
        assert!(
            plugin_source.contains(needle),
            "plugins-workspace.tsx must expose the full plugin center surface: missing {needle}"
        );
    }

    let app_source =
        fs::read_to_string(root.join("apps/crawclaw-desktop/src/App.tsx")).expect("read app");
    for needle in ["installPlugin", "invokePluginTool", "togglePluginTool"] {
        assert!(
            app_source.contains(needle),
            "App.tsx must wire plugin workspace operation {needle}"
        );
    }
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
fn rust_runtime_repo_guardrails_keep_desktop_ui_copy_current_with_backend() {
    let root = repo_root();
    let source_root = root.join("apps/crawclaw-desktop/src");
    let mut files = Vec::new();
    collect_ts_files(&source_root, &mut files);

    let forbidden_needles = [
        "后端先不要接",
        "静态设计",
        "静态入口",
        "后续接 Rust Desktop API",
        "后续会接入运行状态",
        "保留后续语音唤醒入口",
    ];
    let mut hits = Vec::new();
    for file in files {
        let relative = slash_path(file.strip_prefix(&root).expect("relative source path"));
        let source = fs::read_to_string(&file).expect("read desktop source");
        for needle in forbidden_needles {
            if source.contains(needle) {
                hits.push(format!("{relative}: {needle}"));
            }
        }
    }

    assert!(
        hits.is_empty(),
        "desktop UI copy must not describe backend-backed surfaces as static or future work: {hits:?}"
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
fn rust_runtime_repo_guardrails_keep_production_tool_catalog_surfaces_on_native_runtime_names() {
    let root = repo_root();
    let checked_files = [
        "apps/crawclaw-desktop/src-tauri/src/gateway/desktop_api/desktop_native_operations.rs",
        "crates/crawclaw-gateway/src/gateway_control.rs",
        "crates/crawclaw-gateway/src/gateway_runtime_memory.rs",
        "crates/crawclaw-gateway/src/gateway_tools.rs",
        "crates/crawclaw-runtime/src/agent_context.rs",
        "crates/crawclaw-runtime/src/core_tools/core_tools_media.rs",
        "crates/crawclaw-runtime/src/main.rs",
    ];
    let hits = checked_files
        .iter()
        .filter_map(|relative| {
            let source = fs::read_to_string(root.join(relative)).expect("read production source");
            source
                .contains("pi_agent_rust_tool_")
                .then(|| (*relative).to_string())
        })
        .collect::<Vec<_>>();

    assert!(
        hits.is_empty(),
        "production tool catalog/status surfaces should use native_runtime_tool_* names, not pi_agent_rust_tool_* compatibility aliases: {hits:?}"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_native_provider_backend_off_pi_registry_name() {
    let root = repo_root();
    let source =
        fs::read_to_string(root.join("crates/crawclaw-runtime/src/agent_runtime_backend.rs"))
            .expect("read backend source");
    assert!(
        !source.contains("build_pi_agent_rust_tool_registry_for_selection"),
        "NativeProvider backend must use native runtime registry naming, not pi_agent_rust compatibility aliases"
    );
}

#[test]
fn rust_runtime_repo_guardrails_remove_pi_agent_runtime_dependency() {
    let root = repo_root();
    let runtime_manifest = fs::read_to_string(root.join("crates/crawclaw-runtime/Cargo.toml"))
        .expect("read runtime manifest");
    assert!(
        !runtime_manifest.contains("pi_agent_rust"),
        "crawclaw-runtime must not depend on pi_agent_rust after NativeProvider becomes the runtime"
    );

    let backend_source =
        fs::read_to_string(root.join("crates/crawclaw-runtime/src/agent_runtime_backend.rs"))
            .expect("read backend source");
    for removed_symbol in [
        "PiAgentRuntimeBackend",
        "with_pi_agent_backend",
        "DesktopAgentRuntimeMode::PiAgentRust",
    ] {
        assert!(
            !backend_source.contains(removed_symbol),
            "agent runtime backend still exposes removed PiAgent runtime symbol {removed_symbol}"
        );
    }

    let bridge_source =
        fs::read_to_string(root.join("crates/crawclaw-runtime/src/agent_provider_bridge.rs"))
            .expect("read provider bridge");
    assert!(
        !bridge_source.contains("CrawClawPiProvider"),
        "NativeProvider must not keep the PiAgent provider shim"
    );
    assert!(
        !bridge_source.contains("pi-agent-rust"),
        "NativeProvider must not keep a pi-agent-rust runtime config alias"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_legacy_pi_prompt_assets_absent() {
    let root = repo_root();
    let existing = tracked_files(&root)
        .into_iter()
        .filter(|relative| relative.starts_with(".pi/"))
        .filter(|relative| root.join(relative).exists())
        .collect::<Vec<_>>();

    assert!(
        existing.is_empty(),
        "legacy Pi prompt assets should live outside this repo: {existing:?}"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_legacy_agents_redirect_absent() {
    let root = repo_root();
    let existing = tracked_files(&root)
        .into_iter()
        .filter(|relative| relative == ".agents/maintainers.md")
        .filter(|relative| root.join(relative).exists())
        .collect::<Vec<_>>();

    assert!(
        existing.is_empty(),
        "legacy maintainer agent redirect should live outside this repo: {existing:?}"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_contributing_desktop_frontend_current() {
    let root = repo_root();
    let contributing = fs::read_to_string(root.join("CONTRIBUTING.md"))
        .expect("read contributing guide");
    assert!(
        contributing.contains("apps/crawclaw-desktop")
            && contributing.contains("CrawClaw Desktop Frontend"),
        "CONTRIBUTING.md must point contributors at the current desktop renderer"
    );
    assert!(
        !contributing.contains("apps/crawclaw-admin")
            && !contributing.contains("CrawClaw Admin Frontend"),
        "CONTRIBUTING.md must not direct contributors to the removed admin frontend"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_readme_desktop_quick_start_current() {
    let root = repo_root();
    let readme = fs::read_to_string(root.join("README.md")).expect("read README");
    let zh_readme = fs::read_to_string(root.join("README.zh-CN.md")).expect("read zh-CN README");
    assert!(
        readme.contains("opens the Desktop workbench"),
        "README.md quick start must describe the current desktop workbench"
    );
    assert!(
        zh_readme.contains("打开连接本机 Gateway 的桌面工作台"),
        "README.zh-CN.md quick start must describe the current desktop workbench"
    );
    assert!(
        !readme.contains("admin UI") && !readme.contains("admin console"),
        "README.md must not use retired admin UI wording"
    );
    assert!(
        !zh_readme.contains("管理界面"),
        "README.zh-CN.md must not use retired admin UI wording"
    );
    assert!(
        readme.contains("[bundled plugin tree](extensions)")
            && !readme.contains("[extensions](extensions)"),
        "README.md repo map should label extensions as the bundled plugin tree"
    );
    assert!(
        zh_readme.contains("[捆绑插件树](extensions)")
            && !zh_readme.contains("[extensions](extensions)"),
        "README.zh-CN.md repo map should label extensions as the bundled plugin tree"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_public_plugin_docs_on_plugin_terminology() {
    let root = repo_root();
    let plugin_overview = fs::read_to_string(root.join("docs/tools/plugin.md"))
        .expect("read plugin overview");
    let plugin_architecture = fs::read_to_string(root.join("docs/plugins/architecture.md"))
        .expect("read plugin architecture");
    let start_hubs = fs::read_to_string(root.join("docs/start/hubs.md"))
        .expect("read start hubs");
    let provider_plugin_metadata = fs::read_to_string(
        root.join("docs/maintainers/provider-plugin-metadata-drift.md"),
    )
    .expect("read provider plugin metadata guide");
    let security = fs::read_to_string(root.join("docs/gateway/security/index.md"))
        .expect("read security guide");
    let combined = format!(
        "{plugin_overview}\n{plugin_architecture}\n{start_hubs}\n{provider_plugin_metadata}\n{security}",
    );
    let forbidden_needles = [
        "Workspace extensions",
        "Global extensions",
        "Extensions + plugins",
        "Plugins/extensions",
        "global extension roots",
        "bundled extensions",
        "Extension manifests",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| combined.contains(needle))
        .collect::<Vec<_>>();

    assert!(
        hits.is_empty(),
        "public plugin docs must use plugin terminology instead of extension-facing labels: {hits:?}"
    );
    assert!(
        plugin_overview.contains("Workspace plugin roots")
            && plugin_overview.contains("Global plugin roots"),
        "plugin overview discovery steps should use plugin root terminology"
    );
    assert!(
        plugin_architecture.contains("global plugin roots, and bundled plugins"),
        "plugin architecture should describe discovery with plugin terminology"
    );
    assert!(
        start_hubs.contains("## Plugins"),
        "start hub should use the Plugins section heading"
    );
    assert!(
        provider_plugin_metadata.contains("contracts for bundled plugins")
            && provider_plugin_metadata.contains("Plugin manifests stay as package"),
        "provider plugin metadata guide should use plugin terminology"
    );
    assert!(
        security.contains("## Plugins") && !security.contains("## Plugins/extensions"),
        "security guide should use plugin terminology"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_configuration_docs_on_current_sandbox_schema() {
    let root = repo_root();
    let configuration = fs::read_to_string(root.join("docs/gateway/configuration.md"))
        .expect("read configuration guide");
    let examples = fs::read_to_string(root.join("docs/gateway/configuration-examples.md"))
        .expect("read configuration examples");
    let combined = format!("{configuration}\n{examples}");
    let forbidden_needles = [
        "scripts/sandbox-setup.sh",
        "sandbox: {",
        "mode: \"non-main\"",
        "workspaceAccess",
        "backend: \"ssh\"",
    ];
    let hits = forbidden_needles
        .into_iter()
        .filter(|needle| combined.contains(needle))
        .collect::<Vec<_>>();

    assert!(
        hits.is_empty(),
        "configuration docs must not advertise removed agent sandbox config: {hits:?}"
    );
    assert!(
        configuration.contains("browser.noSandbox"),
        "configuration guide should point sandbox troubleshooting at the current browser.noSandbox field"
    );
}

#[test]
fn rust_runtime_repo_guardrails_keep_repo_structure_on_tracked_extension_layout() {
    let root = repo_root();
    let repo_structure = fs::read_to_string(root.join("docs/maintainers/repo-structure.md"))
        .expect("read repo structure guide");
    assert!(
        repo_structure.contains("`extensions/` is the bundled plugin ecosystem layer")
            && !repo_structure.contains("official extension/plugin ecosystem layer")
            && !repo_structure.contains("tool-oriented extensions")
            && !repo_structure.contains("extension packages"),
        "repo structure guide should describe extensions/ as the bundled plugin ecosystem"
    );
    if !root.join("extensions/shared").exists() {
        assert!(
            !repo_structure.contains("extensions/shared"),
            "repo structure guide must not describe a missing extensions/shared directory"
        );
    }
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
fn desktop_runtime_manifest_advertises_automation_environment_services() {
    let runtime_root = unique_test_runtime_root("runtime-automation-manifest");

    stage_desktop_runtime_manifests(&runtime_root).expect("stage runtime manifests");
    let raw = fs::read_to_string(runtime_root.join("runtimes").join("manifest.json"))
        .expect("runtime manifest");
    let manifest: Value = serde_json::from_str(&raw).expect("manifest json");
    let managed = &manifest["managedRuntimes"];

    assert_eq!(managed["n8n"]["runtime"], "node-service");
    assert_eq!(managed["n8n"]["provider"], "n8n");
    assert_eq!(managed["n8n"]["service"], "n8n");
    assert_eq!(managed["n8n"]["version"], "2.23.3");
    assert_eq!(managed["n8n"]["baseUrl"], "http://127.0.0.1:5679");
    assert_eq!(managed["n8n"]["health"]["kind"], "http");
    assert_eq!(
        managed["n8n"]["health"]["url"],
        "http://127.0.0.1:5679/healthz"
    );
    assert_eq!(managed["n8n"]["install"]["channel"], "github-release");
    assert_eq!(
        managed["n8n"]["install"]["scriptPolicy"],
        "release-asset-checksum"
    );
    let automation_release_download_base = format!(
        "https://github.com/qianleigood/crawclaw/releases/download/v{}",
        env!("CARGO_PKG_VERSION")
    );
    assert_eq!(
        managed["n8n"]["install"]["manifestUrl"],
        format!("{automation_release_download_base}/crawclaw-automation-n8n-manifest.json")
    );
    assert_eq!(
        managed["n8n"]["install"]["scriptUrl"],
        format!("{automation_release_download_base}/crawclaw-automation-n8n-install.sh")
    );
    assert_eq!(
        managed["n8n"]["install"]["sha256"],
        "ba56a100967b2743633c924f4924572e2a3c7fb474e1fe96f3b96a92c736c4ab"
    );
    assert_eq!(managed["n8n"]["license"], "Sustainable Use License");

    assert_eq!(managed["comfyui"]["runtime"], "python-service");
    assert_eq!(managed["comfyui"]["provider"], "comfyui");
    assert_eq!(managed["comfyui"]["service"], "comfyui");
    assert_eq!(
        managed["comfyui"]["sourceRef"],
        "5aa71b9bc28809a16596bb9fa3d0a6300d8e3f0e"
    );
    assert_eq!(managed["comfyui"]["baseUrl"], "http://127.0.0.1:8188");
    assert_eq!(managed["comfyui"]["health"]["kind"], "http");
    assert_eq!(
        managed["comfyui"]["health"]["url"],
        "http://127.0.0.1:8188/system_stats"
    );
    assert_eq!(managed["comfyui"]["install"]["channel"], "github-release");
    assert_eq!(
        managed["comfyui"]["install"]["scriptPolicy"],
        "release-asset-checksum"
    );
    assert_eq!(
        managed["comfyui"]["install"]["manifestUrl"],
        format!("{automation_release_download_base}/crawclaw-automation-comfyui-manifest.json")
    );
    assert_eq!(
        managed["comfyui"]["install"]["scriptUrl"],
        format!("{automation_release_download_base}/crawclaw-automation-comfyui-install.sh")
    );
    assert_eq!(
        managed["comfyui"]["install"]["sha256"],
        "af3b920b3547e8fa79d9085ee8e799479d6ca38a8f96dc78136623b0a616f090"
    );
    assert_eq!(managed["comfyui"]["license"], "GPL-3.0");

    let profiles = managed["comfyui"]["computeProfiles"]
        .as_array()
        .expect("compute profiles");
    for expected in [
        "apple-metal",
        "nvidia-cuda",
        "amd-rocm",
        "intel-xpu",
        "cpu",
        "external",
    ] {
        assert!(
            profiles.iter().any(|profile| profile["id"] == expected),
            "missing ComfyUI compute profile {expected}"
        );
    }
    let nvidia_profile = profiles
        .iter()
        .find(|profile| profile["id"] == "nvidia-cuda")
        .expect("nvidia profile");
    assert_eq!(nvidia_profile["requiresPytorchIndexUrl"], true);
    assert_eq!(
        nvidia_profile["pytorchIndexUrlDefault"],
        "https://download.pytorch.org/whl/cu126"
    );
    assert!(nvidia_profile["pytorchIndexUrlHint"]
        .as_str()
        .expect("nvidia pytorch hint")
        .contains("download.pytorch.org/whl/cu"));
    let cpu_profile = profiles
        .iter()
        .find(|profile| profile["id"] == "cpu")
        .expect("cpu profile");
    assert_ne!(cpu_profile["requiresPytorchIndexUrl"], true);

    let _ = fs::remove_dir_all(runtime_root);
}

#[test]
fn automation_runtime_release_manifests_match_install_scripts() {
    let root = repo_root();
    let automation_release_download_base = format!(
        "https://github.com/qianleigood/crawclaw/releases/download/v{}",
        env!("CARGO_PKG_VERSION")
    );

    for runtime_id in ["n8n", "comfyui"] {
        let runtime_dir = root.join("automation").join(runtime_id);
        let manifest_path = runtime_dir.join("manifest.json");
        let script_path = runtime_dir.join("install.sh");
        let manifest_raw = fs::read_to_string(&manifest_path).unwrap_or_else(|error| {
            panic!("read {}: {error}", slash_path(&manifest_path));
        });
        let manifest: Value = serde_json::from_str(&manifest_raw).unwrap_or_else(|error| {
            panic!("parse {}: {error}", slash_path(&manifest_path));
        });
        let script = fs::read(&script_path).unwrap_or_else(|error| {
            panic!("read {}: {error}", slash_path(&script_path));
        });
        let script_text = String::from_utf8(script.clone()).expect("install script utf8");

        assert_eq!(manifest["runtimeId"], runtime_id);
        assert_eq!(manifest["install"]["channel"], "github-release");
        assert_eq!(
            manifest["install"]["scriptPolicy"],
            "release-asset-checksum"
        );
        assert_eq!(manifest["assets"]["installScript"]["path"], "install.sh");
        assert_eq!(
            manifest["assets"]["manifest"]["publishedAs"],
            format!("crawclaw-automation-{runtime_id}-manifest.json")
        );
        assert_eq!(
            manifest["assets"]["manifest"]["url"],
            format!("{automation_release_download_base}/crawclaw-automation-{runtime_id}-manifest.json")
        );
        assert_eq!(
            manifest["assets"]["installScript"]["publishedAs"],
            format!("crawclaw-automation-{runtime_id}-install.sh")
        );
        assert_eq!(
            manifest["assets"]["installScript"]["url"],
            format!("{automation_release_download_base}/crawclaw-automation-{runtime_id}-install.sh")
        );
        assert!(
            !manifest_raw.contains("/releases/latest/download/"),
            "automation release assets must use versioned release URLs"
        );
        assert_eq!(
            manifest["assets"]["installScript"]["sha256"]
                .as_str()
                .expect("install script sha256"),
            sha256_hex(&script)
        );
        assert!(
            script_text.starts_with("#!/usr/bin/env bash\nset -euo pipefail\n"),
            "install script must use bash strict mode"
        );
        assert!(
            !script_text.contains("curl | sh"),
            "install script must not pipe remote scripts directly into a shell"
        );
        assert!(
            !script_text.contains("N8N_VERSION:-latest"),
            "n8n installer must not default to a moving latest version"
        );
        assert!(
            !script_text.contains("git pull"),
            "automation installer must not update from a moving branch"
        );
        if runtime_id == "n8n" {
            assert_eq!(manifest["version"], "2.23.3");
            assert!(
                script_text.contains("N8N_VERSION:-2.23.3"),
                "n8n installer must default to the manifest version"
            );
        } else {
            assert_eq!(
                manifest["sourceRef"],
                "5aa71b9bc28809a16596bb9fa3d0a6300d8e3f0e"
            );
            let profiles = manifest["computeProfiles"]
                .as_array()
                .expect("ComfyUI release manifest compute profiles");
            let nvidia_profile = profiles
                .iter()
                .find(|profile| profile["id"] == "nvidia-cuda")
                .expect("ComfyUI release manifest nvidia profile");
            assert_eq!(nvidia_profile["requiresPytorchIndexUrl"], true);
            assert_eq!(
                nvidia_profile["pytorchIndexUrlDefault"],
                "https://download.pytorch.org/whl/cu126"
            );
            assert!(nvidia_profile["pytorchIndexUrlHint"]
                .as_str()
                .expect("ComfyUI release manifest pytorch hint")
                .contains("download.pytorch.org/whl/cu"));
            assert!(
                script_text.contains("nvidia-cuda | amd-rocm | intel-xpu)"),
                "ComfyUI GPU profiles must select a PyTorch wheel channel"
            );
            assert!(
                script_text.contains("pytorch_index_url_for_profile"),
                "ComfyUI installer must provide profile-specific default PyTorch wheel channels"
            );
            assert!(
                script_text.contains("requires PYTORCH_INDEX_URL"),
                "ComfyUI GPU profile installs must tell the user how to choose the PyTorch wheel channel"
            );
            assert!(
                script_text.contains("COMFYUI_REF:-5aa71b9bc28809a16596bb9fa3d0a6300d8e3f0e"),
                "ComfyUI installer must default to the manifest source ref"
            );
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

#[test]
fn native_runtime_core_tool_registry_uses_crawclaw_tool_names() {
    let runtime_root = unique_test_runtime_root("native-provider-core-tools");
    let registry = build_native_runtime_tool_registry(&runtime_root);
    let tool_names: Vec<&str> = registry.tools().iter().map(|tool| tool.name()).collect();

    for expected_tool_name in [
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
        "text_to_image",
        "generate_video",
        "image_to_video",
        "understand_image",
        "grep",
        "find",
        "ls",
        "web_search",
        "web_fetch",
        "session_status",
        "sessions_list",
        "sessions_history",
        "sessions_send",
        "subagents_spawn",
        "sessions_yield",
        "subagents",
        "canvas",
        "message",
        "cron",
        "image",
        "pdf",
        "tts",
        "tool_search",
        "discover_skills",
        "load_skill",
        "workflow",
        "workflowize",
        "Brief",
        "Config",
        "NotebookEdit",
        "review_task",
        "knowledge_recall",
        "knowledge_reflect",
        "knowledge_ingest",
        "knowledge_model_list",
        "knowledge_model_create",
        "session_summary_file_read",
        "session_summary_file_edit",
    ] {
        assert!(
            tool_names.contains(&expected_tool_name),
            "missing tool: {expected_tool_name}"
        );
    }
    assert!(registry.get("bash").is_some());
    assert!(registry.get("exec").is_none());
    let catalog_names = native_runtime_tool_names();
    assert!(catalog_names.contains(&"knowledge_recall".to_string()));
    assert!(catalog_names.contains(&"knowledge_reflect".to_string()));
    assert!(!catalog_names.contains(&"memory_note_read".to_string()));
    assert!(!catalog_names.contains(&"write_experience_note".to_string()));
}

#[tokio::test]
async fn notebook_edit_replaces_inserts_and_deletes_cells() {
    let runtime_root = unique_test_runtime_root("notebook-edit-core-tool");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let notebook_path = runtime_root.join("analysis.ipynb");
    fs::write(
        &notebook_path,
        serde_json::to_vec_pretty(&json!({
            "cells": [
                {
                    "cell_type": "markdown",
                    "id": "intro",
                    "metadata": {},
                    "source": "# Old title\n"
                },
                {
                    "cell_type": "code",
                    "execution_count": 7,
                    "id": "calc",
                    "metadata": {},
                    "outputs": [{ "output_type": "stream", "name": "stdout", "text": "old\n" }],
                    "source": "x = 1\nprint(x)\n"
                }
            ],
            "metadata": {
                "language_info": {
                    "name": "python"
                }
            },
            "nbformat": 4,
            "nbformat_minor": 5
        }))
        .expect("notebook json"),
    )
    .expect("write notebook");

    execute_rust_core_tool(&runtime_root, "read", json!({ "path": "analysis.ipynb" }))
        .await
        .expect("read notebook before editing");

    let replaced = execute_rust_core_tool(
        &runtime_root,
        "NotebookEdit",
        json!({
            "notebook_path": "analysis.ipynb",
            "cell_id": "intro",
            "new_source": "# New title\n"
        }),
    )
    .await
    .expect("replace notebook cell");
    assert_eq!(replaced["details"]["edit_mode"], "replace");

    let inserted = execute_rust_core_tool(
        &runtime_root,
        "NotebookEdit",
        json!({
            "notebook_path": "analysis.ipynb",
            "cell_id": "intro",
            "new_source": "print('inserted')\n",
            "cell_type": "code",
            "edit_mode": "insert"
        }),
    )
    .await
    .expect("insert notebook cell");
    assert_eq!(inserted["details"]["edit_mode"], "insert");

    let deleted = execute_rust_core_tool(
        &runtime_root,
        "NotebookEdit",
        json!({
            "notebook_path": "analysis.ipynb",
            "cell_id": "calc",
            "edit_mode": "delete"
        }),
    )
    .await
    .expect("delete notebook cell");
    assert_eq!(deleted["details"]["edit_mode"], "delete");
    assert!(deleted["details"]["new_source"].is_null());

    let notebook: Value =
        serde_json::from_str(&fs::read_to_string(&notebook_path).expect("read updated notebook"))
            .expect("parse updated notebook");
    let cells = notebook["cells"].as_array().expect("notebook cells");
    assert_eq!(cells.len(), 2);
    assert_eq!(cells[0]["id"], "intro");
    assert_eq!(cells[0]["source"], "# New title\n");
    assert_eq!(cells[1]["cell_type"], "code");
    assert_eq!(cells[1]["source"], "print('inserted')\n");
    assert_eq!(cells[1]["execution_count"], Value::Null);
    assert_eq!(cells[1]["outputs"], json!([]));
    assert!(!cells.iter().any(|cell| cell["id"] == "calc"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn notebook_edit_requires_fresh_read_state() {
    let runtime_root = unique_test_runtime_root("notebook-edit-read-state");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let notebook_path = runtime_root.join("analysis.ipynb");
    fs::write(
        &notebook_path,
        serde_json::to_vec_pretty(&json!({
            "cells": [{
                "cell_type": "markdown",
                "id": "intro",
                "metadata": {},
                "source": "# Old title\n"
            }],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5
        }))
        .expect("notebook json"),
    )
    .expect("write notebook");

    let unread_error = execute_rust_core_tool(
        &runtime_root,
        "NotebookEdit",
        json!({
            "notebook_path": "analysis.ipynb",
            "cell_id": "intro",
            "new_source": "# New title\n"
        }),
    )
    .await
    .expect_err("NotebookEdit should require a prior read");
    assert!(unread_error.contains("read"));

    execute_rust_core_tool(&runtime_root, "read", json!({ "path": "analysis.ipynb" }))
        .await
        .expect("read notebook before stale edit");
    std::thread::sleep(std::time::Duration::from_millis(5));
    fs::write(
        &notebook_path,
        serde_json::to_vec_pretty(&json!({
            "cells": [{
                "cell_type": "markdown",
                "id": "intro",
                "metadata": {},
                "source": "# External title\n"
            }],
            "metadata": {},
            "nbformat": 4,
            "nbformat_minor": 5
        }))
        .expect("stale notebook json"),
    )
    .expect("external notebook edit");

    let stale_error = execute_rust_core_tool(
        &runtime_root,
        "NotebookEdit",
        json!({
            "notebook_path": "analysis.ipynb",
            "cell_id": "intro",
            "new_source": "# New title\n"
        }),
    )
    .await
    .expect_err("NotebookEdit should reject stale read state");
    assert!(stale_error.contains("modified since it was read"));

    let notebook: Value =
        serde_json::from_str(&fs::read_to_string(&notebook_path).expect("read notebook"))
            .expect("parse notebook");
    assert_eq!(notebook["cells"][0]["source"], "# External title\n");

    let _ = fs::remove_dir_all(runtime_root);
}

#[test]
fn user_visible_agent_definitions_keep_task_agents_separate_from_special_agents() {
    let definitions = crate::agent_definitions::user_visible_agent_definitions();
    let ids = definitions
        .iter()
        .map(|definition| definition.id)
        .collect::<Vec<_>>();
    assert_eq!(
        ids,
        vec!["general-purpose", "Explore", "Plan", "verification"]
    );

    let explore = definitions
        .iter()
        .find(|definition| definition.id == "Explore")
        .expect("Explore definition");
    assert_eq!(explore.permission_mode, "readOnly");
    assert!(explore.tool_allowlist.contains(&"read"));
    assert!(explore.tool_allowlist.contains(&"grep"));
    assert!(!explore.tool_allowlist.contains(&"write"));
    assert!(!explore.tool_allowlist.contains(&"NotebookEdit"));
    assert!(explore.prompt.contains("Explore agent"));

    let plan = definitions
        .iter()
        .find(|definition| definition.id == "Plan")
        .expect("Plan definition");
    assert_eq!(plan.permission_mode, "readOnly");
    assert!(plan.prompt.contains("Do not modify files"));

    let verification = definitions
        .iter()
        .find(|definition| definition.id == "verification")
        .expect("verification definition");
    assert!(verification.background);
    assert!(verification.prompt.contains("VERDICT"));

    let special_ids = crate::special_agents::special_agent_definitions()
        .iter()
        .map(|definition| definition.id)
        .collect::<Vec<_>>();
    assert!(!special_ids.contains(&"Explore"));
    assert!(!special_ids.contains(&"Plan"));
    assert!(!special_ids.contains(&"verification"));
}

#[cfg(unix)]
#[tokio::test]
async fn native_runtime_tool_registry_executes_installed_native_sidecar_tool() {
    use std::os::unix::fs::PermissionsExt;

    let runtime_root = unique_test_runtime_root("native-provider-sidecar-tool");
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
    let runtime_root = unique_test_runtime_root("native-provider-discovery-tools");
    let registry = build_native_runtime_tool_registry(&runtime_root);
    let tool_names: Vec<&str> = registry.tools().iter().map(|tool| tool.name()).collect();

    assert!(tool_names.contains(&"grep"));
    assert!(tool_names.contains(&"find"));
    assert!(tool_names.contains(&"ls"));
    assert!(tool_names.contains(&"knowledge_recall"));
    assert!(!tool_names.contains(&"memory_note_read"));
    for tool_name in ["grep", "find", "ls"] {
        let tool = registry.get(tool_name).expect("discovery tool");
        assert!(tool.is_read_only(), "{tool_name} should be read-only");
    }
}

#[test]
fn native_runtime_tool_registry_honors_runtime_allowlist() {
    let runtime_root = unique_test_runtime_root("native-provider-tool-allowlist");
    let registry = build_filtered_native_runtime_tool_registry(
        &runtime_root,
        &[
            "knowledge_recall".to_string(),
            "sessions_history".to_string(),
        ],
    );
    let tool_names = registry
        .tools()
        .iter()
        .map(|tool| tool.name())
        .collect::<Vec<_>>();

    assert_eq!(tool_names, vec!["sessions_history", "knowledge_recall"]);
    assert!(registry.get("knowledge_ingest").is_none());
    assert!(registry.get("bash").is_none());
}

#[tokio::test]
async fn permission_policy_read_only_keeps_read_tools_and_blocks_mutating_tools() {
    let runtime_root = unique_test_runtime_root("permission-read-only-tools");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    fs::write(runtime_root.join("note.txt"), "hello").expect("read fixture");
    let registry = build_native_runtime_tool_registry_with_permission_policy_for_test(
        &runtime_root,
        AgentRuntimePermissionPolicy::read_only(),
    );

    assert!(registry.get("write").is_none());
    assert!(registry.get("edit").is_none());
    assert!(registry.get("apply_patch").is_none());
    assert!(registry.get("bash").is_none());
    assert!(registry.get("process").is_none());
    assert!(registry.get("workflow").is_none());

    let read = registry.get("read").expect("read tool");
    let output = read
        .execute("read-call", json!({ "path": "note.txt" }), None)
        .await
        .expect("read succeeds");
    assert!(format!("{output:?}").contains("hello"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn permission_policy_confirm_commands_waits_for_approval_before_execution() {
    let runtime_root = unique_test_runtime_root("permission-confirm-command");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let marker = runtime_root.join("command-ran.txt");
    let requester = std::sync::Arc::new(RecordingPermissionRequester::new(vec![
        AgentRuntimePermissionDecision::Denied,
        AgentRuntimePermissionDecision::Approved,
    ]));
    let registry = build_native_runtime_tool_registry_with_permission_policy_for_test(
        &runtime_root,
        AgentRuntimePermissionPolicy::workspace()
            .with_confirm_commands(true)
            .with_requester(requester.clone()),
    );
    let bash = registry.get("bash").expect("bash tool");

    let denied = bash
        .execute(
            "bash-denied",
            json!({ "command": format!("printf denied > {}", marker.display()) }),
            None,
        )
        .await;
    assert!(denied
        .expect_err("command denied")
        .to_string()
        .contains("permission"));
    assert!(!marker.exists());

    bash.execute(
        "bash-approved",
        json!({ "command": format!("printf approved > {}", marker.display()) }),
        None,
    )
    .await
    .expect("command approved");
    assert_eq!(fs::read_to_string(&marker).expect("marker"), "approved");
    let requests = requester.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].tool_name, "bash");

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn permission_policy_confirm_file_changes_blocks_write_until_approved() {
    let runtime_root = unique_test_runtime_root("permission-confirm-file-change");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let target = runtime_root.join("file.txt");
    let requester = std::sync::Arc::new(RecordingPermissionRequester::new(vec![
        AgentRuntimePermissionDecision::Denied,
        AgentRuntimePermissionDecision::Approved,
    ]));
    let registry = build_native_runtime_tool_registry_with_permission_policy_for_test(
        &runtime_root,
        AgentRuntimePermissionPolicy::workspace()
            .with_confirm_file_changes(true)
            .with_requester(requester.clone()),
    );
    let write = registry.get("write").expect("write tool");

    let denied = write
        .execute(
            "write-denied",
            json!({ "path": "file.txt", "content": "denied" }),
            None,
        )
        .await;
    assert!(denied
        .expect_err("write denied")
        .to_string()
        .contains("permission"));
    assert!(!target.exists());

    write
        .execute(
            "write-approved",
            json!({ "path": "file.txt", "content": "approved" }),
            None,
        )
        .await
        .expect("write approved");
    assert_eq!(fs::read_to_string(&target).expect("target"), "approved");
    let requests = requester.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].tool_name, "write");

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn permission_policy_confirm_external_apps_blocks_native_plugin_tools() {
    let runtime_root = unique_test_runtime_root("permission-confirm-external");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let requester = std::sync::Arc::new(RecordingPermissionRequester::new(vec![
        AgentRuntimePermissionDecision::Denied,
    ]));
    let registry = build_native_runtime_tool_registry_with_permission_policy_for_test(
        &runtime_root,
        AgentRuntimePermissionPolicy::workspace()
            .with_confirm_external_apps(true)
            .with_requester(requester.clone()),
    );
    let browser = registry.get("browser").expect("browser tool");

    let denied = browser
        .execute("browser-denied", json!({ "action": "tabs" }), None)
        .await;
    assert!(denied
        .expect_err("browser denied")
        .to_string()
        .contains("permission"));
    let requests = requester.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].tool_name, "browser");

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn permission_policy_confirm_high_risk_blocks_workflow_tools() {
    let runtime_root = unique_test_runtime_root("permission-confirm-high-risk");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let requester = std::sync::Arc::new(RecordingPermissionRequester::new(vec![
        AgentRuntimePermissionDecision::Denied,
    ]));
    let registry = build_native_runtime_tool_registry_with_permission_policy_for_test(
        &runtime_root,
        AgentRuntimePermissionPolicy::workspace()
            .with_confirm_high_risk(true)
            .with_requester(requester.clone()),
    );
    let workflow = registry.get("workflow").expect("workflow tool");

    let denied = workflow
        .execute("workflow-denied", json!({ "action": "runs" }), None)
        .await;
    assert!(denied
        .expect_err("workflow denied")
        .to_string()
        .contains("permission"));
    let requests = requester.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].tool_name, "workflow");

    let _ = fs::remove_dir_all(runtime_root);
}

#[cfg(unix)]
#[tokio::test]
async fn enter_worktree_retargets_workspace_file_tools() {
    let runtime_root = unique_test_runtime_root("worktree-retargets-file-tools");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let run_git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(&runtime_root)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run_git(&["init"]);
    run_git(&["config", "user.email", "test@example.invalid"]);
    run_git(&["config", "user.name", "CrawClaw Test"]);
    fs::write(runtime_root.join("marker.txt"), "root\n").expect("marker");
    run_git(&["add", "marker.txt"]);
    run_git(&["commit", "-m", "initial"]);

    let registry = build_native_runtime_tool_registry(&runtime_root);
    let enter = registry.get("EnterWorktree").expect("EnterWorktree");
    let entered = enter
        .execute("enter-worktree", json!({ "name": "isolation-test" }), None)
        .await
        .expect("enter worktree");
    let worktree_path = entered
        .details
        .as_ref()
        .and_then(|details| details.get("worktreePath"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .expect("worktree path");
    fs::write(worktree_path.join("marker.txt"), "worktree\n").expect("worktree marker");

    let worktree_registry = build_native_runtime_tool_registry(&runtime_root);
    let read = worktree_registry.get("read").expect("read");
    let output = read
        .execute("read-marker", json!({ "path": "marker.txt" }), None)
        .await
        .expect("read marker");
    assert_eq!(tool_output_text(&output), "worktree\n");

    let write = worktree_registry.get("write").expect("write");
    write
        .execute(
            "write-worktree-only",
            json!({ "path": "worktree-only.txt", "content": "created in worktree" }),
            None,
        )
        .await
        .expect("write in worktree");
    assert!(worktree_path.join("worktree-only.txt").is_file());
    assert!(!runtime_root.join("worktree-only.txt").exists());

    let exit = worktree_registry.get("ExitWorktree").expect("ExitWorktree");
    exit.execute("exit-worktree", json!({ "action": "keep" }), None)
        .await
        .expect("exit worktree");
    let _ = fs::remove_dir_all(runtime_root);
}

struct RecordingPermissionRequester {
    decisions: std::sync::Mutex<std::collections::VecDeque<AgentRuntimePermissionDecision>>,
    requests: std::sync::Mutex<Vec<AgentRuntimePermissionRequest>>,
}

impl RecordingPermissionRequester {
    fn new(decisions: Vec<AgentRuntimePermissionDecision>) -> Self {
        Self {
            decisions: std::sync::Mutex::new(decisions.into()),
            requests: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<AgentRuntimePermissionRequest> {
        self.requests.lock().expect("requests").clone()
    }
}

impl AgentRuntimePermissionRequester for RecordingPermissionRequester {
    fn request_permission<'a>(
        &'a self,
        request: AgentRuntimePermissionRequest,
    ) -> Pin<Box<dyn Future<Output = AgentRuntimePermissionDecision> + Send + 'a>> {
        Box::pin(async move {
            self.requests.lock().expect("requests").push(request);
            self.decisions
                .lock()
                .expect("decisions")
                .pop_front()
                .unwrap_or(AgentRuntimePermissionDecision::Denied)
        })
    }
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
    assert!(definition("subagents_spawn").default_enabled);
    assert!(!definition("subagents_spawn").read_only);
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
    assert!(definition("tool_search").read_only);
    assert!(definition("discover_skills").read_only);
    assert!(definition("load_skill").read_only);
    assert!(!definition("workflow").read_only);
    assert!(!definition("workflowize").read_only);
    assert!(definition("Brief").read_only);
    assert!(!definition("Config").read_only);
    assert!(!definition("NotebookEdit").read_only);
    for tool_name in [
        "session_status",
        "sessions_list",
        "sessions_history",
        "subagents",
        "review_task",
        "knowledge_model_list",
        "knowledge_recall",
        "knowledge_reflect",
        "session_summary_file_read",
    ] {
        assert!(definition(tool_name).default_enabled);
        assert!(definition(tool_name).read_only);
    }
    for tool_name in [
        "knowledge_ingest",
        "knowledge_model_create",
        "session_summary_file_edit",
    ] {
        assert!(definition(tool_name).default_enabled);
        assert!(!definition(tool_name).read_only);
    }
    for tool_name in ["grep", "find", "ls"] {
        assert!(definition(tool_name).default_enabled);
        assert!(definition(tool_name).read_only);
    }
    let tool_names = native_runtime_tool_names();
    for expected in [
        "apply_patch",
        "process",
        "subagents_spawn",
        "message",
        "cron",
        "tts",
        "workflow",
        "workflowize",
        "Brief",
        "Config",
        "NotebookEdit",
        "review_task",
        "knowledge_ingest",
        "knowledge_reflect",
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
    let mcp_tools = payload["mcpTools"].as_array().expect("mcp tools");

    assert!(sections.iter().any(|section| section["id"] == "runtime"));
    assert!(core_tools.iter().any(|tool| tool["id"] == "bash"));
    assert!(mcp_tools.is_empty());
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
    assert!(skills["details"]["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .all(|skill| skill.get("location").is_none()));

    let tool_search = execute_rust_core_tool(
        &runtime_root,
        "tool_search",
        json!({ "query": "image understanding", "max_results": 5 }),
    )
    .await
    .expect("tool search output");
    assert_eq!(tool_search["details"]["status"], "ok");
    assert!(tool_search["details"]["activatedTools"]
        .as_array()
        .expect("activated tools")
        .iter()
        .any(|tool| tool == "image"));

    let loaded_skill =
        execute_rust_core_tool(&runtime_root, "load_skill", json!({ "skill": "demo" }))
            .await
            .expect("load skill output");
    assert_eq!(loaded_skill["details"]["status"], "ok");
    assert_eq!(loaded_skill["details"]["skill"]["name"], "demo");
    assert!(loaded_skill["details"]["skill"]["content"]
        .as_str()
        .expect("skill content")
        .contains("# Demo"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn direct_runtime_worker_rejects_special_agent_only_tools() {
    let runtime_root = unique_test_runtime_root("special-tool-direct-worker-guard");
    let error = execute_rust_core_tool(
        &runtime_root,
        "session_summary_file_read",
        json!({ "scope": "default" }),
    )
    .await
    .expect_err("direct worker should reject special-only tool");

    assert!(error.contains("special-agent-only"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn profiled_tool_runtime_allows_special_agent_only_tools() {
    let runtime_root = unique_test_runtime_root("profiled-special-tool-runtime");
    fs::create_dir_all(runtime_root.join("memory/session-summary")).expect("summary dir");
    fs::write(
        runtime_root.join("memory/session-summary/main.md"),
        "# Summary\n\nProfiled read.\n",
    )
    .expect("summary file");

    let output = execute_rust_core_tool_for_profile(
        &runtime_root,
        "session_summary_file_read",
        json!({ "scope": "main" }),
        AgentRunProfileKind::Compaction,
        Some("session-summary"),
    )
    .await
    .expect("profiled special tool output");

    assert_eq!(output["details"]["profileKind"], "compaction");
    assert_eq!(output["details"]["specialAgent"], "session-summary");
    assert_eq!(output["details"]["toolExecution"]["status"], "completed");
    assert!(output["text"]
        .as_str()
        .expect("output text")
        .contains("Profiled read"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn profiled_tool_runtime_rejects_special_tools_from_normal_profile() {
    let runtime_root = unique_test_runtime_root("profiled-special-tool-normal-guard");
    let error = execute_rust_core_tool_for_profile(
        &runtime_root,
        "session_summary_file_read",
        json!({ "scope": "main" }),
        AgentRunProfileKind::Normal,
        Some("session-summary"),
    )
    .await
    .expect_err("normal profile should reject special-only tool");

    assert!(error.contains("special-agent-only"));
    assert!(error.contains("profile normal"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn profiled_hindsight_tools_require_concrete_special_agent() {
    let runtime_root = unique_test_runtime_root("profiled-hindsight-tool-agent-guard");
    let error = execute_rust_core_tool_for_profile(
        &runtime_root,
        "knowledge_recall",
        json!({ "query": "project preference" }),
        AgentRunProfileKind::Compaction,
        None,
    )
    .await
    .expect_err("hindsight knowledge tool should require a concrete special-agent profile");

    assert!(error.contains("requires a concrete special-agent profile"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn profiled_hindsight_tools_honor_memory_config_disablement() {
    let runtime_root = unique_test_runtime_root("profiled-hindsight-tool-config-guard");
    let error = execute_rust_core_tool_for_profile(
        &runtime_root,
        "knowledge_recall",
        json!({ "query": "project preference" }),
        AgentRunProfileKind::SpecialAgent,
        Some("durable-memory"),
    )
    .await
    .expect_err("disabled hindsight knowledge tool should not execute");

    assert!(error.contains("disabled by memory.hindsight.memoryMode or enableKnowledgeTools"));

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
fn memory_special_agents_declare_narrow_context_and_layer_policies() {
    use crate::special_agents::{
        SpecialAgentMemoryInputContract, SpecialAgentParentContextPolicy,
        SpecialAgentPersistenceHandler,
    };

    let durable = crate::special_agents::find_special_agent("durable-memory")
        .expect("durable-memory special agent");
    assert_eq!(
        durable.parent_context_policy,
        SpecialAgentParentContextPolicy::None
    );
    assert_eq!(
        durable.input_contract,
        SpecialAgentMemoryInputContract::MemoryDelta
    );
    assert_eq!(durable.memory_layer_policy.default_layer, Some("durable"));
    assert_eq!(durable.memory_layer_policy.allowed_layers, &["durable"]);
    assert_eq!(
        durable.persistence_handler,
        SpecialAgentPersistenceHandler::HindsightMemory
    );

    let experience =
        crate::special_agents::find_special_agent("experience").expect("experience special agent");
    assert_eq!(
        experience.input_contract,
        SpecialAgentMemoryInputContract::ManualMaintenance
    );
    assert_eq!(
        experience.memory_layer_policy.default_layer,
        Some("experience")
    );
    assert_eq!(
        experience.memory_layer_policy.allowed_layers,
        &["experience"]
    );
    assert!(
        !experience
            .tool_allowlist
            .contains(&"knowledge_model_create"),
        "experience notes must use knowledge_ingest, not mental-model creation"
    );

    let dream = crate::special_agents::find_special_agent("dream").expect("dream special agent");
    assert_eq!(
        dream.input_contract,
        SpecialAgentMemoryInputContract::ManualMaintenance
    );
    assert_eq!(
        dream.memory_layer_policy.default_layer,
        Some("mental-models")
    );
    assert_eq!(dream.memory_layer_policy.allowed_layers, &["mental-models"]);
}

#[test]
fn hindsight_memory_mode_controls_prompt_recall_and_knowledge_tools() {
    let context = crate::memory::HindsightConfig::from_value(&json!({
        "enabled": true,
        "memoryMode": "context",
        "enableKnowledgeTools": true
    }));
    assert!(context.prompt_recall_enabled());
    assert!(!context.knowledge_tools_enabled());

    let tools = crate::memory::HindsightConfig::from_value(&json!({
        "enabled": true,
        "memoryMode": "tools",
        "enableKnowledgeTools": true
    }));
    assert!(!tools.prompt_recall_enabled());
    assert!(tools.knowledge_tools_enabled());

    let hybrid = crate::memory::HindsightConfig::from_value(&json!({
        "enabled": true,
        "memoryMode": "hybrid",
        "enableKnowledgeTools": true
    }));
    assert!(hybrid.prompt_recall_enabled());
    assert!(hybrid.knowledge_tools_enabled());
}

#[test]
fn hindsight_quality_config_parses_chinese_quality_overrides() {
    let config = crate::memory::HindsightConfig::from_value(&json!({
        "languageHints": {
            "primaryLanguage": "zh-CN",
            "bilingualTechnicalTerms": true
        },
        "quality": {
            "retainChunkMaxChars": 320,
            "retainChunkOverlapChars": 32,
            "recallMinScore": 0.27,
            "recallRerankTopK": 8,
            "queryRewrite": false
        }
    }));

    assert_eq!(config.quality.retain_chunk_max_chars, Some(320));
    assert_eq!(config.quality.retain_chunk_overlap_chars, Some(32));
    assert_eq!(config.quality.recall_min_score, Some(0.27));
    assert_eq!(config.quality.recall_rerank_top_k, Some(8));
    assert_eq!(config.quality.query_rewrite, Some(false));
}

#[test]
fn hindsight_context_mode_filters_special_agent_knowledge_tools() {
    let context = crate::memory::HindsightConfig::from_value(&json!({
        "enabled": true,
        "memoryMode": "context",
        "enableKnowledgeTools": true
    }));
    let filtered = crate::agent_runtime_backend::filter_hindsight_tools_for_config_for_test(
        vec![
            "knowledge_ingest".to_string(),
            "knowledge_recall".to_string(),
            "sessions_history".to_string(),
        ],
        &context,
    );
    assert_eq!(filtered, vec!["sessions_history"]);

    let hybrid = crate::memory::HindsightConfig::from_value(&json!({
        "enabled": true,
        "memoryMode": "hybrid",
        "enableKnowledgeTools": true
    }));
    let retained = crate::agent_runtime_backend::filter_hindsight_tools_for_config_for_test(
        vec![
            "knowledge_ingest".to_string(),
            "knowledge_recall".to_string(),
            "sessions_history".to_string(),
        ],
        &hybrid,
    );
    assert_eq!(
        retained,
        vec!["knowledge_ingest", "knowledge_recall", "sessions_history"]
    );
}

#[test]
fn effective_memory_policy_reports_tool_filtering_and_reasons() {
    let config = crate::memory::MemoryRuntimeConfig::from_value(&json!({
        "hindsight": {
            "enabled": true,
            "memoryMode": "context",
            "enableKnowledgeTools": true,
            "autoRetain": true
        }
    }));
    let policy = crate::memory::EffectiveMemoryPolicy::from_config(&config);

    assert!(policy.prompt_recall_enabled);
    assert!(!policy.knowledge_tools_enabled);
    assert!(policy.auto_retain_enabled);

    let tools =
        policy.apply_tool_allowlist(&["knowledge_recall", "knowledge_ingest", "sessions_history"]);
    assert_eq!(
        tools.effective_tool_allowlist,
        vec!["sessions_history".to_string()]
    );
    assert_eq!(
        tools.disabled_tools,
        vec![
            "knowledge_recall".to_string(),
            "knowledge_ingest".to_string()
        ]
    );
    assert!(tools
        .disabled_reason
        .contains("memory.hindsight.memoryMode=context"));
}

#[test]
fn profiled_memory_special_tools_resolve_agent_owned_layers() {
    let durable_default = crate::core_tools::memory_tool_layer_for_special_agent_for_test(
        "knowledge_ingest",
        json!({}),
        Some("durable-memory"),
    )
    .expect("durable default layer");
    assert_eq!(durable_default, "durable");

    let durable_resource = crate::core_tools::memory_tool_layer_for_special_agent_for_test(
        "knowledge_ingest",
        json!({ "layer": "resource" }),
        Some("durable-memory"),
    );
    assert!(durable_resource
        .expect_err("durable-memory cannot write resource")
        .contains("does not allow memory layer 'resource'"));

    let experience_default = crate::core_tools::memory_tool_layer_for_special_agent_for_test(
        "knowledge_ingest",
        json!({}),
        Some("experience"),
    )
    .expect("experience default layer");
    assert_eq!(experience_default, "experience");
}

#[tokio::test]
async fn rust_native_session_tools_manage_subagent_sessions() {
    let runtime_root = unique_test_runtime_root("native-provider-session-tools");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let registry = build_native_runtime_tool_registry(&runtime_root);
    let spawn = registry
        .get("subagents_spawn")
        .expect("subagents_spawn tool");
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
                "parentSessionKey": "main",
                "run": false
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
    let runtime_root = unique_test_runtime_root("native-provider-web-fetch");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let registry = build_native_runtime_tool_registry(&runtime_root);
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
    let runtime_root = unique_test_runtime_root("native-provider-web-search-provider");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let registry = build_native_runtime_tool_registry(&runtime_root);
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
    let runtime_root = unique_test_runtime_root("native-provider-apply-patch");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    fs::write(runtime_root.join("sample.txt"), "old\n").expect("sample");
    let registry = build_native_runtime_tool_registry(&runtime_root);
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
    let runtime_root = unique_test_runtime_root("native-provider-process");
    fs::create_dir_all(&runtime_root).expect("runtime root");
    let registry = build_native_runtime_tool_registry(&runtime_root);
    let bash = registry.get("bash").expect("bash tool");
    let process = registry.get("process").expect("process tool");

    let started = bash
        .execute(
            "bash-call",
            json!({
                "command": "printf start; sleep 0.05; printf done",
                "run_in_background": true
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
async fn agent_runtime_uses_native_provider_backend_by_default() {
    let runtime_root = unique_test_runtime_root("native-provider-default");
    let (provider_base_url, _request_rx) =
        start_openai_compatible_provider("hello from native provider");
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

    let runtime = AgentRuntime::new(runtime_root.clone());
    let result = runtime
        .send_message(
            "thread-native-default".to_string(),
            "hello direct".to_string(),
        )
        .await
        .expect("native provider result");

    assert_eq!(result.assistant_text, "hello from native provider");
    let transcript = fs::read_to_string(
        runtime_root
            .join("sessions")
            .join("thread-native-default.jsonl"),
    )
    .expect("transcript");
    assert!(transcript.contains(r#""content":"hello direct""#));
    assert!(transcript.contains(r#""content":"hello from native provider""#));
    let memory_messages =
        crate::memory::RuntimeStore::new(runtime_root.join("memory").join("runtime.db"))
            .list_messages("thread-native-default", 10)
            .expect("memory messages");
    assert_eq!(memory_messages.len(), 2);
}

#[tokio::test]
async fn agent_runtime_send_message_with_hindsight_policy_stays_out_of_async_blocking_context() {
    let runtime_root = unique_test_runtime_root("native-provider-hindsight-policy");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    fs::write(
        config_dir.join("desktop-memory-policy.json"),
        serde_json::to_vec_pretty(&json!({
            "hindsightEnabled": true,
            "hindsightBaseUrl": "http://127.0.0.1:1",
            "hindsightMode": "local",
            "hindsightManaged": false,
            "hindsightLifecycleStatus": "external"
        }))
        .expect("memory policy json"),
    )
    .expect("write memory policy");

    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(FakeAgentRuntimeBackend {
            reply: "hello with memory policy".to_string(),
        }),
    );
    let result = runtime
        .send_message(
            "thread-hindsight-policy".to_string(),
            "hello memory context".to_string(),
        )
        .await
        .expect("native provider result");

    assert_eq!(result.assistant_text, "hello with memory policy");
    assert!(
        result.memory_result.is_some(),
        "memory.afterTurn should still run under the Hindsight policy"
    );
}

#[tokio::test]
async fn agent_runtime_run_turn_emits_rust_event_contract() {
    let runtime_root = unique_test_runtime_root("agent-run-turn-events");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_native_provider_backend(
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
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(true),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("run turn");

    assert_eq!(result.run_id, "run-1");
    assert_eq!(result.session_key, "thread-events");
    assert_eq!(result.assistant_text, "hello from run_turn");
    assert_eq!(result.context_summary.profile_kind, "normal");
    let events = serde_json::to_value(&result.events).expect("events json");
    let events = events.as_array().expect("events array");
    assert!(events.iter().any(|event| event["type"] == "runStarted"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "contextProjected"
            && event["projection"]["profileKind"] == "normal"));
    assert!(events.iter().any(|event| event["type"] == "providerBlock"
        && event["blockType"] == "text"
        && event["text"] == "hello from run_turn"));
    assert!(events.iter().any(|event| event["type"] == "replyPayload"
        && event["payload"]["text"] == "hello from run_turn"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "transcriptAppended"
            && event["messageId"] == "run-1:assistant"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "toolResult" && event["toolName"] == "memory.afterTurn"));
    assert!(events.iter().any(|event| event["type"] == "runCompleted"));

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
async fn agent_runtime_memory_after_turn_marks_tool_calls_to_skip_retain() {
    let runtime_root = unique_test_runtime_root("agent-run-turn-memory-tool-call");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(LoopEventAgentRuntimeBackend {
            reply: "final after tool".to_string(),
            loop_events: vec![AgentLoopEvent::ToolExecution {
                event: ToolExecutionEvent::Started {
                    call_id: "call-read".to_string(),
                    tool_name: "read".to_string(),
                    arguments: json!({ "path": "Cargo.toml" }),
                },
            }],
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-tool-memory".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-tool-memory".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: Some("local".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "read then answer".to_string(),
                raw_body: Some("read then answer".to_string()),
                message_id: Some("in-tool-memory".to_string()),
                thread_id: Some("thread-tool-memory".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(true),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("run turn");

    let events = serde_json::to_value(&result.events).expect("events json");
    let memory_result = events
        .as_array()
        .expect("events array")
        .iter()
        .find(|event| event["type"] == "toolResult" && event["toolName"] == "memory.afterTurn")
        .expect("memory afterTurn result");
    assert_eq!(memory_result["result"]["shouldRetain"], false);

    let memory_messages =
        crate::memory::RuntimeStore::new(runtime_root.join("memory").join("runtime.db"))
            .list_messages("thread-tool-memory", 10)
            .expect("memory messages");
    assert_eq!(memory_messages.len(), 2);
    assert_eq!(memory_messages[1]["tool_calls"], json!(["read"]));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_run_turn_can_disable_memory_after_turn() {
    let runtime_root = unique_test_runtime_root("agent-run-turn-no-memory");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(FakeAgentRuntimeBackend {
            reply: "no memory reply".to_string(),
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-no-memory".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-no-memory".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: Some("local".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "hello without memory".to_string(),
                raw_body: Some("hello without memory".to_string()),
                message_id: Some("in-no-memory".to_string()),
                thread_id: Some("thread-no-memory".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("run turn");

    assert_eq!(result.assistant_text, "no memory reply");
    assert!(!serde_json::to_value(&result.events)
        .expect("events json")
        .as_array()
        .expect("events array")
        .iter()
        .any(|event| event["toolName"] == "memory.afterTurn"));
    let memory_db = runtime_root.join("memory").join("runtime.db");
    if memory_db.exists() {
        let memory_messages = crate::memory::RuntimeStore::new(memory_db)
            .list_messages("thread-no-memory", 10)
            .expect("memory messages");
        assert!(memory_messages.is_empty());
    }
}

#[tokio::test]
async fn memory_runtime_loads_desktop_policy_overlay() {
    let runtime_root = unique_test_runtime_root("memory-policy-overlay");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-memory-policy.json"),
        serde_json::to_vec_pretty(&json!({
            "rememberPreferences": false,
            "rememberProjectContext": false,
            "memoryDreamEnabled": false,
            "memoryDreamFrequency": "手动",
            "memoryCleanupConfirmation": "每次确认"
        }))
        .expect("policy json"),
    )
    .expect("write policy");

    let status = crate::memory::MemoryRuntime::new(runtime_root)
        .status()
        .expect("memory status");

    assert_eq!(status["config"]["hindsight"]["autoRetain"], false);
    assert_eq!(status["config"]["dreaming"]["enabled"], false);
    assert_eq!(
        status["config"]["desktopPolicy"]["memoryDreamFrequency"],
        "手动"
    );
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
            "runtime": "native-provider",
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
    assert_eq!(compact["result"]["compactedThroughMessageId"], "m2");
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
    let cursor = fs::read_to_string(
        runtime_root.join("memory/session-summary/runtime-compact-session.state.json"),
    )
    .expect("compaction cursor");
    assert!(cursor.contains("\"compactedThroughMessageId\": \"m2\""));
    assert!(cursor.contains("\"tailStartMessageIndex\": 2"));

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
            "runtime": "native-provider",
            "provider": "configured-provider",
            "model": "configured-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_native_provider_backend(
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
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(true),
            }),
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
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_native_provider_backend(
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
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Btw,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::from([
                ("btwQuestion".to_string(), json!("what changed?")),
                ("ephemeral".to_string(), json!(true)),
            ]),
        })
        .await
        .expect("btw run turn");

    assert_eq!(result.assistant_text, "side answer");
    assert_eq!(result.context_summary.profile_kind, "btw");
    let events = serde_json::to_value(&result.events).expect("events json");
    let events = events.as_array().expect("events array");
    assert!(events.iter().any(|event| event["type"] == "runStarted"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "contextProjected"
            && event["projection"]["profileKind"] == "btw"));
    assert!(events
        .iter()
        .any(|event| event["type"] == "providerBlock" && event["text"] == "side answer"));
    assert!(events.iter().any(|event| event["type"] == "replyPayload"
        && event["payload"]["text"] == "side answer"
        && event["payload"]["metadata"]["btw"]["question"] == "what changed?"));
    assert!(events.iter().any(|event| event["type"] == "runCompleted"));
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
async fn native_provider_backend_uses_crawclaw_provider_transport() {
    let runtime_root = unique_test_runtime_root("native-provider-direct-provider-bridge");
    let (provider_base_url, request_rx) =
        start_openai_compatible_provider("reply from provider bridge");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
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
async fn native_provider_runtime_executes_openai_tool_calls() {
    let first_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call_structured",
                            "type": "function",
                            "function": {
                                "name": "StructuredOutput",
                                "arguments": "{\"ok\":true}"
                            }
                        }
                    ]
                }
            }
        ]
    }))
    .expect("first stream chunk");
    let finish_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {},
                "finish_reason": "tool_calls"
            }
        ]
    }))
    .expect("finish stream chunk");
    let final_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {
                    "content": "final after tool"
                }
            }
        ]
    }))
    .expect("final stream chunk");
    let (provider_base_url, request_rx) = start_openai_compatible_stream_provider(vec![
        format!("data: {first_chunk}\n\ndata: {finish_chunk}\n\ndata: [DONE]\n\n"),
        format!("data: {final_chunk}\n\ndata: [DONE]\n\n"),
    ]);
    let runtime_root = unique_test_runtime_root("native-provider-openai-tool-call-bridge");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::new(runtime_root.clone());
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-openai-tool-bridge".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-openai-tool-bridge".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: Some("local".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "return structured output".to_string(),
                raw_body: Some("return structured output".to_string()),
                message_id: Some("in-openai-tool-bridge".to_string()),
                thread_id: Some("thread-openai-tool-bridge".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "openai-compatible".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("openai tool bridge run");

    assert_eq!(result.assistant_text, "final after tool");
    let events = serde_json::to_value(&result.events).expect("events json");
    let events = events.as_array().expect("events array");
    assert!(events.iter().any(|event| {
        event["type"] == "toolCall"
            && event["callId"] == "call_structured"
            && event["toolName"] == "StructuredOutput"
            && event["arguments"] == json!({ "ok": true })
    }));
    assert!(events.iter().any(|event| {
        event["type"] == "toolProgress"
            && event["callId"] == "call_structured"
            && event["status"] == "completed"
    }));

    let first_request = request_rx.recv().expect("first provider request");
    let second_request = request_rx.recv().expect("second provider request");
    assert!(first_request.contains("StructuredOutput"));
    let second_body: Value =
        serde_json::from_str(http_request_body(&second_request)).expect("second request body");
    let messages = second_body["messages"]
        .as_array()
        .expect("second request messages");
    assert!(
        messages.iter().any(|message| {
            message["role"] == "tool"
                && message["tool_call_id"] == "call_structured"
                && message["content"].as_str().is_some_and(|content| {
                    content.contains("Structured output provided successfully")
                })
        }),
        "second request body: {second_body}"
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn native_provider_runtime_executes_tool_calls_without_pi_fallback() {
    let first_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call_native_structured",
                            "type": "function",
                            "function": {
                                "name": "StructuredOutput",
                                "arguments": "{\"ok\":true}"
                            }
                        }
                    ]
                }
            }
        ]
    }))
    .expect("first stream chunk");
    let finish_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {},
                "finish_reason": "tool_calls"
            }
        ]
    }))
    .expect("finish stream chunk");
    let final_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {
                    "content": "native final after tool"
                }
            }
        ]
    }))
    .expect("final stream chunk");
    let (provider_base_url, request_rx) = start_openai_compatible_stream_provider(vec![
        format!("data: {first_chunk}\n\ndata: {finish_chunk}\n\ndata: [DONE]\n\n"),
        format!("data: {final_chunk}\n\ndata: [DONE]\n\n"),
    ]);
    let runtime_root = unique_test_runtime_root("native-provider-openai-tool-call-loop");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::new(runtime_root.clone());
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-native-tool-loop".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-native-tool-loop".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: Some("local".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "return structured output natively".to_string(),
                raw_body: Some("return structured output natively".to_string()),
                message_id: Some("in-native-tool-loop".to_string()),
                thread_id: Some("thread-native-tool-loop".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "openai-compatible".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("native provider tool loop run");

    assert_eq!(result.assistant_text, "native final after tool");
    let events = serde_json::to_value(&result.events).expect("events json");
    let events = events.as_array().expect("events array");
    assert!(events.iter().any(|event| {
        event["type"] == "toolCall"
            && event["callId"] == "call_native_structured"
            && event["toolName"] == "StructuredOutput"
            && event["arguments"] == json!({ "ok": true })
    }));
    assert!(events.iter().any(|event| {
        event["type"] == "toolProgress"
            && event["callId"] == "call_native_structured"
            && event["status"] == "completed"
    }));

    let first_request = request_rx.recv().expect("first provider request");
    let second_request = request_rx.recv().expect("second provider request");
    assert!(first_request.contains("StructuredOutput"));
    let second_body: Value =
        serde_json::from_str(http_request_body(&second_request)).expect("second request body");
    let messages = second_body["messages"]
        .as_array()
        .expect("second request messages");
    assert!(messages.iter().any(|message| {
        message["role"] == "assistant"
            && message["tool_calls"][0]["id"] == "call_native_structured"
            && message["tool_calls"][0]["function"]["name"] == "StructuredOutput"
    }));
    assert!(messages.iter().any(|message| {
        message["role"] == "tool"
            && message["tool_call_id"] == "call_native_structured"
            && message["content"]
                .as_str()
                .is_some_and(|content| content.contains("Structured output provided successfully"))
    }));

    let transcript = fs::read_to_string(
        runtime_root
            .join("sessions")
            .join("thread-native-tool-loop.jsonl"),
    )
    .expect("transcript");
    assert!(transcript.contains(r#""type":"toolUse""#));
    assert!(transcript.contains(r#""type":"toolResult""#));
    assert!(transcript.contains("call_native_structured"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn native_provider_runtime_runs_read_only_tool_calls_in_parallel_batches() {
    let tool_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call_sleep_a",
                            "type": "function",
                            "function": {
                                "name": "Sleep",
                                "arguments": "{\"durationMs\":350}"
                            }
                        },
                        {
                            "index": 1,
                            "id": "call_sleep_b",
                            "type": "function",
                            "function": {
                                "name": "Sleep",
                                "arguments": "{\"durationMs\":350}"
                            }
                        }
                    ]
                }
            }
        ]
    }))
    .expect("tool stream chunk");
    let finish_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {},
                "finish_reason": "tool_calls"
            }
        ]
    }))
    .expect("finish stream chunk");
    let final_chunk = serde_json::to_string(&json!({
        "choices": [
            {
                "delta": {
                    "content": "native final after parallel tools"
                }
            }
        ]
    }))
    .expect("final stream chunk");
    let (provider_base_url, request_rx) = start_openai_compatible_stream_provider(vec![
        format!("data: {tool_chunk}\n\ndata: {finish_chunk}\n\ndata: [DONE]\n\n"),
        format!("data: {final_chunk}\n\ndata: [DONE]\n\n"),
    ]);
    let runtime_root = unique_test_runtime_root("native-provider-read-only-parallel-tools");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "openai-compatible",
            "baseUrl": provider_base_url,
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    record_tool_activation_state(&runtime_root, &["Sleep".to_string()])
        .expect("activate sleep tool");

    let runtime = AgentRuntime::new(runtime_root.clone());
    let started_at = std::time::Instant::now();
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-native-parallel-tools".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-native-parallel-tools".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: Some("local".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "wait twice in parallel".to_string(),
                raw_body: Some("wait twice in parallel".to_string()),
                message_id: Some("in-native-parallel-tools".to_string()),
                thread_id: Some("thread-native-parallel-tools".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "openai-compatible".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: vec!["Sleep".to_string()],
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("native provider parallel tool run");
    let elapsed = started_at.elapsed();

    assert_eq!(result.assistant_text, "native final after parallel tools");
    assert!(
        elapsed < std::time::Duration::from_millis(650),
        "read-only tool calls should overlap, elapsed: {elapsed:?}"
    );
    let events = serde_json::to_value(&result.events).expect("events json");
    let events = events.as_array().expect("events array");
    let call_sleep_a = events
        .iter()
        .position(|event| event["type"] == "toolCall" && event["callId"] == "call_sleep_a");
    let call_sleep_b = events
        .iter()
        .position(|event| event["type"] == "toolCall" && event["callId"] == "call_sleep_b");
    let done_sleep_a = events.iter().position(|event| {
        event["type"] == "toolProgress"
            && event["callId"] == "call_sleep_a"
            && event["status"] == "completed"
    });
    let done_sleep_b = events.iter().position(|event| {
        event["type"] == "toolProgress"
            && event["callId"] == "call_sleep_b"
            && event["status"] == "completed"
    });
    let call_sleep_a = call_sleep_a.expect("call_sleep_a start");
    let call_sleep_b = call_sleep_b.expect("call_sleep_b start");
    let done_sleep_a = done_sleep_a.expect("call_sleep_a completion");
    let done_sleep_b = done_sleep_b.expect("call_sleep_b completion");
    assert!(call_sleep_a < done_sleep_a);
    assert!(call_sleep_b < done_sleep_b);
    assert!(
        call_sleep_b < done_sleep_a,
        "second read-only tool should start before the first one completes"
    );

    let first_request = request_rx.recv().expect("first provider request");
    let second_request = request_rx.recv().expect("second provider request");
    assert!(first_request.contains("Sleep"));
    let second_body: Value =
        serde_json::from_str(http_request_body(&second_request)).expect("second request body");
    let messages = second_body["messages"]
        .as_array()
        .expect("second request messages");
    let tool_results = messages
        .iter()
        .filter(|message| message["role"] == "tool")
        .collect::<Vec<_>>();
    assert_eq!(tool_results.len(), 2, "second request body: {second_body}");

    let _ = fs::remove_dir_all(runtime_root);
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

    let registry = build_native_runtime_tool_registry(&runtime_root);
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
async fn agent_runtime_rejects_removed_pi_agent_runtime_mode() {
    let runtime_root = unique_test_runtime_root("removed-pi-agent-runtime-mode");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "pi-agent-rust",
            "provider": "test-provider",
            "model": "test-model"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root,
        Arc::new(FakeAgentRuntimeBackend {
            reply: "should not run".to_string(),
        }),
    );
    let error = runtime
        .send_message("thread-pi".to_string(), "second".to_string())
        .await
        .expect_err("removed PiAgent runtime mode should be rejected");

    assert!(error.message().contains("pi-agent-rust"));
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
        _runtime: DesktopAgentRuntimeMode::NativeProvider,
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
        _runtime: DesktopAgentRuntimeMode::NativeProvider,
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
        _runtime: DesktopAgentRuntimeMode::NativeProvider,
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
        _runtime: DesktopAgentRuntimeMode::NativeProvider,
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
    ) -> Pin<Box<dyn Future<Output = Result<AgentBackendResult, AgentRuntimeError>> + Send + 'a>>
    {
        Box::pin(async move {
            assert_eq!(request.provider_config.provider, "test-provider");
            assert_eq!(request.provider_config.model.as_deref(), Some("test-model"));
            assert_eq!(request.provider_config.api_key.as_deref(), Some("test-key"));
            assert!(request.history.is_empty());
            Ok(AgentBackendResult::text(self.reply.clone()))
        })
    }
}

#[derive(Clone, Debug)]
struct CapturedAgentRequest {
    user_text: String,
    provider: String,
    model: Option<String>,
    reasoning_level: Option<String>,
    system_sections: Vec<String>,
    messages: Vec<String>,
    messages_json: Value,
    included_tools: Vec<String>,
    deferred_tools: Vec<String>,
    surfaced_skills: Vec<String>,
    loaded_skills: Vec<String>,
    loaded_skill_contents: Vec<String>,
    memory_snippets: Vec<String>,
    profile_kind: String,
    parent_context_policy: String,
    permission_mode: Option<String>,
    activated_tools: Vec<String>,
}

#[test]
fn native_provider_backend_lives_in_dedicated_module() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let backend_source = fs::read_to_string(manifest_dir.join("src/agent_runtime_backend.rs"))
        .expect("runtime backend source");

    assert!(
        manifest_dir
            .join("src/agent_runtime_backend/native_provider.rs")
            .is_file(),
        "NativeProvider backend should live in a dedicated runtime module"
    );
    assert!(
        !backend_source.contains("impl AgentRuntimeBackend for NativeProviderRuntimeBackend"),
        "agent_runtime_backend.rs should not own the NativeProvider backend implementation"
    );
}

#[derive(Clone)]
struct CapturingAgentRuntimeBackend {
    reply: String,
    requests: Arc<std::sync::Mutex<Vec<CapturedAgentRequest>>>,
}

impl AgentRuntimeBackend for CapturingAgentRuntimeBackend {
    fn send_message<'a>(
        &'a self,
        request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentBackendResult, AgentRuntimeError>> + Send + 'a>>
    {
        Box::pin(async move {
            self.requests
                .lock()
                .expect("captured requests")
                .push(CapturedAgentRequest {
                    user_text: request.user_text.to_string(),
                    provider: request.provider_config.provider.clone(),
                    model: request.provider_config.model.clone(),
                    reasoning_level: request.reasoning_level.clone(),
                    system_sections: request.runtime_context.system_sections.clone(),
                    messages: request
                        .runtime_context
                        .messages
                        .iter()
                        .map(|message| message.content.clone())
                        .collect(),
                    messages_json: serde_json::to_value(&request.runtime_context.messages)
                        .expect("runtime messages json"),
                    included_tools: request
                        .runtime_context
                        .context_summary
                        .included_tools
                        .clone(),
                    deferred_tools: request
                        .runtime_context
                        .context_summary
                        .deferred_tools
                        .clone(),
                    surfaced_skills: request
                        .runtime_context
                        .context_summary
                        .surfaced_skills
                        .iter()
                        .map(|skill| skill.name.clone())
                        .collect(),
                    loaded_skills: request
                        .runtime_context
                        .context_summary
                        .loaded_skills
                        .clone(),
                    loaded_skill_contents: request.runtime_context.loaded_skill_contents.clone(),
                    memory_snippets: request
                        .runtime_context
                        .context_summary
                        .memory_snippets
                        .clone(),
                    profile_kind: request.runtime_context.context_summary.profile_kind.clone(),
                    parent_context_policy: request
                        .runtime_context
                        .context_summary
                        .parent_context_policy
                        .clone(),
                    permission_mode: request
                        .permission_policy
                        .as_ref()
                        .map(|policy| format!("{:?}", policy.mode)),
                    activated_tools: request
                        .runtime_context
                        .context_summary
                        .activated_tools
                        .clone(),
                });
            Ok(AgentBackendResult::text(self.reply.clone()))
        })
    }
}

#[derive(Clone)]
struct LoopEventAgentRuntimeBackend {
    reply: String,
    loop_events: Vec<AgentLoopEvent>,
}

impl AgentRuntimeBackend for LoopEventAgentRuntimeBackend {
    fn send_message<'a>(
        &'a self,
        _request: AgentRuntimeRequest<'a>,
    ) -> Pin<Box<dyn Future<Output = Result<AgentBackendResult, AgentRuntimeError>> + Send + 'a>>
    {
        Box::pin(async move {
            Ok(AgentBackendResult {
                assistant_text: self.reply.clone(),
                loop_events: self.loop_events.clone(),
            })
        })
    }
}

#[tokio::test]
async fn agent_runtime_builds_goal_scoped_context_before_provider_call() {
    let runtime_root = unique_test_runtime_root("agent-runtime-context-assembler");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    fs::create_dir_all(runtime_root.join("skills/imagegen")).expect("skill dir");
    fs::write(
        runtime_root.join("skills/imagegen/SKILL.md"),
        "---\nname: imagegen\ndescription: Generate bitmap images and visual assets.\n---\n# Image generation\n",
    )
    .expect("skill file");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "context reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-context".to_string(),
            "Generate an image of a robot".to_string(),
            AgentRuntimeSendOptions {
                model_selection: None,
                tool_selection: AgentRuntimeToolSelection::Default,
                permission_policy: None,
                system_prompt: Some("You are a focused desktop agent.".to_string()),
                tool_hook_policy: None,
            },
        )
        .await
        .expect("runtime result");

    assert_eq!(result.context_summary.included_tools[0], "tool_search");
    assert!(result
        .context_summary
        .included_tools
        .contains(&"discover_skills".to_string()));
    assert!(result
        .context_summary
        .included_tools
        .contains(&"load_skill".to_string()));
    assert!(result
        .context_summary
        .deferred_tools
        .contains(&"image".to_string()));
    assert!(!result
        .context_summary
        .included_tools
        .contains(&"image".to_string()));
    assert!(result
        .context_summary
        .surfaced_skills
        .iter()
        .any(|skill| skill.name == "imagegen"));

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.user_text, "Generate an image of a robot");
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("focused desktop agent")));
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("CrawClaw Rust agent kernel")));
    assert_eq!(
        request.included_tools,
        result.context_summary.included_tools
    );
    assert!(request.activated_tools.is_empty());
    assert_eq!(
        request.deferred_tools,
        result.context_summary.deferred_tools
    );
    assert!(request
        .surfaced_skills
        .iter()
        .any(|skill| skill == "imagegen"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_projects_large_tool_results_before_provider_context() {
    let runtime_root = unique_test_runtime_root("agent-context-tool-result-projection");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    fs::create_dir_all(runtime_root.join("sessions")).expect("sessions dir");

    let huge_output = format!("{}tail-marker", "large-tool-output ".repeat(900));
    let assistant_message = AgentRuntimeMessage {
        role: AgentRuntimeMessageRole::Assistant,
        content: "Tool calls: read_file".to_string(),
        blocks: vec![AgentRuntimeMessageBlock::ToolUse {
            id: "tool-1".to_string(),
            name: "read_file".to_string(),
            input: json!({ "path": "demo.txt" }),
        }],
    };
    let tool_result_message = AgentRuntimeMessage {
        role: AgentRuntimeMessageRole::User,
        content: format!("read_file: {huge_output}"),
        blocks: vec![AgentRuntimeMessageBlock::ToolResult {
            tool_use_id: "tool-1".to_string(),
            content: huge_output.clone(),
            is_error: false,
        }],
    };
    fs::write(
        runtime_root.join("sessions/thread-tool-projection.jsonl"),
        [
            serde_json::to_string(&json!({
                "role": "assistant",
                "content": "Tool calls: read_file",
                "modelMessage": assistant_message
            }))
            .expect("assistant history json"),
            serde_json::to_string(&json!({
                "role": "user",
                "content": format!("read_file: {huge_output}"),
                "modelMessage": tool_result_message
            }))
            .expect("tool result history json"),
        ]
        .join("\n"),
    )
    .expect("seed transcript");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "projection reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-tool-projection".to_string(),
            "continue after tool output".to_string(),
            AgentRuntimeSendOptions::default(),
        )
        .await
        .expect("send with projected tool result");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    let projected_tool_result = request
        .messages
        .iter()
        .find(|message| message.contains("projected for context budget"))
        .expect("tool result message");
    assert!(!projected_tool_result.contains("tail-marker"));

    let summary_json = serde_json::to_value(&result.context_summary).expect("summary json");
    assert_eq!(
        summary_json["deferredToolCount"],
        json!(result.context_summary.deferred_tools.len())
    );
    assert_eq!(summary_json["loadedSkillCount"], json!(0));
    assert_eq!(summary_json["memorySnippetCount"], json!(0));
    assert_eq!(summary_json["compactSummaryApplied"], json!(false));
    assert!(
        summary_json["projection"]["projectedHistoryEstimatedTokens"]
            .as_u64()
            .unwrap_or_default()
            > 0
    );
    assert_eq!(
        summary_json["projection"]["projectedToolResultCount"],
        json!(1)
    );
    assert_eq!(
        summary_json["projection"]["toolResultProjectionApplied"],
        json!(true)
    );
    assert_eq!(
        summary_json["projection"]["capabilityProjectionApplied"],
        json!(false)
    );
    assert!(
        summary_json["projection"]["projectedToolResultOmittedChars"]
            .as_u64()
            .unwrap_or_default()
            > 0
    );
    assert!(summary_json["projection"]["reason"]
        .as_str()
        .unwrap_or_default()
        .contains("tool result"));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_uses_selected_model_context_window_for_prompt_budget() {
    let runtime_root = unique_test_runtime_root("agent-context-selected-model-budget");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "configured-model",
            "apiKey": "test-key"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    fs::write(
        config_dir.join("crawclaw.json"),
        serde_json::to_vec_pretty(&json!({
            "agents": {
                "defaults": {
                    "contextTokens": 128000,
                    "compaction": {
                        "reserveTokens": 512
                    }
                }
            },
            "models": {
                "providers": {
                    "test-provider": {
                        "models": [
                            {
                                "id": "configured-model",
                                "name": "Configured Model",
                                "reasoning": false,
                                "input": ["text"],
                                "cost": {
                                    "input": 0,
                                    "output": 0,
                                    "cacheRead": 0,
                                    "cacheWrite": 0
                                },
                                "contextWindow": 64000,
                                "maxTokens": 4096
                            },
                            {
                                "id": "tiny-model",
                                "name": "Tiny Model",
                                "reasoning": false,
                                "input": ["text"],
                                "cost": {
                                    "input": 0,
                                    "output": 0,
                                    "cacheRead": 0,
                                    "cacheWrite": 0
                                },
                                "contextWindow": 8192,
                                "maxTokens": 512
                            }
                        ]
                    }
                }
            }
        }))
        .expect("runtime config json"),
    )
    .expect("write runtime config");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "tiny budget reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-selected-budget".to_string(),
            "use the selected model budget".to_string(),
            AgentRuntimeSendOptions {
                model_selection: Some(AgentModelSelection {
                    provider: "test-provider".to_string(),
                    model: "tiny-model".to_string(),
                    reasoning_level: None,
                }),
                ..AgentRuntimeSendOptions::default()
            },
        )
        .await
        .expect("send with selected model budget");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.provider, "test-provider");
    assert_eq!(request.model.as_deref(), Some("tiny-model"));

    let summary_json = serde_json::to_value(&result.context_summary).expect("summary json");
    assert_eq!(summary_json["budget"]["modelContextWindow"], json!(8192));
    assert_eq!(summary_json["budget"]["outputReserveTokens"], json!(512));
    assert_eq!(
        summary_json["budget"]["budgetSource"],
        json!("config-model")
    );
    assert!(
        summary_json["budget"]["maxPromptTokens"]
            .as_u64()
            .unwrap_or_default()
            < 8192
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_allows_large_model_window_without_default_cap() {
    let runtime_root = unique_test_runtime_root("agent-context-large-model-budget");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "large-model",
            "apiKey": "test-key"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    fs::write(
        config_dir.join("crawclaw.json"),
        serde_json::to_vec_pretty(&json!({
            "agents": {
                "defaults": {
                    "compaction": {
                        "reserveTokens": 2048
                    }
                }
            },
            "models": {
                "providers": {
                    "test-provider": {
                        "models": [
                            {
                                "id": "large-model",
                                "name": "Large Model",
                                "reasoning": true,
                                "input": ["text"],
                                "cost": {
                                    "input": 0,
                                    "output": 0,
                                    "cacheRead": 0,
                                    "cacheWrite": 0
                                },
                                "contextWindow": 200000,
                                "maxTokens": 8192
                            }
                        ]
                    }
                }
            }
        }))
        .expect("runtime config json"),
    )
    .expect("write runtime config");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "large budget reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-large-budget".to_string(),
            "use the large model budget".to_string(),
            AgentRuntimeSendOptions::default(),
        )
        .await
        .expect("send with large model budget");

    let summary_json = serde_json::to_value(&result.context_summary).expect("summary json");
    assert_eq!(summary_json["budget"]["modelContextWindow"], json!(200000));
    assert_eq!(
        summary_json["budget"]["budgetSource"],
        json!("config-model")
    );
    assert!(
        summary_json["budget"]["maxPromptTokens"]
            .as_u64()
            .unwrap_or_default()
            > 128000
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_downgrades_context_for_model_capabilities() {
    let runtime_root = unique_test_runtime_root("agent-context-capability-downgrade");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "text-only-model",
            "apiKey": "test-key"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    fs::write(
        config_dir.join("crawclaw.json"),
        serde_json::to_vec_pretty(&json!({
            "agents": {
                "defaults": {
                    "compaction": {
                        "reserveTokens": 512
                    }
                }
            },
            "models": {
                "providers": {
                    "test-provider": {
                        "models": [
                            {
                                "id": "text-only-model",
                                "name": "Text Only Model",
                                "reasoning": false,
                                "input": ["text"],
                                "compat": {
                                    "supportsTools": false,
                                    "supportsReasoningEffort": false,
                                    "supportsStreaming": false
                                },
                                "cost": {
                                    "input": 0,
                                    "output": 0,
                                    "cacheRead": 0,
                                    "cacheWrite": 0
                                },
                                "contextWindow": 64000,
                                "maxTokens": 4096
                            }
                        ]
                    }
                }
            }
        }))
        .expect("runtime config json"),
    )
    .expect("write runtime config");
    fs::create_dir_all(runtime_root.join("sessions")).expect("sessions dir");
    let image_message = AgentRuntimeMessage {
        role: AgentRuntimeMessageRole::User,
        content: "uploaded image".to_string(),
        blocks: vec![AgentRuntimeMessageBlock::Image {
            mime_type: "image/png".to_string(),
            data: "iVBORw0KGgo=".to_string(),
        }],
    };
    fs::write(
        runtime_root.join("sessions/thread-capability-downgrade.jsonl"),
        serde_json::to_string(&json!({
            "role": "user",
            "content": "uploaded image",
            "modelMessage": image_message
        }))
        .expect("image transcript json"),
    )
    .expect("seed image transcript");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "capability reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-capability-downgrade".to_string(),
            "continue with model capabilities".to_string(),
            AgentRuntimeSendOptions {
                model_selection: Some(AgentModelSelection {
                    provider: "test-provider".to_string(),
                    model: "text-only-model".to_string(),
                    reasoning_level: Some("high".to_string()),
                }),
                ..AgentRuntimeSendOptions::default()
            },
        )
        .await
        .expect("send with model capability downgrade");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.reasoning_level, None);
    assert!(request.included_tools.is_empty());
    assert!(!request.deferred_tools.is_empty());
    let messages_json = serde_json::to_string(&request.messages_json).expect("messages json");
    assert!(!messages_json.contains("iVBORw0KGgo="));
    assert!(messages_json.contains("Image input omitted"));

    let summary_json = serde_json::to_value(&result.context_summary).expect("summary json");
    assert_eq!(summary_json["budget"]["supportsTools"], json!(false));
    assert_eq!(summary_json["budget"]["supportsReasoning"], json!(false));
    assert_eq!(summary_json["budget"]["supportsImageInput"], json!(false));
    assert_eq!(summary_json["budget"]["supportsStreaming"], json!(false));
    assert_eq!(
        summary_json["projection"]["capabilityProjectionApplied"],
        json!(true)
    );
    assert_eq!(
        summary_json["projection"]["toolResultProjectionApplied"],
        json!(false)
    );
    assert!(result
        .context_summary
        .warnings
        .iter()
        .any(|warning| warning.contains("does not support tool calling")));
    assert!(result
        .context_summary
        .warnings
        .iter()
        .any(|warning| warning.contains("does not support reasoning")));
    assert!(result
        .context_summary
        .warnings
        .iter()
        .any(|warning| warning.contains("does not support image input")));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_persists_oversized_tool_results_for_recovery() {
    let runtime_root = unique_test_runtime_root("agent-context-tool-result-persist");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    fs::create_dir_all(runtime_root.join("sessions")).expect("sessions dir");

    let huge_output = format!("{}persist-tail-marker", "huge-tool-output ".repeat(8000));
    let assistant_message = AgentRuntimeMessage {
        role: AgentRuntimeMessageRole::Assistant,
        content: "Tool calls: read_file".to_string(),
        blocks: vec![AgentRuntimeMessageBlock::ToolUse {
            id: "tool-1".to_string(),
            name: "read_file".to_string(),
            input: json!({ "path": "demo.txt" }),
        }],
    };
    let tool_result_message = AgentRuntimeMessage {
        role: AgentRuntimeMessageRole::User,
        content: format!("read_file: {huge_output}"),
        blocks: vec![AgentRuntimeMessageBlock::ToolResult {
            tool_use_id: "tool-1".to_string(),
            content: huge_output.clone(),
            is_error: false,
        }],
    };
    fs::write(
        runtime_root.join("sessions/thread-tool-persist.jsonl"),
        [
            serde_json::to_string(&json!({
                "role": "assistant",
                "content": "Tool calls: read_file",
                "modelMessage": assistant_message
            }))
            .expect("assistant history json"),
            serde_json::to_string(&json!({
                "role": "user",
                "content": format!("read_file: {huge_output}"),
                "modelMessage": tool_result_message
            }))
            .expect("tool result history json"),
        ]
        .join("\n"),
    )
    .expect("seed transcript");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "persist reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-tool-persist".to_string(),
            "continue after persisted output".to_string(),
            AgentRuntimeSendOptions::default(),
        )
        .await
        .expect("send with persisted tool result");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    let projected_tool_result = request
        .messages
        .iter()
        .find(|message| message.contains("Full output saved to:"))
        .expect("persisted tool result message");
    assert!(!projected_tool_result.contains("persist-tail-marker"));
    let persisted_path = runtime_root
        .join("sessions")
        .join("tool-results")
        .join("thread-tool-persist")
        .join("tool-1.txt");
    assert_eq!(
        fs::read_to_string(&persisted_path).expect("persisted tool output"),
        huge_output
    );

    let summary_json = serde_json::to_value(&result.context_summary).expect("summary json");
    assert_eq!(
        summary_json["projection"]["persistedToolResultCount"],
        json!(1)
    );
    assert_eq!(
        summary_json["projection"]["toolResultProjectionApplied"],
        json!(true)
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_context_ignores_transcript_tool_activation_json() {
    let runtime_root = unique_test_runtime_root("agent-context-no-transcript-tool-activation");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    fs::create_dir_all(runtime_root.join("sessions")).expect("sessions dir");
    fs::write(
        runtime_root.join("sessions/thread-activation.jsonl"),
        r#"{"role":"assistant","content":"{\"activatedTools\":[\"image\"],\"matches\":[{\"name\":\"pdf\"}]}"}"#,
    )
    .expect("seed transcript");

    let runtime = AgentRuntime::new(runtime_root.clone());
    let summary = runtime
        .preview_message_context(
            "thread-activation",
            "continue",
            &AgentRuntimeSendOptions::default(),
        )
        .expect("context preview");

    assert_eq!(summary.activated_tools, Vec::<String>::new());
    assert!(!summary.included_tools.contains(&"image".to_string()));
    assert!(!summary.included_tools.contains(&"pdf".to_string()));
    assert!(summary.deferred_tools.contains(&"image".to_string()));
    assert!(summary.deferred_tools.contains(&"pdf".to_string()));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn tool_search_activation_is_runtime_state_for_next_context() {
    let runtime_root = unique_test_runtime_root("agent-context-tool-search-activation");
    let output = execute_rust_core_tool(
        &runtime_root,
        "tool_search",
        json!({
            "query": "select:image",
            "max_results": 1
        }),
    )
    .await
    .expect("tool search");
    assert_eq!(
        output["details"]["activationScope"],
        "next-provider-request"
    );
    assert!(output["details"]["activatedTools"]
        .as_array()
        .expect("activated tools")
        .iter()
        .any(|tool| tool == "image"));

    let runtime = AgentRuntime::new(runtime_root.clone());
    let summary = runtime
        .preview_message_context(
            "thread-tool-state",
            "describe the image",
            &AgentRuntimeSendOptions::default(),
        )
        .expect("context preview");

    assert!(summary.activated_tools.contains(&"image".to_string()));
    assert!(summary.included_tools.contains(&"image".to_string()));
    assert!(!summary.deferred_tools.contains(&"image".to_string()));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn loaded_skill_state_enters_next_provider_context() {
    let runtime_root = unique_test_runtime_root("agent-context-loaded-skill");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    fs::create_dir_all(runtime_root.join("skills/demo")).expect("skill dir");
    fs::write(
        runtime_root.join("skills/demo/SKILL.md"),
        "---\nname: demo\ndescription: Demo helper instructions.\n---\n# Demo\n\nUse the demo workflow.\n",
    )
    .expect("skill file");

    execute_rust_core_tool(&runtime_root, "load_skill", json!({ "skill": "demo" }))
        .await
        .expect("load skill");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "skill reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-loaded-skill".to_string(),
            "Use the demo helper".to_string(),
            AgentRuntimeSendOptions::default(),
        )
        .await
        .expect("send with loaded skill");

    assert_eq!(
        result.context_summary.loaded_skills,
        vec!["demo".to_string()]
    );
    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.loaded_skills, vec!["demo".to_string()]);
    assert!(request
        .loaded_skill_contents
        .iter()
        .any(|content| content.contains("# Demo")));
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("Loaded skill instructions")
            && section.contains("Use the demo workflow")));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_special_profile_applies_definition_prompt_and_tool_policy() {
    let runtime_root = unique_test_runtime_root("agent-special-profile");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "summary reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-special-summary".to_string(),
            agent_id: "session-summary".to_string(),
            session_key: "thread-special-summary".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "memory".to_string(),
                account_id: Some("rust-runtime".to_string()),
                from: "memory.compact".to_string(),
                to: "agent:session-summary".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "summarize this transcript".to_string(),
                raw_body: Some("summarize this transcript".to_string()),
                message_id: Some("run-special-summary:input".to_string()),
                thread_id: Some("thread-special-summary".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Compaction,
                special_agent: Some("session-summary".to_string()),
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("special profile turn");

    assert_eq!(result.assistant_text, "summary reply");
    assert!(!serde_json::to_value(&result.events)
        .expect("events json")
        .as_array()
        .expect("events array")
        .iter()
        .any(|event| event["toolName"] == "memory.afterTurn"));
    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.profile_kind, "compaction");
    assert_eq!(request.parent_context_policy, "full_envelope");
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("Session summary special agent")));
    assert!(request
        .included_tools
        .contains(&"session_summary_file_read".to_string()));
    assert!(!request.included_tools.contains(&"image".to_string()));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_run_turn_exposes_loop_projection_contract() {
    let runtime_root = unique_test_runtime_root("agent-loop-projection-contract");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "loop reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-loop-contract".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-loop-contract".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: Some("local".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "hello loop".to_string(),
                raw_body: Some("hello loop".to_string()),
                message_id: Some("in-loop".to_string()),
                thread_id: Some("thread-loop-contract".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("loop run");

    assert_eq!(result.context_summary.profile_kind, "normal");
    assert_eq!(
        result.context_summary.projection.projected_message_count,
        result.context_summary.message_count
    );
    assert_eq!(
        result.context_summary.budget.estimated_tokens,
        result.context_summary.estimated_tokens
    );
    assert_eq!(
        result.context_summary.agent_definition.as_deref(),
        Some("main")
    );

    let events = serde_json::to_value(&result.events).expect("events json");
    let events = events.as_array().expect("events array");
    assert!(events.iter().any(|event| {
        event["type"] == "contextProjected"
            && event["projection"]["profileKind"] == "normal"
            && event["projection"]["projectedMessageCount"]
                == json!(result.context_summary.message_count)
    }));
    assert!(events.iter().any(|event| {
        event["type"] == "providerBlock"
            && event["blockType"] == "text"
            && event["text"] == "loop reply"
    }));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_run_turn_surfaces_backend_tool_loop_events() {
    let runtime_root = unique_test_runtime_root("agent-loop-backend-events");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(LoopEventAgentRuntimeBackend {
            reply: "loop done".to_string(),
            loop_events: vec![
                AgentLoopEvent::ProviderBlock {
                    block_type: "text_delta".to_string(),
                    text: Some("loop ".to_string()),
                    metadata: json!({ "source": "test-backend" }),
                },
                AgentLoopEvent::ToolExecution {
                    event: ToolExecutionEvent::Started {
                        call_id: "tool-call-1".to_string(),
                        tool_name: "read".to_string(),
                        arguments: json!({ "path": "Cargo.toml" }),
                    },
                },
                AgentLoopEvent::ToolExecution {
                    event: ToolExecutionEvent::Progress {
                        call_id: "tool-call-1".to_string(),
                        tool_name: "read".to_string(),
                        status: "running".to_string(),
                        message: Some("reading".to_string()),
                    },
                },
                AgentLoopEvent::ToolExecution {
                    event: ToolExecutionEvent::Completed {
                        call_id: "tool-call-1".to_string(),
                        tool_name: "read".to_string(),
                        output: Some("read complete".to_string()),
                        is_error: false,
                    },
                },
            ],
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-loop-backend-events".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-loop-backend-events".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "gateway".to_string(),
                account_id: Some("local".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "use a tool".to_string(),
                raw_body: Some("use a tool".to_string()),
                message_id: Some("in-loop-tool".to_string()),
                thread_id: Some("thread-loop-backend-events".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Normal,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("loop backend event run");

    let events = serde_json::to_value(&result.events).expect("events json");
    let events = events.as_array().expect("events array");
    assert!(events.iter().any(|event| {
        event["type"] == "providerBlock"
            && event["blockType"] == "text_delta"
            && event["text"] == "loop "
    }));
    assert!(events.iter().any(|event| {
        event["type"] == "toolCall"
            && event["callId"] == "tool-call-1"
            && event["toolName"] == "read"
            && event["arguments"]["path"] == "Cargo.toml"
    }));
    assert!(events.iter().any(|event| {
        event["type"] == "toolProgress"
            && event["callId"] == "tool-call-1"
            && event["status"] == "running"
    }));
    assert!(events.iter().any(|event| {
        event["type"] == "toolProgress"
            && event["callId"] == "tool-call-1"
            && event["status"] == "completed"
    }));
    let loop_delta = events
        .iter()
        .position(|event| {
            event["type"] == "providerBlock"
                && event["blockType"] == "text_delta"
                && event["text"] == "loop "
        })
        .expect("loop delta event");
    let tool_call = events
        .iter()
        .position(|event| event["type"] == "toolCall" && event["callId"] == "tool-call-1")
        .expect("tool call event");
    let tool_completed = events
        .iter()
        .position(|event| {
            event["type"] == "toolProgress"
                && event["callId"] == "tool-call-1"
                && event["status"] == "completed"
        })
        .expect("tool completed event");
    let final_text = events
        .iter()
        .position(|event| {
            event["type"] == "providerBlock"
                && event["blockType"] == "text"
                && event["text"] == "loop done"
        })
        .expect("final provider text event");
    assert!(loop_delta < tool_call);
    assert!(tool_call < tool_completed);
    assert!(
        tool_completed < final_text,
        "final assistant text should follow tool loop events"
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_context_includes_compacted_summary_for_thread() {
    let runtime_root = unique_test_runtime_root("agent-context-compaction-summary");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    crate::memory::SessionSummaryStore::new(runtime_root.clone())
        .refresh("thread:compacted", "Older context was compacted here.")
        .expect("summary file");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "summary context reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread:compacted".to_string(),
            "continue after compaction".to_string(),
            AgentRuntimeSendOptions::default(),
        )
        .await
        .expect("send with compacted summary");

    assert!(result.context_summary.compaction.active);
    assert!(result.context_summary.projection.history_compaction_applied);
    assert!(
        !result
            .context_summary
            .projection
            .overflow_projection_applied
    );
    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("Older context was compacted here")));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_btw_profile_disables_memory_recall() {
    let runtime_root = unique_test_runtime_root("agent-context-btw-memory-disabled");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    fs::create_dir_all(runtime_root.join("memory")).expect("memory dir");
    fs::write(
        runtime_root.join("memory/desktop-items.json"),
        serde_json::to_vec_pretty(&json!([
            {
                "id": "memory-one",
                "agentId": "main",
                "title": "Zebra preference",
                "summary": "The user prefers zebra colored dashboards.",
                "content": "Remember zebra preference for future UI work.",
                "category": "preference",
                "tags": ["zebra"],
                "source": "test",
                "updatedAt": "now",
                "archived": false
            }
        ]))
        .expect("memory json"),
    )
    .expect("write memory");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "btw reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    runtime
        .run_turn(AgentRunRequest {
            run_id: "run-btw-memory".to_string(),
            agent_id: "main".to_string(),
            session_key: "thread-btw-memory".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "chat".to_string(),
                account_id: Some("desktop".to_string()),
                from: "user".to_string(),
                to: "agent:main".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "what about zebra preference?".to_string(),
                raw_body: None,
                message_id: Some("run-btw-memory:input".to_string()),
                thread_id: Some("thread-btw-memory".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
                reasoning_level: None,
            },
            enabled_tools: Vec::new(),
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Btw,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::new(),
        })
        .await
        .expect("btw run");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.profile_kind, "btw");
    assert!(request.memory_snippets.is_empty());

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_compaction_summary_replaces_old_history() {
    let runtime_root = unique_test_runtime_root("agent-context-compaction-replaces-history");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    fs::create_dir_all(runtime_root.join("sessions")).expect("sessions dir");
    fs::write(
        runtime_root.join("sessions/thread-compacted-replaced.jsonl"),
        [
            r#"{"role":"user","content":"old transcript detail that must be summarized away"}"#,
            r#"{"role":"assistant","content":"old assistant detail that must be summarized away"}"#,
        ]
        .join("\n"),
    )
    .expect("seed transcript");
    fs::create_dir_all(runtime_root.join("memory/session-summary")).expect("summary dir");
    fs::write(
        runtime_root.join("memory/session-summary/thread-compacted-replaced.md"),
        "# Session summary\n\nOld transcript was summarized.\n",
    )
    .expect("summary file");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "compacted reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    runtime
        .send_message_with_options(
            "thread-compacted-replaced".to_string(),
            "continue now".to_string(),
            AgentRuntimeSendOptions::default(),
        )
        .await
        .expect("send compacted");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.messages, vec!["continue now".to_string()]);
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("Old transcript was summarized")));
    assert!(!request
        .messages
        .iter()
        .any(|message| message.contains("summarized away")));

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_overflow_projection_adds_summary_and_tail() {
    let runtime_root = unique_test_runtime_root("agent-context-overflow-summary-tail");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "small-context-model",
            "apiKey": "test-key"
        }))
        .expect("provider config json"),
    )
    .expect("write provider config");
    fs::write(
        config_dir.join("crawclaw.json"),
        serde_json::to_vec_pretty(&json!({
            "agents": {
                "defaults": {
                    "compaction": {
                        "reserveTokens": 512
                    }
                }
            },
            "models": {
                "providers": {
                    "test-provider": {
                        "models": [
                            {
                                "id": "small-context-model",
                                "name": "Small Context Model",
                                "reasoning": false,
                                "input": ["text"],
                                "cost": {
                                    "input": 0,
                                    "output": 0,
                                    "cacheRead": 0,
                                    "cacheWrite": 0
                                },
                                "contextWindow": 12000,
                                "maxTokens": 512
                            }
                        ]
                    }
                }
            }
        }))
        .expect("runtime config json"),
    )
    .expect("write runtime config");
    fs::create_dir_all(runtime_root.join("sessions")).expect("sessions dir");
    let history = (0..28)
        .map(|index| {
            let role = if index % 2 == 0 { "user" } else { "assistant" };
            serde_json::to_string(&json!({
                "role": role,
                "content": format!(
                    "ancient-summary-marker-{index} {}",
                    "overflow history detail ".repeat(120)
                )
            }))
            .expect("history line")
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(
        runtime_root.join("sessions/thread-overflow-summary-tail.jsonl"),
        history,
    )
    .expect("seed transcript");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "overflow reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-overflow-summary-tail".to_string(),
            "keep the useful tail".to_string(),
            AgentRuntimeSendOptions {
                tool_selection: AgentRuntimeToolSelection::Disabled,
                ..AgentRuntimeSendOptions::default()
            },
        )
        .await
        .expect("send with overflow projection");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("Earlier conversation omitted for context budget")));
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("ancient-summary-marker-0")));
    assert!(request
        .messages
        .iter()
        .any(|message| message.contains("keep the useful tail")));
    assert!(!request
        .messages
        .iter()
        .any(|message| message.contains("ancient-summary-marker-0")));

    let summary_json = serde_json::to_value(&result.context_summary).expect("summary json");
    assert_eq!(
        summary_json["projection"]["collapseState"],
        json!("summary-plus-overflow-tail")
    );
    assert_eq!(
        summary_json["projection"]["overflowProjectionApplied"],
        json!(true)
    );
    assert_eq!(
        summary_json["projection"]["historyCompactionApplied"],
        json!(false)
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn agent_runtime_compaction_tail_keeps_tool_pairs() {
    let runtime_root = unique_test_runtime_root("agent-context-compaction-safe-tail");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    fs::create_dir_all(runtime_root.join("sessions")).expect("sessions dir");
    fs::write(
        runtime_root.join("sessions/thread-compacted-safe-tail.jsonl"),
        [
            r#"{"role":"user","content":"old user context"}"#,
            r#"{"role":"assistant","content":"old assistant context"}"#,
            r#"{"role":"assistant","content":"tool call content","modelMessage":{"role":"assistant","content":"tool call content","blocks":[{"type":"toolUse","id":"tool-1","name":"read","input":{"path":"demo.txt"}}]}}"#,
            r#"{"role":"user","content":"tool result content","modelMessage":{"role":"user","content":"tool result content","blocks":[{"type":"toolResult","tool_use_id":"tool-1","content":"demo result","is_error":false}]}}"#,
            r#"{"role":"assistant","content":"recent tail content"}"#,
        ]
        .join("\n"),
    )
    .expect("seed transcript");
    fs::create_dir_all(runtime_root.join("memory/session-summary")).expect("summary dir");
    fs::write(
        runtime_root.join("memory/session-summary/thread-compacted-safe-tail.md"),
        "# Session summary\n\nEarlier messages were summarized.\n",
    )
    .expect("summary file");
    fs::write(
        runtime_root.join("memory/session-summary/thread-compacted-safe-tail.state.json"),
        serde_json::to_vec_pretty(&json!({
            "compactedThroughMessageId": "msg-old-assistant",
            "firstKeptMessageId": "msg-tool-result",
            "tailStartMessageId": "msg-tool-result",
            "tailStartMessageIndex": 3
        }))
        .expect("state json"),
    )
    .expect("state file");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "safe tail reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .send_message_with_options(
            "thread-compacted-safe-tail".to_string(),
            "continue safe tail".to_string(),
            AgentRuntimeSendOptions::default(),
        )
        .await
        .expect("send compacted safe tail");

    assert_eq!(
        result
            .context_summary
            .compaction
            .compacted_through
            .as_deref(),
        Some("msg-old-assistant")
    );
    assert_eq!(
        result
            .context_summary
            .compaction
            .first_kept_message_id
            .as_deref(),
        Some("msg-tool-result")
    );
    assert_eq!(
        result
            .context_summary
            .compaction
            .tail_start_message_id
            .as_deref(),
        Some("msg-tool-result")
    );
    assert_eq!(result.context_summary.compaction.retained_message_count, 3);
    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(
        request.messages,
        vec![
            "tool call content".to_string(),
            "tool result content".to_string(),
            "recent tail content".to_string(),
            "continue safe tail".to_string()
        ]
    );
    assert!(!request
        .messages
        .iter()
        .any(|message| message.contains("old user context")));

    let _ = fs::remove_dir_all(runtime_root);
}

#[test]
fn desktop_session_spawn_creates_child_without_visible_task_history() {
    let runtime_root = unique_test_runtime_root("desktop-session-spawn-empty-history");
    let store = DesktopSessionStore::new(runtime_root.clone());
    let session = store
        .spawn_session(Some("parent-thread"), Some("worker"), "do child work")
        .expect("spawn child");

    assert_eq!(session.status, "spawned");
    assert_eq!(session.spawned_by.as_deref(), Some("parent-thread"));
    assert_eq!(session.message_count, 0);
    assert!(store
        .session_history(&session.key)
        .expect("child history")
        .is_empty());

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn subagent_type_explore_uses_builtin_definition_and_read_only_policy() {
    let runtime_root = unique_test_runtime_root("subagent-explore-definition");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "explore result".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-explore-subagent".to_string(),
            agent_id: "Explore".to_string(),
            session_key: "explore-thread".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "subagent".to_string(),
                account_id: Some("rust-runtime".to_string()),
                from: "main".to_string(),
                to: "agent:subagent".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "inspect the runtime".to_string(),
                raw_body: None,
                message_id: Some("run-explore-subagent:input".to_string()),
                thread_id: Some("explore-thread".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::from([("agentType".to_string(), json!("Explore"))]),
            },
            model: AgentModelSelection {
                provider: "configured".to_string(),
                model: "inherit".to_string(),
                reasoning_level: None,
            },
            enabled_tools: vec!["write".to_string(), "read".to_string()],
            profile: Some(AgentRunProfileRequest {
                kind: AgentRunProfileKind::Subagent,
                special_agent: None,
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::from([("subagent_type".to_string(), json!("Explore"))]),
        })
        .await
        .expect("Explore subagent run");

    assert_eq!(
        result.context_summary.agent_definition.as_deref(),
        Some("Explore")
    );
    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.permission_mode.as_deref(), Some("ReadOnly"));
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("Explore agent")));
    assert!(request.included_tools.contains(&"read".to_string()));
    assert!(request.included_tools.contains(&"grep".to_string()));
    for blocked in [
        "write",
        "edit",
        "NotebookEdit",
        "Agent",
        "ExitPlanMode",
        "bash",
    ] {
        assert!(
            !request.included_tools.contains(&blocked.to_string()),
            "Explore should not include {blocked}"
        );
    }

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn subagent_type_verification_uses_verdict_prompt_and_read_only_policy() {
    let runtime_root = unique_test_runtime_root("subagent-verification-definition");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "VERDICT: PASS".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    let result = runtime
        .run_turn(AgentRunRequest {
            run_id: "run-verification-subagent".to_string(),
            agent_id: "verification".to_string(),
            session_key: "verification-thread".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "subagent".to_string(),
                account_id: Some("rust-runtime".to_string()),
                from: "main".to_string(),
                to: "agent:subagent".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "verify the patch".to_string(),
                raw_body: None,
                message_id: Some("run-verification-subagent:input".to_string()),
                thread_id: Some("verification-thread".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::from([("agentType".to_string(), json!("verification"))]),
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
                memory_after_turn: Some(false),
            }),
            options: BTreeMap::from([("subagent_type".to_string(), json!("verification"))]),
        })
        .await
        .expect("verification subagent run");

    assert_eq!(
        result.context_summary.agent_definition.as_deref(),
        Some("verification")
    );
    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.permission_mode.as_deref(), Some("ReadOnly"));
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("VERDICT")));
    assert!(request.included_tools.contains(&"read".to_string()));
    for blocked in ["write", "edit", "NotebookEdit", "Agent", "ExitPlanMode"] {
        assert!(
            !request.included_tools.contains(&blocked.to_string()),
            "verification should not include {blocked}"
        );
    }

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn subagent_profile_injects_parent_context_messages() {
    let runtime_root = unique_test_runtime_root("subagent-parent-context");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    let store = DesktopSessionStore::new(runtime_root.clone());
    store
        .append_model_message(
            "parent-thread",
            "user",
            "parent context detail",
            Some("agent"),
            AgentRuntimeMessage::text(AgentRuntimeMessageRole::User, "parent context detail"),
        )
        .expect("parent user");
    store
        .append_model_message(
            "parent-thread",
            "assistant",
            "parent assistant detail",
            Some("agent"),
            AgentRuntimeMessage::text(
                AgentRuntimeMessageRole::Assistant,
                "parent assistant detail",
            ),
        )
        .expect("parent assistant");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "child reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    runtime
        .run_turn(AgentRunRequest {
            run_id: "run-subagent-parent".to_string(),
            agent_id: "subagent".to_string(),
            session_key: "child-thread".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "subagent".to_string(),
                account_id: Some("rust-runtime".to_string()),
                from: "parent-thread".to_string(),
                to: "agent:subagent".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "child task".to_string(),
                raw_body: None,
                message_id: Some("run-subagent-parent:input".to_string()),
                thread_id: Some("child-thread".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::from([(
                    "parentContextPolicy".to_string(),
                    json!("fork_messages_only"),
                )]),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
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
        .expect("subagent run");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert!(request
        .system_sections
        .iter()
        .any(|section| section.contains("delegated sidechain agent")));
    assert_eq!(
        request.messages,
        vec![
            "parent context detail".to_string(),
            "parent assistant detail".to_string(),
            "child task".to_string()
        ]
    );

    let _ = fs::remove_dir_all(runtime_root);
}

#[tokio::test]
async fn subagent_profile_defaults_to_fresh_parent_context() {
    let runtime_root = unique_test_runtime_root("subagent-fresh-parent-context");
    let config_dir = runtime_root.join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    fs::write(
        config_dir.join("desktop-agent-provider.json"),
        serde_json::to_vec_pretty(&json!({
            "runtime": "native-provider",
            "provider": "test-provider",
            "model": "test-model",
            "apiKey": "test-key"
        }))
        .expect("config json"),
    )
    .expect("write config");
    let store = DesktopSessionStore::new(runtime_root.clone());
    store
        .append_model_message(
            "parent-thread",
            "user",
            "parent context that fresh subagent must not inherit",
            Some("agent"),
            AgentRuntimeMessage::text(
                AgentRuntimeMessageRole::User,
                "parent context that fresh subagent must not inherit",
            ),
        )
        .expect("parent user");

    let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    let runtime = AgentRuntime::with_native_provider_backend(
        runtime_root.clone(),
        Arc::new(CapturingAgentRuntimeBackend {
            reply: "child reply".to_string(),
            requests: Arc::clone(&captured),
        }),
    );
    runtime
        .run_turn(AgentRunRequest {
            run_id: "run-subagent-fresh".to_string(),
            agent_id: "subagent".to_string(),
            session_key: "child-thread".to_string(),
            inbound: ChannelInboundEnvelope {
                channel: "subagent".to_string(),
                account_id: Some("rust-runtime".to_string()),
                from: "parent-thread".to_string(),
                to: "agent:subagent".to_string(),
                chat_type: ChannelChatType::Direct,
                body: "fresh child task".to_string(),
                raw_body: None,
                message_id: Some("run-subagent-fresh:input".to_string()),
                thread_id: Some("child-thread".to_string()),
                media_urls: Vec::new(),
                metadata: BTreeMap::new(),
            },
            model: AgentModelSelection {
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
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
        .expect("fresh subagent run");

    let requests = captured.lock().expect("captured requests");
    let request = requests.first().expect("provider request");
    assert_eq!(request.parent_context_policy, "none");
    assert_eq!(request.messages, vec!["fresh child task".to_string()]);

    let _ = fs::remove_dir_all(runtime_root);
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

fn start_openai_compatible_stream_provider(
    replies: Vec<String>,
) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("provider listener");
    let addr = listener.local_addr().expect("provider addr");
    let (request_tx, request_rx) = mpsc::channel();
    thread::spawn(move || {
        for body in replies {
            let (mut stream, _) = listener.accept().expect("provider request");
            let request = read_http_request(&mut stream);
            request_tx
                .send(String::from_utf8_lossy(&request).to_string())
                .expect("send captured request");
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write response");
        }
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

fn http_request_body(request: &str) -> &str {
    request.split("\r\n\r\n").nth(1).unwrap_or("")
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

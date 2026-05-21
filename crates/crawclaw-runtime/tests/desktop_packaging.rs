use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use crawclaw_runtime::{
    check_desktop_runtime_release_inputs, resolve_desktop_runtime_stage_paths,
    DesktopRuntimeCheckOptions,
};
use serde_json::json;

#[test]
fn resolves_relative_repo_root_to_absolute_stage_paths() {
    let paths = resolve_desktop_runtime_stage_paths(".");

    assert!(
        paths.runtime_root.is_absolute(),
        "runtime root should be absolute: {}",
        paths.runtime_root.display()
    );
    assert!(
        paths.source_runtime_binary_path.is_absolute(),
        "source binary path should be absolute: {}",
        paths.source_runtime_binary_path.display()
    );
}

#[test]
fn accepts_release_fixture_without_js_runtime_surface() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_release_fixture(temp.path(), FixtureOptions::default());

    let mut options = DesktopRuntimeCheckOptions::new(temp.path());
    options.check_generated_paths = false;
    options.check_packaged_bundle = false;
    options.smoke_commands = false;

    check_desktop_runtime_release_inputs(&options).expect("release fixture should pass");
}

#[test]
fn skips_packaged_runtime_check_when_app_bundle_is_absent() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_release_fixture(temp.path(), FixtureOptions::default());

    let mut options = DesktopRuntimeCheckOptions::new(temp.path());
    options.check_generated_paths = false;
    options.check_packaged_bundle = true;
    options.smoke_commands = false;

    check_desktop_runtime_release_inputs(&options).expect("absent app bundle should be skipped");
}

#[test]
fn rejects_node_runtime_entrypoints_in_embedded_runtime() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_release_fixture(
        temp.path(),
        FixtureOptions {
            node_runtime_entrypoint: true,
            ..FixtureOptions::default()
        },
    );

    let mut options = DesktopRuntimeCheckOptions::new(temp.path());
    options.check_generated_paths = false;
    options.check_packaged_bundle = false;
    options.smoke_commands = false;

    let error = check_desktop_runtime_release_inputs(&options).expect_err("node entry rejected");
    assert!(
        error.contains("Disallowed Node runtime entrypoint remains"),
        "{error}"
    );
}

#[test]
fn rejects_plugin_sdk_artifacts_in_embedded_runtime() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_release_fixture(
        temp.path(),
        FixtureOptions {
            plugin_sdk_runtime_artifact: true,
            ..FixtureOptions::default()
        },
    );

    let mut options = DesktopRuntimeCheckOptions::new(temp.path());
    options.check_generated_paths = false;
    options.check_packaged_bundle = false;
    options.smoke_commands = false;

    let error =
        check_desktop_runtime_release_inputs(&options).expect_err("plugin sdk artifact rejected");
    assert!(
        error.contains("Disallowed Plugin SDK runtime artifact remains"),
        "{error}"
    );
}

#[test]
fn rejects_extra_agent_browser_platform_binaries() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_release_fixture(
        temp.path(),
        FixtureOptions {
            extra_agent_browser_platform_binary: true,
            ..FixtureOptions::default()
        },
    );

    let mut options = DesktopRuntimeCheckOptions::new(temp.path());
    options.check_generated_paths = false;
    options.check_packaged_bundle = false;
    options.smoke_commands = false;

    let error = check_desktop_runtime_release_inputs(&options)
        .expect_err("extra agent-browser binary rejected");
    assert!(
        error.contains("agent-browser runtime must include only the host platform binary"),
        "{error}"
    );
}

#[derive(Default)]
struct FixtureOptions {
    node_runtime_entrypoint: bool,
    plugin_sdk_runtime_artifact: bool,
    extra_agent_browser_platform_binary: bool,
}

fn write_release_fixture(root: &Path, options: FixtureOptions) {
    let paths = resolve_desktop_runtime_stage_paths(root);
    fs::create_dir_all(root.join("apps/crawclaw-desktop/src-tauri")).expect("tauri dir");
    fs::create_dir_all(root.join("apps/crawclaw-desktop/dist")).expect("desktop dist");
    fs::create_dir_all(paths.runtime_root.join("bin")).expect("bin");
    for dir in ["runtimes", "channels", "providers", "plugins"] {
        fs::create_dir_all(paths.runtime_root.join(dir)).expect("runtime manifest dir");
    }

    write_json(root.join("package.json"), &json!({ "version": "2026.5.3" }));
    write_json(
        root.join("apps/crawclaw-desktop/package.json"),
        &json!({ "version": "2026.5.3" }),
    );
    write_json(
        root.join("apps/crawclaw-desktop/src-tauri/tauri.conf.json"),
        &json!({
            "productName": "CrawClaw Desktop",
            "identifier": "ai.crawclaw.desktop",
            "bundle": {
                "resources": {
                    "../.runtime/crawclaw": "runtime/crawclaw"
                }
            }
        }),
    );
    fs::write(root.join("apps/crawclaw-desktop/dist/index.html"), "").expect("index html");

    write_executable(&paths.runtime_binary_path);
    write_executable(&paths.gateway_binary_path);
    write_executable(&paths.native_plugins_binary_path);

    write_json(
        paths.runtime_root.join("runtimes/manifest.json"),
        &json!({
            "runtime": "rust-native",
            "jsPluginRuntime": "none",
            "managedRuntimes": {
                "browser": { "runtime": "rust-native-binary", "provider": "agent-browser" },
                "searxng": { "runtime": "python-sidecar", "provider": "searxng" }
            }
        }),
    );
    write_json(
        paths.runtime_root.join("channels/manifest.json"),
        &json!({ "implementation": "rust-native", "channels": [] }),
    );
    write_json(
        paths.runtime_root.join("providers/manifest.json"),
        &json!({
            "transports": required_provider_ids().into_iter().map(|id| json!({
                "id": id,
                "capabilities": {
                    "streaming": true,
                    "toolCalling": true,
                    "multimodal": true,
                    "secretRef": { "env": true, "file": true, "exec": false }
                }
            })).collect::<Vec<_>>()
        }),
    );
    write_json(
        paths.runtime_root.join("plugins/manifest.json"),
        &json!({ "readModel": true, "jsPluginRuntime": "none" }),
    );
    write_searxng_runtime(&paths.runtime_root);
    write_agent_browser_runtime(
        &paths.runtime_root,
        options.extra_agent_browser_platform_binary,
    );

    if options.node_runtime_entrypoint {
        fs::write(paths.runtime_root.join("crawclaw.mjs"), "export {};\n").expect("node entry");
    }
    if options.plugin_sdk_runtime_artifact {
        let sdk_dir = paths.runtime_root.join("dist/plugin-sdk");
        fs::create_dir_all(&sdk_dir).expect("sdk dir");
        fs::write(sdk_dir.join("core.js"), "export {};\n").expect("sdk artifact");
    }
}

fn write_searxng_runtime(runtime_root: &Path) {
    let runtime_dir = runtime_root.join("runtimes/searxng");
    fs::create_dir_all(runtime_dir.join("venv/bin")).expect("searxng dir");
    let python = if cfg!(windows) {
        runtime_dir.join("venv/Scripts/python.exe")
    } else {
        runtime_dir.join("venv/bin/python")
    };
    write_executable(&python);
    fs::write(
        runtime_dir.join("settings.yml"),
        "use_default_settings: true\nsearch:\n  formats:\n    - json\n",
    )
    .expect("settings");
    write_json(
        runtime_dir.join("manifest.json"),
        &json!({ "id": "searxng", "runtime": "python-sidecar", "provider": "searxng" }),
    );
    fs::write(runtime_dir.join("NOTICE.md"), "notice\n").expect("notice");
    fs::write(runtime_dir.join("LICENSE"), "AGPL-3.0-or-later\n").expect("license");
    write_json(
        runtime_dir.join("source.lock.json"),
        &json!({
            "sourceCommit": "afafca93f30939f213c1bc3fa3379e5ed883122d",
            "license": "AGPL-3.0-or-later"
        }),
    );
}

fn write_agent_browser_runtime(runtime_root: &Path, extra_platform_binary: bool) {
    let runtime_dir = runtime_root.join("runtimes/browser");
    fs::create_dir_all(runtime_dir.join("bin")).expect("browser dir");
    let binary_name = if cfg!(windows) {
        "bin/agent-browser.exe"
    } else {
        "bin/agent-browser"
    };
    write_executable(&runtime_dir.join(binary_name));
    if extra_platform_binary {
        write_executable(&runtime_dir.join(if cfg!(target_os = "macos") {
            "bin/agent-browser-linux-x64"
        } else {
            "bin/agent-browser-darwin-arm64"
        }));
    }
    write_json(
        runtime_dir.join("manifest.json"),
        &json!({
            "id": "agent-browser",
            "runtime": "rust-native-binary",
            "provider": "agent-browser",
            "binaryName": Path::new(binary_name).file_name().and_then(|name| name.to_str()).unwrap()
        }),
    );
    write_json(
        runtime_dir.join("source.lock.json"),
        &json!({
            "sourcePackage": "agent-browser",
            "runtime": "rust-native-binary",
            "binaryName": Path::new(binary_name).file_name().and_then(|name| name.to_str()).unwrap()
        }),
    );
    fs::write(runtime_dir.join("LICENSE"), "license\n").expect("license");
}

fn write_json(path: PathBuf, value: &serde_json::Value) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("json parent");
    }
    fs::write(
        path,
        format!("{}\n", serde_json::to_string(value).expect("json")),
    )
    .expect("json");
}

fn write_executable(path: &Path) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("executable parent");
    }
    fs::write(path, "#!/bin/sh\nexit 0\n").expect("executable");
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(path).expect("metadata").permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).expect("chmod");
    }
}

fn required_provider_ids() -> Vec<&'static str> {
    vec![
        "amazon-bedrock",
        "anthropic",
        "anthropic-vertex",
        "azure-openai",
        "bedrock",
        "byteplus",
        "byteplus-plan",
        "chutes",
        "cloudflare-ai-gateway",
        "copilot-proxy",
        "deepseek",
        "github-copilot",
        "google",
        "google-gemini-cli",
        "huggingface",
        "kilocode",
        "kimi",
        "kimi-coding",
        "litellm",
        "microsoft-foundry",
        "minimax",
        "minimax-portal",
        "mistral",
        "modelstudio",
        "moonshot",
        "nvidia",
        "ollama",
        "openai",
        "openai-codex",
        "openai-compatible",
        "opencode",
        "opencode-go",
        "openrouter",
        "qianfan",
        "sglang",
        "synthetic",
        "together",
        "venice",
        "vercel-ai-gateway",
        "vllm",
        "volcengine",
        "volcengine-plan",
        "xai",
        "xiaomi",
        "zai",
    ]
}

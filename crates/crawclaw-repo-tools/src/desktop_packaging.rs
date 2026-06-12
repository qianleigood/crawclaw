use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const AGENT_BROWSER_VERSION: &str = "0.27.0";
const HINDSIGHT_EMBED_VERSION: &str = "0.7.0";
const HINDSIGHT_SOURCE_REPO: &str = "https://github.com/vectorize-io/hindsight";
const SEARXNG_SOURCE_REPO: &str = "https://github.com/searxng/searxng";
const SEARXNG_SOURCE_COMMIT: &str = "afafca93f30939f213c1bc3fa3379e5ed883122d";
const SEARXNG_BUILD_BOOTSTRAP_REQUIREMENTS: &[&str] = &["setuptools", "wheel", "msgspec==0.21.1"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopRuntimeStagePaths {
    pub runtime_root: PathBuf,
    pub runtime_binary_path: PathBuf,
    pub gateway_binary_path: PathBuf,
    pub native_plugins_binary_path: PathBuf,
    pub source_runtime_binary_path: PathBuf,
    pub source_gateway_binary_path: PathBuf,
    pub source_native_plugins_binary_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct DesktopRuntimeCheckOptions {
    pub root_dir: PathBuf,
    pub platform: String,
    pub check_generated_paths: bool,
    pub check_packaged_bundle: bool,
    pub smoke_commands: bool,
}

impl DesktopRuntimeCheckOptions {
    pub fn new(root_dir: impl AsRef<Path>) -> Self {
        Self {
            root_dir: root_dir.as_ref().to_path_buf(),
            platform: current_platform(),
            check_generated_paths: true,
            check_packaged_bundle: true,
            smoke_commands: true,
        }
    }
}

#[derive(Clone, Debug)]
struct SearxngRuntimePaths {
    runtime_dir: PathBuf,
    venv_dir: PathBuf,
    python_path: PathBuf,
    settings_path: PathBuf,
    manifest_path: PathBuf,
    notice_path: PathBuf,
    license_path: PathBuf,
    source_lock_path: PathBuf,
    install_stamp_path: PathBuf,
}

#[derive(Clone, Debug)]
struct AgentBrowserRuntimePaths {
    runtime_dir: PathBuf,
    bin_dir: PathBuf,
    binary_path: PathBuf,
    manifest_path: PathBuf,
    license_path: PathBuf,
    source_lock_path: PathBuf,
}

#[derive(Clone, Debug)]
struct HindsightEmbedRuntimePaths {
    runtime_dir: PathBuf,
    binary_path: PathBuf,
    manifest_path: PathBuf,
    source_lock_path: PathBuf,
}

#[derive(Clone, Debug)]
struct HindsightEmbedReleaseAsset {
    asset_name: &'static str,
    sha256: &'static str,
}

pub fn resolve_desktop_runtime_stage_paths(root_dir: impl AsRef<Path>) -> DesktopRuntimeStagePaths {
    let root_dir = normalize_root_dir(root_dir.as_ref());
    let platform = current_platform();
    let runtime_root = root_dir
        .join("apps")
        .join("crawclaw-desktop")
        .join(".runtime")
        .join("crawclaw");
    DesktopRuntimeStagePaths {
        runtime_binary_path: runtime_root
            .join("bin")
            .join(platform_binary_name("crawclaw-runtime", &platform)),
        gateway_binary_path: runtime_root
            .join("bin")
            .join(platform_binary_name("crawclaw-gateway", &platform)),
        native_plugins_binary_path: runtime_root
            .join("bin")
            .join(platform_binary_name("crawclaw-native-plugins", &platform)),
        source_runtime_binary_path: root_dir
            .join("target")
            .join("release")
            .join(platform_binary_name("crawclaw-runtime", &platform)),
        source_gateway_binary_path: root_dir
            .join("target")
            .join("release")
            .join(platform_binary_name("crawclaw-gateway", &platform)),
        source_native_plugins_binary_path: root_dir
            .join("target")
            .join("release")
            .join(platform_binary_name("crawclaw-native-plugins", &platform)),
        runtime_root,
    }
}

pub fn stage_desktop_tauri_runtime(
    root_dir: impl AsRef<Path>,
) -> Result<DesktopRuntimeStagePaths, String> {
    let root_dir = root_dir.as_ref();
    let paths = resolve_desktop_runtime_stage_paths(root_dir);
    let envs = desktop_runtime_deploy_env(&paths);

    remove_dir_all_if_exists(&paths.runtime_root)?;
    fs::create_dir_all(paths.runtime_root.parent().ok_or_else(|| {
        format!(
            "runtime root has no parent: {}",
            paths.runtime_root.display()
        )
    })?)
    .map_err(|error| format!("failed to create runtime parent: {error}"))?;

    run_checked(
        root_dir,
        cargo_command(),
        &[
            "build",
            "-p",
            "crawclaw-runtime",
            "-p",
            "crawclaw-gateway",
            "-p",
            "crawclaw-native-plugins",
            "--release",
        ],
        &envs,
    )?;

    crawclaw_runtime::stage_desktop_runtime_manifests(&paths.runtime_root)?;
    stage_automation_runtime_assets(root_dir, &paths.runtime_root)?;
    copy_release_binaries(&paths)?;
    stage_hindsight_embed_runtime(&paths.runtime_root, &envs)?;
    stage_searxng_runtime(root_dir, &paths.runtime_root, &envs)?;
    stage_agent_browser_runtime(&paths.runtime_root, &envs)?;
    assert_runtime_tree(&paths, "embedded", true)?;
    Ok(paths)
}

pub fn check_desktop_runtime_release_inputs(
    options: &DesktopRuntimeCheckOptions,
) -> Result<(), String> {
    let root_package = read_json(&options.root_dir.join("package.json"))?;
    let desktop_package = read_json(
        &options
            .root_dir
            .join("apps")
            .join("crawclaw-desktop")
            .join("package.json"),
    )?;
    assert_json_string_eq(
        desktop_package.get("version"),
        root_package
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or(""),
        "desktop package version",
    )?;

    let tauri_config_path = options
        .root_dir
        .join("apps")
        .join("crawclaw-desktop")
        .join("src-tauri")
        .join("tauri.conf.json");
    let tauri_config = read_json(&tauri_config_path)?;
    assert_json_string_eq(
        tauri_config.get("productName"),
        "CrawClaw Desktop",
        "Tauri productName",
    )?;
    assert_json_string_eq(
        tauri_config.get("identifier"),
        "ai.crawclaw.desktop",
        "Tauri identifier",
    )?;
    let resource = tauri_config
        .get("bundle")
        .and_then(|bundle| bundle.get("resources"))
        .and_then(Value::as_object)
        .and_then(|resources| resources.get("../.runtime/crawclaw"))
        .and_then(Value::as_str);
    if resource != Some("runtime/crawclaw") {
        return Err("Tauri embedded runtime resource: expected runtime/crawclaw".to_string());
    }
    let frontend_index_path = options
        .root_dir
        .join("apps")
        .join("crawclaw-desktop")
        .join("dist")
        .join("index.html");
    assert_file(&frontend_index_path, "Tauri React frontend dist/index.html")?;
    assert_tauri_frontend_uses_relative_assets(&frontend_index_path)?;

    let paths = resolve_desktop_runtime_stage_paths(&options.root_dir);
    assert_runtime_tree(&paths, "embedded", options.smoke_commands)?;
    if options.check_packaged_bundle {
        if let Some(packaged_paths) =
            resolve_desktop_packaged_runtime_paths(&options.root_dir, &options.platform)
        {
            assert_runtime_tree(
                &packaged_paths,
                "packaged Tauri macOS app embedded runtime",
                options.smoke_commands,
            )?;
        }
    }
    if options.check_generated_paths {
        assert_no_dirty_generated_paths(&options.root_dir)?;
    }
    Ok(())
}

fn resolve_desktop_packaged_runtime_paths(
    root_dir: &Path,
    platform: &str,
) -> Option<DesktopRuntimeStagePaths> {
    if !is_macos(platform) {
        return None;
    }
    let root_dir = normalize_root_dir(root_dir);
    let runtime_root = root_dir
        .join("target")
        .join("release")
        .join("bundle")
        .join("macos")
        .join("CrawClaw Desktop.app")
        .join("Contents")
        .join("Resources")
        .join("runtime")
        .join("crawclaw");
    if !runtime_root.exists() {
        return None;
    }
    Some(DesktopRuntimeStagePaths {
        runtime_binary_path: runtime_root
            .join("bin")
            .join(platform_binary_name("crawclaw-runtime", platform)),
        gateway_binary_path: runtime_root
            .join("bin")
            .join(platform_binary_name("crawclaw-gateway", platform)),
        native_plugins_binary_path: runtime_root
            .join("bin")
            .join(platform_binary_name("crawclaw-native-plugins", platform)),
        source_runtime_binary_path: root_dir
            .join("target")
            .join("release")
            .join(platform_binary_name("crawclaw-runtime", platform)),
        source_gateway_binary_path: root_dir
            .join("target")
            .join("release")
            .join(platform_binary_name("crawclaw-gateway", platform)),
        source_native_plugins_binary_path: root_dir
            .join("target")
            .join("release")
            .join(platform_binary_name("crawclaw-native-plugins", platform)),
        runtime_root,
    })
}

fn assert_tauri_frontend_uses_relative_assets(index_path: &Path) -> Result<(), String> {
    let html = fs::read_to_string(index_path)
        .map_err(|error| format!("failed to read Tauri frontend index.html: {error}"))?;
    if html.contains("src=\"/") || html.contains("href=\"/") {
        return Err(
            "Tauri React frontend dist/index.html must use relative asset URLs; set Vite base to ./"
                .to_string(),
        );
    }
    Ok(())
}

fn normalize_root_dir(root_dir: &Path) -> PathBuf {
    if root_dir.is_absolute() {
        return root_dir.to_path_buf();
    }
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(root_dir)
}

fn copy_release_binaries(paths: &DesktopRuntimeStagePaths) -> Result<(), String> {
    let binaries = [
        (
            &paths.source_runtime_binary_path,
            &paths.runtime_binary_path,
        ),
        (
            &paths.source_gateway_binary_path,
            &paths.gateway_binary_path,
        ),
        (
            &paths.source_native_plugins_binary_path,
            &paths.native_plugins_binary_path,
        ),
    ];
    for (source, dest) in binaries {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
        }
        fs::copy(source, dest).map_err(|error| {
            format!(
                "failed to copy release binary {} to {}: {error}",
                source.display(),
                dest.display()
            )
        })?;
        set_executable(dest)?;
    }
    Ok(())
}

fn stage_automation_runtime_assets(root_dir: &Path, runtime_root: &Path) -> Result<(), String> {
    for runtime_id in ["comfyui", "n8n"] {
        for file_name in ["install.sh", "manifest.json"] {
            copy_file(
                &root_dir.join("automation").join(runtime_id).join(file_name),
                &runtime_root
                    .join("automation-assets")
                    .join(runtime_id)
                    .join(file_name),
            )?;
        }
    }
    Ok(())
}

fn stage_searxng_runtime(
    root_dir: &Path,
    runtime_root: &Path,
    envs: &BTreeMap<String, String>,
) -> Result<(), String> {
    let paths = resolve_searxng_runtime_paths(runtime_root, &current_platform());
    let lock = read_searxng_source_lock(root_dir)?;
    fs::create_dir_all(&paths.runtime_dir)
        .map_err(|error| format!("failed to create {}: {error}", paths.runtime_dir.display()))?;
    copy_file(
        &bundled_searxng_asset(root_dir, "settings.yml"),
        &paths.settings_path,
    )?;
    copy_file(
        &bundled_searxng_asset(root_dir, "NOTICE.md"),
        &paths.notice_path,
    )?;
    copy_file(
        &bundled_searxng_asset(root_dir, "LICENSE"),
        &paths.license_path,
    )?;
    write_json_file(&paths.source_lock_path, &lock)?;
    write_json_file(
        &paths.manifest_path,
        &json!({
            "id": "searxng",
            "runtime": "python-sidecar",
            "provider": "searxng",
            "baseUrl": "http://127.0.0.1:3210",
            "pythonPath": relative_slash_path(&paths.runtime_dir, &paths.python_path),
            "settingsPath": relative_slash_path(&paths.runtime_dir, &paths.settings_path),
            "sourceRepo": lock.get("sourceRepo").and_then(Value::as_str).unwrap_or(SEARXNG_SOURCE_REPO),
            "sourceCommit": lock.get("sourceCommit").and_then(Value::as_str).unwrap_or(SEARXNG_SOURCE_COMMIT),
            "license": lock.get("license").and_then(Value::as_str).unwrap_or("AGPL-3.0-or-later")
        }),
    )?;

    if !searxng_should_install(&paths, &lock)? {
        return Ok(());
    }
    remove_dir_all_if_exists(&paths.venv_dir)?;
    fs::create_dir_all(&paths.runtime_dir)
        .map_err(|error| format!("failed to create {}: {error}", paths.runtime_dir.display()))?;
    let python_command = envs
        .get("CRAWCLAW_SEARXNG_PYTHON")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| {
            if cfg!(windows) {
                "python.exe".to_string()
            } else {
                "python3".to_string()
            }
        });
    run_checked(
        &paths.runtime_dir,
        &python_command,
        vec![
            OsString::from("-m"),
            OsString::from("venv"),
            paths.venv_dir.as_os_str().to_os_string(),
        ],
        envs,
    )?;
    run_checked(
        &paths.runtime_dir,
        &paths.python_path,
        &["-m", "pip", "install", "--upgrade", "pip"],
        envs,
    )?;
    let mut bootstrap_args = vec![
        OsString::from("-m"),
        OsString::from("pip"),
        OsString::from("install"),
    ];
    bootstrap_args.extend(
        SEARXNG_BUILD_BOOTSTRAP_REQUIREMENTS
            .iter()
            .map(OsString::from),
    );
    run_checked(&paths.runtime_dir, &paths.python_path, bootstrap_args, envs)?;
    if let Some(requirements_spec) = searxng_requirements_spec(&lock) {
        run_checked(
            &paths.runtime_dir,
            &paths.python_path,
            vec![
                OsString::from("-m"),
                OsString::from("pip"),
                OsString::from("install"),
                OsString::from("-r"),
                OsString::from(requirements_spec),
            ],
            envs,
        )?;
    }
    let pip_spec = searxng_pip_spec(&lock);
    run_checked(
        &paths.runtime_dir,
        &paths.python_path,
        vec![
            OsString::from("-m"),
            OsString::from("pip"),
            OsString::from("install"),
            OsString::from("--no-build-isolation"),
            OsString::from(pip_spec),
        ],
        envs,
    )?;
    write_json_file(
        &paths.install_stamp_path,
        &json!({
            "sourceRepo": lock.get("sourceRepo").and_then(Value::as_str).unwrap_or(SEARXNG_SOURCE_REPO),
            "sourceCommit": lock.get("sourceCommit").and_then(Value::as_str).unwrap_or(SEARXNG_SOURCE_COMMIT)
        }),
    )
}

fn stage_hindsight_embed_runtime(
    runtime_root: &Path,
    envs: &BTreeMap<String, String>,
) -> Result<(), String> {
    let platform = current_platform();
    let arch = current_arch();
    let paths = resolve_hindsight_embed_runtime_paths(runtime_root, &platform);
    fs::create_dir_all(&paths.runtime_dir)
        .map_err(|error| format!("failed to create {}: {error}", paths.runtime_dir.display()))?;

    let (runtime, source) = if let Some(explicit_binary) = envs
        .get("CRAWCLAW_HINDSIGHT_EMBED_BIN")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        copy_file(Path::new(explicit_binary), &paths.binary_path)?;
        set_executable(&paths.binary_path)?;
        (
            "rust-native-binary",
            json!({
                "source": "env",
                "env": "CRAWCLAW_HINDSIGHT_EMBED_BIN",
                "path": explicit_binary,
            }),
        )
    } else {
        match hindsight_embed_release_asset(&platform, &arch) {
            Ok(asset) => {
                download_hindsight_embed_asset(&paths.binary_path, &asset, envs)?;
                (
                    "rust-native-binary",
                    json!({
                        "source": "github-release",
                        "sourceRepo": HINDSIGHT_SOURCE_REPO,
                        "version": HINDSIGHT_EMBED_VERSION,
                        "releaseTag": format!("v{HINDSIGHT_EMBED_VERSION}"),
                        "assetName": asset.asset_name,
                        "downloadUrl": hindsight_embed_download_url(asset.asset_name),
                        "sha256": asset.sha256,
                    }),
                )
            }
            Err(error) if is_unsupported_hindsight_embed_platform(&platform, &error) => (
                "unavailable",
                json!({
                    "source": "unavailable",
                    "sourceRepo": HINDSIGHT_SOURCE_REPO,
                    "version": HINDSIGHT_EMBED_VERSION,
                    "releaseTag": format!("v{HINDSIGHT_EMBED_VERSION}"),
                    "reason": "hindsight_embed_unsupported_platform",
                    "detail": error,
                }),
            ),
            Err(error) => return Err(error),
        }
    };

    let binary_name = paths
        .binary_path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("hindsight-embed");
    write_json_file(
        &paths.manifest_path,
        &json!({
            "id": "hindsight",
            "provider": "hindsight",
            "runtime": runtime,
            "version": HINDSIGHT_EMBED_VERSION,
            "platform": platform,
            "arch": arch,
            "binaryName": binary_name,
            "binaryPath": relative_slash_path(runtime_root, &paths.binary_path),
            "status": if runtime == "unavailable" { "unavailable" } else { "ready" },
            "reason": if runtime == "unavailable" { Value::String("hindsight_embed_unsupported_platform".to_string()) } else { Value::Null },
        }),
    )?;
    write_json_file(
        &paths.source_lock_path,
        &json!({
            "runtime": runtime,
            "platform": platform,
            "arch": arch,
            "binaryName": binary_name,
            "source": source,
        }),
    )
}

fn download_hindsight_embed_asset(
    dest: &Path,
    asset: &HindsightEmbedReleaseAsset,
    envs: &BTreeMap<String, String>,
) -> Result<(), String> {
    if dest.exists() {
        verify_sha256(dest, asset.sha256)?;
        set_executable(dest)?;
        return Ok(());
    }
    let parent = dest.parent().ok_or_else(|| {
        format!(
            "Hindsight embed destination has no parent: {}",
            dest.display()
        )
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    let temp_path = parent.join(format!("{}.download", asset.asset_name));
    let _ = fs::remove_file(&temp_path);
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    run_checked(
        parent,
        curl,
        vec![
            OsString::from("-fsSL"),
            OsString::from("--retry"),
            OsString::from("3"),
            OsString::from("--output"),
            temp_path.as_os_str().to_os_string(),
            OsString::from(hindsight_embed_download_url(asset.asset_name)),
        ],
        envs,
    )?;
    verify_sha256(&temp_path, asset.sha256)?;
    fs::rename(&temp_path, dest).map_err(|error| {
        format!(
            "failed to move Hindsight embed binary {} to {}: {error}",
            temp_path.display(),
            dest.display()
        )
    })?;
    set_executable(dest)
}

fn stage_agent_browser_runtime(
    runtime_root: &Path,
    envs: &BTreeMap<String, String>,
) -> Result<(), String> {
    let platform = current_platform();
    let arch = current_arch();
    let paths = resolve_agent_browser_runtime_paths(runtime_root, &platform);
    remove_dir_all_if_exists(&paths.runtime_dir)?;
    fs::create_dir_all(&paths.bin_dir)
        .map_err(|error| format!("failed to create {}: {error}", paths.bin_dir.display()))?;

    if let Some(explicit_binary) = envs
        .get("CRAWCLAW_AGENT_BROWSER_NATIVE_BIN")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        copy_file(Path::new(explicit_binary), &paths.binary_path)?;
        set_executable(&paths.binary_path)?;
    } else {
        stage_agent_browser_from_npm(&paths, &platform, &arch, envs)?;
    }

    write_json_file(
        &paths.manifest_path,
        &json!({
            "id": "agent-browser",
            "provider": "agent-browser",
            "runtime": "rust-native-binary",
            "version": AGENT_BROWSER_VERSION,
            "platform": platform,
            "arch": arch,
            "binaryName": paths.binary_path.file_name().and_then(OsStr::to_str).unwrap_or("agent-browser"),
            "binaryPath": relative_slash_path(&paths.runtime_dir, &paths.binary_path),
            "sourcePackage": "agent-browser"
        }),
    )?;
    write_json_file(
        &paths.source_lock_path,
        &json!({
            "sourcePackage": "agent-browser",
            "version": AGENT_BROWSER_VERSION,
            "npmSpec": format!("agent-browser@{AGENT_BROWSER_VERSION}"),
            "runtime": "rust-native-binary",
            "platform": platform,
            "arch": arch,
            "binaryName": paths.binary_path.file_name().and_then(OsStr::to_str).unwrap_or("agent-browser")
        }),
    )?;
    if !paths.license_path.exists() {
        fs::write(
            &paths.license_path,
            "agent-browser license is bundled from npm package metadata.\n",
        )
        .map_err(|error| format!("failed to write {}: {error}", paths.license_path.display()))?;
    }
    Ok(())
}

fn stage_agent_browser_from_npm(
    paths: &AgentBrowserRuntimePaths,
    platform: &str,
    arch: &str,
    envs: &BTreeMap<String, String>,
) -> Result<(), String> {
    let temp_dir = unique_temp_dir("crawclaw-agent-browser-runtime")?;
    let keep_temp = envs
        .get("CRAWCLAW_KEEP_AGENT_BROWSER_STAGE_TMP")
        .map(String::as_str)
        == Some("1");
    let result = (|| {
        run_checked(
            &temp_dir,
            npm_command(),
            &[
                "pack",
                &format!("agent-browser@{AGENT_BROWSER_VERSION}"),
                "--json",
            ],
            envs,
        )?;
        run_checked(
            &temp_dir,
            "tar",
            &[
                "-xzf",
                &format!("agent-browser-{AGENT_BROWSER_VERSION}.tgz"),
            ],
            envs,
        )?;
        let package_dir = temp_dir.join("package");
        let source_binary = package_dir
            .join("bin")
            .join(agent_browser_package_binary_name(platform, arch)?);
        copy_file(&source_binary, &paths.binary_path)?;
        set_executable(&paths.binary_path)?;
        let license = package_dir.join("LICENSE");
        if license.exists() {
            copy_file(&license, &paths.license_path)?;
        }
        Ok(())
    })();
    if !keep_temp {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    result
}

fn assert_runtime_tree(
    paths: &DesktopRuntimeStagePaths,
    label: &str,
    smoke_commands: bool,
) -> Result<(), String> {
    assert_executable_file(
        &paths.runtime_binary_path,
        &format!("{label} Rust runtime binary"),
    )?;
    assert_executable_file(
        &paths.gateway_binary_path,
        &format!("{label} Rust gateway binary"),
    )?;
    assert_executable_file(
        &paths.native_plugins_binary_path,
        &format!("{label} native plugin binary"),
    )?;
    assert_no_public_cli_binary(&paths.runtime_root, label)?;
    let runtime_manifest = paths.runtime_root.join("runtimes").join("manifest.json");
    assert_file(
        &runtime_manifest,
        &format!("{label} managed runtime manifest"),
    )?;
    assert_hindsight_embed_runtime_tree(&paths.runtime_root, label)?;
    assert_searxng_runtime_tree(&paths.runtime_root, label)?;
    assert_agent_browser_runtime_tree(&paths.runtime_root, label)?;
    assert_automation_runtime_assets(&paths.runtime_root, label)?;
    assert_no_default_js_plugin_runtime(
        &runtime_manifest,
        &format!("{label} managed runtime manifest"),
    )?;
    assert_file(
        &paths.runtime_root.join("channels").join("manifest.json"),
        &format!("{label} Rust channel manifest"),
    )?;
    assert_provider_transport_manifest(
        &paths.runtime_root.join("providers").join("manifest.json"),
        label,
    )?;
    let plugin_manifest = paths.runtime_root.join("plugins").join("manifest.json");
    assert_file(&plugin_manifest, &format!("{label} Rust plugin manifest"))?;
    assert_no_default_js_plugin_runtime(
        &plugin_manifest,
        &format!("{label} Rust plugin manifest"),
    )?;
    assert_no_disallowed_node_runtime_surface(&paths.runtime_root)?;
    assert_no_legacy_desktop_surface(&paths.runtime_root)?;
    if smoke_commands {
        assert_runtime_smoke(paths)?;
    }
    Ok(())
}

fn assert_searxng_runtime_tree(runtime_root: &Path, label: &str) -> Result<(), String> {
    let paths = resolve_searxng_runtime_paths(runtime_root, &current_platform());
    assert_executable_file(
        &paths.python_path,
        &format!("{label} SearXNG Python runtime"),
    )?;
    assert_file(
        &paths.settings_path,
        &format!("{label} SearXNG settings.yml"),
    )?;
    assert_file(
        &paths.manifest_path,
        &format!("{label} SearXNG runtime manifest"),
    )?;
    assert_file(&paths.notice_path, &format!("{label} SearXNG NOTICE"))?;
    assert_file(&paths.license_path, &format!("{label} SearXNG LICENSE"))?;
    assert_file(
        &paths.source_lock_path,
        &format!("{label} SearXNG source lock"),
    )?;
    let settings = read_text(&paths.settings_path)?;
    if !settings.contains("use_default_settings: true") || !settings.contains("json") {
        return Err(format!(
            "{label} SearXNG settings.yml must enable JSON format"
        ));
    }
    let manifest = read_json(&paths.manifest_path)?;
    assert_json_string_eq(
        manifest.get("provider"),
        "searxng",
        &format!("{label} SearXNG manifest provider"),
    )?;
    assert_json_string_eq(
        manifest.get("runtime"),
        "python-sidecar",
        &format!("{label} SearXNG manifest runtime"),
    )?;
    let source_lock = read_json(&paths.source_lock_path)?;
    assert_json_string_eq(
        source_lock.get("sourceCommit"),
        SEARXNG_SOURCE_COMMIT,
        &format!("{label} SearXNG source commit"),
    )?;
    assert_json_string_eq(
        source_lock.get("license"),
        "AGPL-3.0-or-later",
        &format!("{label} SearXNG license"),
    )
}

fn assert_automation_runtime_assets(runtime_root: &Path, label: &str) -> Result<(), String> {
    for runtime_id in ["comfyui", "n8n"] {
        let asset_dir = runtime_root.join("automation-assets").join(runtime_id);
        assert_file(
            &asset_dir.join("manifest.json"),
            &format!("{label} {runtime_id} automation manifest"),
        )?;
        assert_executable_file(
            &asset_dir.join("install.sh"),
            &format!("{label} {runtime_id} automation installer"),
        )?;
    }
    Ok(())
}

fn assert_agent_browser_runtime_tree(runtime_root: &Path, label: &str) -> Result<(), String> {
    let paths = resolve_agent_browser_runtime_paths(runtime_root, &current_platform());
    assert_executable_file(
        &paths.binary_path,
        &format!("{label} agent-browser native runtime"),
    )?;
    assert_file(
        &paths.manifest_path,
        &format!("{label} agent-browser runtime manifest"),
    )?;
    assert_file(
        &paths.source_lock_path,
        &format!("{label} agent-browser source lock"),
    )?;
    assert_file(
        &paths.license_path,
        &format!("{label} agent-browser LICENSE"),
    )?;
    let manifest = read_json(&paths.manifest_path)?;
    assert_json_string_eq(
        manifest.get("provider"),
        "agent-browser",
        &format!("{label} agent-browser manifest provider"),
    )?;
    assert_json_string_eq(
        manifest.get("runtime"),
        "rust-native-binary",
        &format!("{label} agent-browser manifest runtime"),
    )?;
    assert_json_string_eq(
        manifest.get("binaryName"),
        &platform_binary_name("agent-browser", &current_platform()),
        &format!("{label} agent-browser manifest binaryName"),
    )?;
    assert_agent_browser_runtime_pruned_to_host_platform(&paths.bin_dir, label)?;
    let source_lock = read_json(&paths.source_lock_path)?;
    assert_json_string_eq(
        source_lock.get("sourcePackage"),
        "agent-browser",
        &format!("{label} agent-browser source package"),
    )?;
    assert_json_string_eq(
        source_lock.get("runtime"),
        "rust-native-binary",
        &format!("{label} agent-browser runtime lock"),
    )?;
    assert_json_string_eq(
        source_lock.get("binaryName"),
        &platform_binary_name("agent-browser", &current_platform()),
        &format!("{label} agent-browser source lock binaryName"),
    )
}

fn assert_hindsight_embed_runtime_tree(runtime_root: &Path, label: &str) -> Result<(), String> {
    let paths = resolve_hindsight_embed_runtime_paths(runtime_root, &current_platform());
    assert_file(
        &paths.manifest_path,
        &format!("{label} Hindsight runtime manifest"),
    )?;
    assert_file(
        &paths.source_lock_path,
        &format!("{label} Hindsight source lock"),
    )?;
    let manifest = read_json(&paths.manifest_path)?;
    assert_json_string_eq(
        manifest.get("provider"),
        "hindsight",
        &format!("{label} Hindsight manifest provider"),
    )?;
    if manifest.get("runtime").and_then(Value::as_str) == Some("unavailable") {
        assert_json_string_eq(
            manifest.get("status"),
            "unavailable",
            &format!("{label} Hindsight manifest status"),
        )?;
        assert_json_string_eq(
            manifest.get("reason"),
            "hindsight_embed_unsupported_platform",
            &format!("{label} Hindsight manifest reason"),
        )?;
        let source_lock = read_json(&paths.source_lock_path)?;
        assert_json_string_eq(
            source_lock.get("runtime"),
            "unavailable",
            &format!("{label} Hindsight source lock runtime"),
        )?;
        if let Some(source) = source_lock.get("source").and_then(Value::as_object) {
            assert_json_string_eq(
                source.get("source"),
                "unavailable",
                &format!("{label} Hindsight source lock source"),
            )?;
            assert_json_string_eq(
                source.get("reason"),
                "hindsight_embed_unsupported_platform",
                &format!("{label} Hindsight source lock reason"),
            )?;
        }
        return Ok(());
    }
    assert_executable_file(
        &paths.binary_path,
        &format!("{label} Hindsight embed sidecar"),
    )?;
    assert_json_string_eq(
        manifest.get("runtime"),
        "rust-native-binary",
        &format!("{label} Hindsight manifest runtime"),
    )?;
    assert_json_string_eq(
        manifest.get("binaryName"),
        &platform_binary_name("hindsight-embed", &current_platform()),
        &format!("{label} Hindsight manifest binaryName"),
    )?;
    assert_json_string_eq(
        manifest.get("binaryPath"),
        &format!(
            "bin/{}",
            platform_binary_name("hindsight-embed", &current_platform())
        ),
        &format!("{label} Hindsight manifest binaryPath"),
    )?;
    let source_lock = read_json(&paths.source_lock_path)?;
    assert_json_string_eq(
        source_lock.get("runtime"),
        "rust-native-binary",
        &format!("{label} Hindsight source lock runtime"),
    )?;
    assert_json_string_eq(
        source_lock.get("binaryName"),
        &platform_binary_name("hindsight-embed", &current_platform()),
        &format!("{label} Hindsight source lock binaryName"),
    )?;
    if let Some(source) = source_lock.get("source").and_then(Value::as_object) {
        if source.get("source").and_then(Value::as_str) == Some("github-release") {
            let asset = hindsight_embed_release_asset(&current_platform(), &current_arch())?;
            assert_json_string_eq(
                source.get("assetName"),
                asset.asset_name,
                &format!("{label} Hindsight source lock assetName"),
            )?;
            assert_json_string_eq(
                source.get("sha256"),
                asset.sha256,
                &format!("{label} Hindsight source lock sha256"),
            )?;
        }
    }
    Ok(())
}

fn assert_agent_browser_runtime_pruned_to_host_platform(
    bin_dir: &Path,
    label: &str,
) -> Result<(), String> {
    let expected = platform_binary_name("agent-browser", &current_platform());
    let expected_path = bin_dir.join(&expected);
    assert_executable_file(
        &expected_path,
        &format!("{label} host agent-browser binary"),
    )?;
    let mut extras = Vec::new();
    for entry in fs::read_dir(bin_dir)
        .map_err(|error| format!("failed to read {}: {error}", bin_dir.display()))?
    {
        let entry = entry
            .map_err(|error| format!("failed to read {} entry: {error}", bin_dir.display()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
        if file_name == expected {
            continue;
        }
        if file_name == "agent-browser"
            || file_name == "agent-browser.exe"
            || file_name.starts_with("agent-browser-")
        {
            extras.push(path.display().to_string());
        }
    }
    if extras.is_empty() {
        return Ok(());
    }
    extras.sort();
    Err(format!(
        "{label} agent-browser runtime must include only the host platform binary {expected}; remove extra packaged binaries: {}",
        extras.join(", ")
    ))
}

fn assert_provider_transport_manifest(manifest_path: &Path, label: &str) -> Result<(), String> {
    assert_file(
        manifest_path,
        &format!("{label} Rust provider transport manifest"),
    )?;
    let manifest = read_json(manifest_path)?;
    let transports = manifest
        .get("transports")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{label} Rust provider transport manifest is missing transports"))?;
    if transports.is_empty() {
        return Err(format!(
            "{label} Rust provider transport manifest is missing transports"
        ));
    }
    let transport_ids = transports
        .iter()
        .filter_map(|transport| transport.get("id").and_then(Value::as_str))
        .collect::<BTreeSet<_>>();
    for provider in crawclaw_providers::native_provider_transports() {
        if !transport_ids.contains(provider.id) {
            return Err(format!(
                "{label} Rust provider transport manifest is missing {}",
                provider.id
            ));
        }
    }
    for transport in transports {
        let capabilities = transport.get("capabilities").unwrap_or(&Value::Null);
        let secret_ref = capabilities.get("secretRef").unwrap_or(&Value::Null);
        if capabilities.get("streaming").and_then(Value::as_bool) != Some(true)
            || capabilities.get("toolCalling").and_then(Value::as_bool) != Some(true)
            || capabilities.get("multimodal").and_then(Value::as_bool) != Some(true)
            || secret_ref.get("env").and_then(Value::as_bool) != Some(true)
            || secret_ref.get("file").and_then(Value::as_bool) != Some(true)
            || secret_ref.get("exec").and_then(Value::as_bool) != Some(false)
        {
            let id = transport
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            return Err(format!(
                "{label} Rust provider transport manifest has incomplete capabilities for {id}"
            ));
        }
    }
    Ok(())
}

fn assert_runtime_smoke(paths: &DesktopRuntimeStagePaths) -> Result<(), String> {
    assert_runtime_smoke_command(
        &paths.runtime_binary_path,
        &paths.runtime_root,
        &["status", "--json"],
        "runtime status",
    )?;
    assert_runtime_smoke_command(
        &paths.gateway_binary_path,
        &paths.runtime_root,
        &["--help"],
        "Gateway help",
    )?;
    assert_runtime_smoke_command(
        &paths.native_plugins_binary_path,
        &paths.runtime_root,
        &["--help"],
        "native plugin help",
    )
}

fn assert_runtime_smoke_command(
    command: &Path,
    runtime_root: &Path,
    args: &[&str],
    label: &str,
) -> Result<(), String> {
    let output = Command::new(command)
        .args(args)
        .current_dir(runtime_root)
        .env("CRAWCLAW_STATE_DIR", runtime_root)
        .env(
            "CRAWCLAW_PLUGIN_RUNTIMES_DIR",
            runtime_root.join("runtimes"),
        )
        .output()
        .map_err(|error| format!("failed to run {}: {error}", command.display()))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(if output.stderr.is_empty() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_string();
    Err(format!(
        "Tauri embedded CrawClaw runtime {label} smoke failed with exit {}{}",
        output.status.code().unwrap_or(-1),
        if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        }
    ))
}

fn assert_no_legacy_desktop_surface(runtime_root: &Path) -> Result<(), String> {
    let check_root_dir = runtime_root.ancestors().nth(4).ok_or_else(|| {
        format!(
            "failed to resolve repo root from {}",
            runtime_root.display()
        )
    })?;
    let root_package_path = check_root_dir.join("package.json");
    if root_package_path.exists() {
        let root_package = read_json(&root_package_path)?;
        if let Some(script_name) = root_package
            .get("scripts")
            .and_then(Value::as_object)
            .and_then(|scripts| {
                scripts
                    .keys()
                    .find(|name| name.starts_with("admin:desktop:"))
            })
        {
            return Err(format!(
                "Legacy Electron desktop surface remains: package script {script_name}"
            ));
        }
    }
    for legacy_path in [
        check_root_dir.join("apps/crawclaw-admin-desktop"),
        check_root_dir.join("scripts/admin-desktop-build.mjs"),
        check_root_dir.join("scripts/admin-desktop-release-check.mjs"),
        check_root_dir.join("scripts/admin-desktop-stage-runtime.mjs"),
        check_root_dir.join("apps/crawclaw-desktop/src-tauri/src/gateway/node_bridge.rs"),
    ] {
        if legacy_path.exists() {
            return Err(format!(
                "Legacy Electron desktop surface remains: {}",
                legacy_path.display()
            ));
        }
    }
    for legacy_path in [
        check_root_dir.join("apps/crawclaw-desktop/src-tauri/src/bff.rs"),
        check_root_dir.join("apps/crawclaw-desktop/src-tauri/src/desktop_state.rs"),
    ] {
        if legacy_path.exists() {
            return Err(format!(
                "Legacy Tauri Desktop BFF surface remains: {}",
                legacy_path.display()
            ));
        }
    }
    Ok(())
}

fn assert_no_disallowed_node_runtime_surface(runtime_root: &Path) -> Result<(), String> {
    for file_path in walk_files(runtime_root)? {
        if is_plugin_sdk_runtime_artifact(&file_path) {
            return Err(format!(
                "Disallowed Plugin SDK runtime artifact remains: {}",
                file_path.display()
            ));
        }
        if file_path.extension().and_then(|ext| ext.to_str()) != Some("mjs") {
            let basename = file_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            if basename != "package.json"
                && !file_path
                    .components()
                    .any(|part| part.as_os_str() == "node_modules")
            {
                continue;
            }
            return Err(format!(
                "Disallowed Node runtime package surface remains: {}",
                file_path.display()
            ));
        }
        return Err(format!(
            "Disallowed Node runtime entrypoint remains: {}",
            file_path.display()
        ));
    }
    Ok(())
}

fn is_plugin_sdk_runtime_artifact(file_path: &Path) -> bool {
    let parts = file_path
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .collect::<Vec<_>>();
    let Some(index) = parts.iter().position(|part| *part == "plugin-sdk") else {
        return false;
    };
    if index > 0 && parts[index - 1] == "dist" {
        return true;
    }
    matches!(
        file_path.extension().and_then(|ext| ext.to_str()),
        Some("js" | "mjs" | "ts")
    ) || file_path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".d.ts"))
}

fn assert_no_public_cli_binary(runtime_root: &Path, label: &str) -> Result<(), String> {
    let cli_path = runtime_root
        .join("bin")
        .join(platform_binary_name("crawclaw", &current_platform()));
    if cli_path.exists() {
        return Err(format!(
            "{label} must not embed the public crawclaw CLI binary: {}",
            cli_path.display()
        ));
    }
    Ok(())
}

fn assert_no_default_js_plugin_runtime(manifest_path: &Path, label: &str) -> Result<(), String> {
    let manifest = read_json(manifest_path)?;
    if manifest
        .get("jsPluginRuntime")
        .and_then(Value::as_str)
        .is_some_and(|runtime| runtime != "none")
    {
        return Err(format!(
            "{label} must not advertise JS runtime support: {}",
            manifest_path.display()
        ));
    }
    if manifest.to_string().contains("pi-quickjs") {
        return Err(format!(
            "{label} must not stage Pi QuickJS fallback metadata: {}",
            manifest_path.display()
        ));
    }
    Ok(())
}

fn assert_no_dirty_generated_paths(root_dir: &Path) -> Result<(), String> {
    let output = Command::new("git")
        .args([
            "status",
            "--porcelain",
            "--",
            "apps/crawclaw-desktop/.runtime",
            "apps/crawclaw-desktop/dist",
            "apps/crawclaw-desktop/src-tauri/target",
        ])
        .current_dir(root_dir)
        .output()
        .map_err(|error| format!("failed to inspect generated path status: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "Failed to inspect generated path status".to_string()
        } else {
            detail
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return Err(format!(
            "Generated Tauri desktop paths have tracked changes:\n{stdout}"
        ));
    }
    Ok(())
}

fn read_searxng_source_lock(root_dir: &Path) -> Result<Value, String> {
    let candidate = bundled_searxng_asset(root_dir, "source.lock.json");
    if !candidate.exists() {
        return Ok(json!({
            "sourceRepo": SEARXNG_SOURCE_REPO,
            "sourceCommit": SEARXNG_SOURCE_COMMIT,
            "license": "AGPL-3.0-or-later"
        }));
    }
    read_json(&candidate)
}

fn searxng_pip_spec(lock: &Value) -> String {
    let source_repo = lock
        .get("sourceRepo")
        .and_then(Value::as_str)
        .unwrap_or(SEARXNG_SOURCE_REPO);
    let source_commit = lock
        .get("sourceCommit")
        .and_then(Value::as_str)
        .unwrap_or(SEARXNG_SOURCE_COMMIT);
    searxng_github_archive_url(source_repo, source_commit)
        .unwrap_or_else(|| format!("git+{source_repo}@{source_commit}"))
}

fn searxng_requirements_spec(lock: &Value) -> Option<String> {
    let source_repo = lock
        .get("sourceRepo")
        .and_then(Value::as_str)
        .unwrap_or(SEARXNG_SOURCE_REPO);
    let source_commit = lock
        .get("sourceCommit")
        .and_then(Value::as_str)
        .unwrap_or(SEARXNG_SOURCE_COMMIT);
    let (owner, name) = searxng_github_repo_parts(source_repo)?;
    Some(format!(
        "https://raw.githubusercontent.com/{owner}/{name}/{source_commit}/requirements.txt"
    ))
}

fn searxng_github_archive_url(source_repo: &str, source_commit: &str) -> Option<String> {
    let (owner, name) = searxng_github_repo_parts(source_repo)?;
    Some(format!(
        "https://github.com/{owner}/{name}/archive/{source_commit}.tar.gz"
    ))
}

fn searxng_github_repo_parts(source_repo: &str) -> Option<(&str, &str)> {
    let repo = source_repo.trim_end_matches('/').trim_end_matches(".git");
    let path = repo.strip_prefix("https://github.com/")?;
    let mut parts = path.split('/');
    let owner = parts.next()?.trim();
    let name = parts.next()?.trim();
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return None;
    }
    Some((owner, name))
}

fn searxng_should_install(paths: &SearxngRuntimePaths, lock: &Value) -> Result<bool, String> {
    if !paths.python_path.exists() {
        return Ok(true);
    }
    let stamp = match read_json(&paths.install_stamp_path) {
        Ok(stamp) => stamp,
        Err(_) => return Ok(true),
    };
    Ok(stamp.get("sourceCommit").and_then(Value::as_str)
        != lock.get("sourceCommit").and_then(Value::as_str))
}

fn resolve_searxng_runtime_paths(runtime_root: &Path, platform: &str) -> SearxngRuntimePaths {
    let runtime_dir = runtime_root.join("runtimes").join("searxng");
    let venv_dir = runtime_dir.join("venv");
    let python_path = if is_windows(platform) {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    };
    SearxngRuntimePaths {
        settings_path: runtime_dir.join("settings.yml"),
        manifest_path: runtime_dir.join("manifest.json"),
        notice_path: runtime_dir.join("NOTICE.md"),
        license_path: runtime_dir.join("LICENSE"),
        source_lock_path: runtime_dir.join("source.lock.json"),
        install_stamp_path: runtime_dir.join(".searxng-install-stamp.json"),
        runtime_dir,
        venv_dir,
        python_path,
    }
}

fn resolve_agent_browser_runtime_paths(
    runtime_root: &Path,
    platform: &str,
) -> AgentBrowserRuntimePaths {
    let runtime_dir = runtime_root.join("runtimes").join("browser");
    AgentBrowserRuntimePaths {
        bin_dir: runtime_dir.join("bin"),
        binary_path: runtime_dir
            .join("bin")
            .join(platform_binary_name("agent-browser", platform)),
        manifest_path: runtime_dir.join("manifest.json"),
        license_path: runtime_dir.join("LICENSE"),
        source_lock_path: runtime_dir.join("source.lock.json"),
        runtime_dir,
    }
}

fn resolve_hindsight_embed_runtime_paths(
    runtime_root: &Path,
    platform: &str,
) -> HindsightEmbedRuntimePaths {
    let runtime_dir = runtime_root.join("runtimes").join("hindsight");
    HindsightEmbedRuntimePaths {
        binary_path: runtime_root
            .join("bin")
            .join(platform_binary_name("hindsight-embed", platform)),
        manifest_path: runtime_dir.join("manifest.json"),
        source_lock_path: runtime_dir.join("source.lock.json"),
        runtime_dir,
    }
}

fn hindsight_embed_release_asset(
    platform: &str,
    arch: &str,
) -> Result<HindsightEmbedReleaseAsset, String> {
    let normalized_arch = match arch {
        "aarch64" | "arm64" => "arm64",
        "x86_64" | "x64" => "amd64",
        _ => return Err(format!("Unsupported Hindsight embed architecture: {arch}")),
    };
    match (platform, normalized_arch) {
        ("macos" | "darwin", "arm64") => Ok(HindsightEmbedReleaseAsset {
            asset_name: "hindsight-darwin-arm64",
            sha256: "062d842e70434a06bce54549049f96f526baaeab5599f5a9e7bbd0167e1ca174",
        }),
        ("macos" | "darwin", "amd64") => Ok(HindsightEmbedReleaseAsset {
            asset_name: "hindsight-darwin-amd64",
            sha256: "ba304022fe931f596dcc30392b41a5dd80c1288c715fa659982bc3a65270245d",
        }),
        ("linux", "arm64") => Ok(HindsightEmbedReleaseAsset {
            asset_name: "hindsight-linux-arm64",
            sha256: "e085185bd441ab2eb5f52a9dbb728d57c4b643e245d759d00a2112c45a380d34",
        }),
        ("linux", "amd64") => Ok(HindsightEmbedReleaseAsset {
            asset_name: "hindsight-linux-amd64",
            sha256: "7c12118139a72f056136b328bdcab7b584c36d54e29b9d5466c92feede4b3ec4",
        }),
        _ => Err(format!(
            "Unsupported Hindsight embed platform: {platform}-{arch}. Provide CRAWCLAW_HINDSIGHT_EMBED_BIN to stage an explicit local binary."
        )),
    }
}

fn is_unsupported_hindsight_embed_platform(platform: &str, error: &str) -> bool {
    matches!(platform, "windows") && error.starts_with("Unsupported Hindsight embed platform:")
}

fn hindsight_embed_download_url(asset_name: &str) -> String {
    format!("{HINDSIGHT_SOURCE_REPO}/releases/download/v{HINDSIGHT_EMBED_VERSION}/{asset_name}")
}

fn desktop_runtime_deploy_env(paths: &DesktopRuntimeStagePaths) -> BTreeMap<String, String> {
    let mut envs = env::vars().collect::<BTreeMap<_, _>>();
    envs.insert(
        "CRAWCLAW_STATE_DIR".to_string(),
        paths.runtime_root.to_string_lossy().to_string(),
    );
    envs.insert(
        "CRAWCLAW_PLUGIN_RUNTIMES_DIR".to_string(),
        paths
            .runtime_root
            .join("runtimes")
            .to_string_lossy()
            .to_string(),
    );
    envs
}

fn run_checked<I, S>(
    cwd: &Path,
    command: impl AsRef<OsStr>,
    args: I,
    envs: &BTreeMap<String, String>,
) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let command_ref = command.as_ref();
    let args = args
        .into_iter()
        .map(|arg| arg.as_ref().to_os_string())
        .collect::<Vec<OsString>>();
    let args_label = args
        .iter()
        .map(|arg| arg.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ");
    let output = Command::new(command_ref)
        .args(&args)
        .current_dir(cwd)
        .envs(envs)
        .output()
        .map_err(|error| {
            format!(
                "{} {} failed to start in {}: {error}",
                command_ref.to_string_lossy(),
                args_label,
                cwd.display()
            )
        })?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(if output.stderr.is_empty() {
        &output.stdout
    } else {
        &output.stderr
    })
    .trim()
    .to_string();
    Err(format!(
        "{} {} failed in {} with exit {}{}",
        command_ref.to_string_lossy(),
        args_label,
        cwd.display(),
        output.status.code().unwrap_or(-1),
        if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        }
    ))
}

fn copy_file(source: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::copy(source, dest).map(|_| ()).map_err(|error| {
        format!(
            "failed to copy {} to {}: {error}",
            source.display(),
            dest.display()
        )
    })
}

fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let actual = sha256_file(path)?;
    if actual == expected {
        return Ok(());
    }
    Err(format!(
        "sha256 mismatch for {}: expected {expected}, got {actual}",
        path.display()
    ))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    fs::write(
        path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(value).map_err(|error| format!(
                "failed to encode JSON for {}: {error}",
                path.display()
            ))?
        ),
    )
    .map_err(|error| format!("failed to write {}: {error}", path.display()))
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = read_text(path)?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn read_text(path: &Path) -> Result<String, String> {
    assert_file(path, &path.display().to_string())?;
    fs::read_to_string(path).map_err(|error| format!("failed to read {}: {error}", path.display()))
}

fn assert_file(path: &Path, label: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Missing {label}: {}", path.display()));
    }
    Ok(())
}

fn assert_executable_file(path: &Path, label: &str) -> Result<(), String> {
    assert_file(path, label)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)
            .map_err(|error| format!("failed to stat {}: {error}", path.display()))?
            .permissions()
            .mode();
        if mode & 0o111 == 0 {
            return Err(format!("{label} is not executable: {}", path.display()));
        }
    }
    Ok(())
}

fn assert_json_string_eq(value: Option<&Value>, expected: &str, label: &str) -> Result<(), String> {
    let actual = value.and_then(Value::as_str).unwrap_or("");
    if actual != expected {
        return Err(format!("{label}: expected {expected}, got {actual}"));
    }
    Ok(())
}

fn walk_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in
        fs::read_dir(root).map_err(|error| format!("failed to read {}: {error}", root.display()))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read {} entry: {error}", root.display()))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to stat {}: {error}", path.display()))?;
        if file_type.is_dir() {
            files.extend(walk_files(&path)?);
        } else if file_type.is_file() {
            files.push(path);
        }
    }
    Ok(files)
}

fn remove_dir_all_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("failed to remove {}: {error}", path.display()))?;
    }
    Ok(())
}

fn set_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|error| format!("failed to stat {}: {error}", path.display()))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)
            .map_err(|error| format!("failed to chmod {}: {error}", path.display()))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn bundled_searxng_asset(root_dir: &Path, file_name: &str) -> PathBuf {
    root_dir
        .join("extensions")
        .join("searxng")
        .join("runtime")
        .join(file_name)
}

fn relative_slash_path(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn unique_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock before UNIX_EPOCH: {error}"))?
        .as_nanos();
    let path = env::temp_dir().join(format!("{prefix}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create {}: {error}", path.display()))?;
    Ok(path)
}

fn agent_browser_package_binary_name(platform: &str, arch: &str) -> Result<String, String> {
    let normalized_arch = match arch {
        "aarch64" | "arm64" => "arm64",
        "x86_64" | "x64" => "x64",
        _ => return Err(format!("Unsupported agent-browser architecture: {arch}")),
    };
    if is_macos(platform) {
        return Ok(format!("agent-browser-darwin-{normalized_arch}"));
    }
    if matches!(platform, "linux") {
        return Ok(format!("agent-browser-linux-{normalized_arch}"));
    }
    if is_windows(platform) {
        if normalized_arch != "x64" {
            return Err(format!(
                "Unsupported agent-browser Windows architecture: {arch}"
            ));
        }
        return Ok("agent-browser-win32-x64.exe".to_string());
    }
    Err(format!("Unsupported agent-browser platform: {platform}"))
}

fn platform_binary_name(name: &str, platform: &str) -> String {
    if is_windows(platform) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn is_windows(platform: &str) -> bool {
    matches!(platform, "windows" | "win32")
}

fn is_macos(platform: &str) -> bool {
    matches!(platform, "macos" | "darwin")
}

fn current_platform() -> String {
    env::consts::OS.to_string()
}

fn current_arch() -> String {
    env::consts::ARCH.to_string()
}

fn cargo_command() -> &'static str {
    if cfg!(windows) {
        "cargo.exe"
    } else {
        "cargo"
    }
}

fn npm_command() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_github_archive_for_default_searxng_source() {
        let spec = searxng_pip_spec(&json!({
            "sourceRepo": "https://github.com/searxng/searxng",
            "sourceCommit": "abc123"
        }));

        assert_eq!(
            spec,
            "https://github.com/searxng/searxng/archive/abc123.tar.gz"
        );
    }

    #[test]
    fn uses_github_requirements_for_default_searxng_source() {
        let spec = searxng_requirements_spec(&json!({
            "sourceRepo": "https://github.com/searxng/searxng",
            "sourceCommit": "abc123"
        }));

        assert_eq!(
            spec.as_deref(),
            Some("https://raw.githubusercontent.com/searxng/searxng/abc123/requirements.txt")
        );
    }

    #[test]
    fn falls_back_to_git_spec_for_custom_searxng_source() {
        let spec = searxng_pip_spec(&json!({
            "sourceRepo": "https://example.com/searxng.git",
            "sourceCommit": "abc123"
        }));

        assert_eq!(spec, "git+https://example.com/searxng.git@abc123");
        assert!(searxng_requirements_spec(&json!({
            "sourceRepo": "https://example.com/searxng.git",
            "sourceCommit": "abc123"
        }))
        .is_none());
    }

    #[test]
    fn resolves_hindsight_embed_runtime_paths() {
        let root = PathBuf::from("/tmp/crawclaw-runtime");
        let paths = resolve_hindsight_embed_runtime_paths(&root, "macos");

        assert_eq!(paths.binary_path, root.join("bin").join("hindsight-embed"));
        assert_eq!(
            paths.manifest_path,
            root.join("runtimes")
                .join("hindsight")
                .join("manifest.json")
        );
        assert_eq!(
            paths.source_lock_path,
            root.join("runtimes")
                .join("hindsight")
                .join("source.lock.json")
        );
    }

    #[test]
    fn maps_hindsight_embed_release_assets_with_pinned_checksums() {
        let asset = hindsight_embed_release_asset("darwin", "arm64").expect("darwin arm64");
        assert_eq!(asset.asset_name, "hindsight-darwin-arm64");
        assert_eq!(
            asset.sha256,
            "062d842e70434a06bce54549049f96f526baaeab5599f5a9e7bbd0167e1ca174"
        );

        let asset = hindsight_embed_release_asset("linux", "x86_64").expect("linux x64");
        assert_eq!(asset.asset_name, "hindsight-linux-amd64");
        assert_eq!(
            hindsight_embed_download_url(asset.asset_name),
            "https://github.com/vectorize-io/hindsight/releases/download/v0.7.0/hindsight-linux-amd64"
        );

        let error =
            hindsight_embed_release_asset("windows", "x86_64").expect_err("no Windows binary");
        assert!(is_unsupported_hindsight_embed_platform("windows", &error));
    }
}

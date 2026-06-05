use std::fs::{self, OpenOptions};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::{
    authorize_headers, automation_runtime_dir, automation_runtime_pid_path,
    automation_runtime_process_is_running, emit_state_changed, is_managed_automation_runtime_id,
    refresh_automation_runtime_state, GatewayState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AutomationRuntimeInstallRequest {
    compute_profile: Option<String>,
    pytorch_index_url: Option<String>,
}

pub(super) async fn refresh_automation_runtime(
    State(state): State<GatewayState>,
    AxumPath(runtime_id): AxumPath<String>,
) -> Result<Json<crate::models::DesktopState>, StatusCode> {
    refresh_runtime_state(&state, &runtime_id).await?;
    emit_state_changed(&state).await
}

pub(super) async fn install_automation_runtime(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    AxumPath(runtime_id): AxumPath<String>,
    Json(payload): Json<AutomationRuntimeInstallRequest>,
) -> Result<Json<crate::models::DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    ensure_runtime_ready(&state)?;
    ensure_runtime_id(&runtime_id)?;

    let runtime_root = state.runtime_root.clone();
    let compute_profile = payload.compute_profile;
    let pytorch_index_url = payload.pytorch_index_url;
    let runtime_id_for_task = runtime_id.clone();
    tokio::task::spawn_blocking(move || {
        run_automation_runtime_install(
            &runtime_root,
            &runtime_id_for_task,
            compute_profile,
            pytorch_index_url,
        )
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::BAD_GATEWAY)?;

    refresh_runtime_state(&state, &runtime_id).await?;
    emit_state_changed(&state).await
}

pub(super) async fn start_automation_runtime(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    AxumPath(runtime_id): AxumPath<String>,
) -> Result<Json<crate::models::DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    ensure_runtime_ready(&state)?;
    ensure_runtime_id(&runtime_id)?;

    let runtime_root = state.runtime_root.clone();
    let runtime_id_for_task = runtime_id.clone();
    tokio::task::spawn_blocking(move || {
        start_automation_runtime_process(&runtime_root, &runtime_id_for_task)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::BAD_REQUEST)?;

    refresh_runtime_state(&state, &runtime_id).await?;
    emit_state_changed(&state).await
}

pub(super) async fn stop_automation_runtime(
    State(state): State<GatewayState>,
    headers: HeaderMap,
    AxumPath(runtime_id): AxumPath<String>,
) -> Result<Json<crate::models::DesktopState>, StatusCode> {
    authorize_headers(&headers, &state)?;
    ensure_runtime_id(&runtime_id)?;

    let runtime_root = state.runtime_root.clone();
    let runtime_id_for_task = runtime_id.clone();
    tokio::task::spawn_blocking(move || {
        stop_automation_runtime_process(&runtime_root, &runtime_id_for_task)
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::BAD_REQUEST)?;

    refresh_runtime_state(&state, &runtime_id).await?;
    emit_state_changed(&state).await
}

async fn refresh_runtime_state(state: &GatewayState, runtime_id: &str) -> Result<(), StatusCode> {
    let mut desktop_state = state.desktop_state.write().await;
    refresh_automation_runtime_state(&mut desktop_state, &state.runtime_root, runtime_id)
        .map_err(|_| StatusCode::NOT_FOUND)
}

fn ensure_runtime_id(runtime_id: &str) -> Result<(), StatusCode> {
    is_managed_automation_runtime_id(runtime_id)
        .then_some(())
        .ok_or(StatusCode::NOT_FOUND)
}

fn ensure_runtime_ready(state: &GatewayState) -> Result<(), StatusCode> {
    (state.runtime_supervisor.status().status == crate::models::RuntimeStatusValue::Ready)
        .then_some(())
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)
}

fn run_automation_runtime_install(
    runtime_root: &Path,
    runtime_id: &str,
    compute_profile: Option<String>,
    pytorch_index_url: Option<String>,
) -> Result<(), String> {
    let script_path = resolve_automation_installer_script(runtime_root, runtime_id)?;
    let runtime_dir = automation_runtime_dir(runtime_root, runtime_id);
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("create automation runtime dir: {error}"))?;
    let log_path = runtime_dir.join("install.log");
    let stdout = open_log_file(&log_path)?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("clone install log: {error}"))?;
    let automation_home = runtime_root.join("automation");
    fs::create_dir_all(&automation_home)
        .map_err(|error| format!("create automation home: {error}"))?;

    let mut command = Command::new("bash");
    command
        .arg(&script_path)
        .env("CRAWCLAW_AUTOMATION_HOME", &automation_home)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    if runtime_id == "comfyui" {
        if let Some(profile) = compute_profile
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command.env("COMFYUI_COMPUTE_PROFILE", profile);
        }
        if let Some(index_url) = pytorch_index_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command.env("PYTORCH_INDEX_URL", index_url);
        }
    }

    let status = command
        .status()
        .map_err(|error| format!("run installer {}: {error}", script_path.display()))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| format!("installer exited with {status}"))
}

fn start_automation_runtime_process(runtime_root: &Path, runtime_id: &str) -> Result<(), String> {
    let runtime_dir = automation_runtime_dir(runtime_root, runtime_id);
    let runtime_json_path = runtime_dir.join("runtime.json");
    let runtime_json: Value = serde_json::from_str(
        &fs::read_to_string(&runtime_json_path)
            .map_err(|error| format!("read {}: {error}", runtime_json_path.display()))?,
    )
    .map_err(|error| format!("parse {}: {error}", runtime_json_path.display()))?;
    let start_script = runtime_json
        .get("startScript")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "runtime has no startScript".to_string())?;
    let start_script_path = PathBuf::from(start_script);
    if !start_script_path.is_file() {
        return Err(format!("start script is missing: {start_script}"));
    }

    if let Some(pid) = fs::read_to_string(automation_runtime_pid_path(runtime_root, runtime_id))
        .ok()
        .and_then(|raw| raw.trim().parse::<u32>().ok())
    {
        if automation_runtime_process_is_running(pid) {
            return Ok(());
        }
    }

    let log_path = runtime_dir.join("service.log");
    let stdout = open_log_file(&log_path)?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("clone service log: {error}"))?;
    let child = Command::new(&start_script_path)
        .current_dir(&runtime_dir)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("start {}: {error}", start_script_path.display()))?;
    fs::write(
        automation_runtime_pid_path(runtime_root, runtime_id),
        child.id().to_string(),
    )
    .map_err(|error| format!("write service pid: {error}"))?;
    Ok(())
}

fn stop_automation_runtime_process(runtime_root: &Path, runtime_id: &str) -> Result<(), String> {
    let pid_path = automation_runtime_pid_path(runtime_root, runtime_id);
    let Some(pid) = fs::read_to_string(&pid_path)
        .ok()
        .and_then(|raw| raw.trim().parse::<u32>().ok())
    else {
        return Ok(());
    };

    if automation_runtime_process_is_running(pid) {
        stop_process(pid)?;
    }
    let _ = fs::remove_file(pid_path);
    Ok(())
}

fn stop_process(pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        let status = Command::new("kill")
            .arg(pid.to_string())
            .status()
            .map_err(|error| format!("kill {pid}: {error}"))?;
        status
            .success()
            .then_some(())
            .ok_or_else(|| format!("kill {pid} exited with {status}"))
    }
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| format!("taskkill {pid}: {error}"))?;
        status
            .success()
            .then_some(())
            .ok_or_else(|| format!("taskkill {pid} exited with {status}"))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        Err("process stop is unsupported on this platform".to_string())
    }
}

fn resolve_automation_installer_script(
    runtime_root: &Path,
    runtime_id: &str,
) -> Result<PathBuf, String> {
    let install = runtime_install_manifest(runtime_root, runtime_id)?;
    let pinned_sha256 = manifest_string(&install, "sha256")
        .ok_or_else(|| format!("installer checksum pin unavailable for {runtime_id}"))?;

    let packaged_manifest = runtime_root
        .join("automation-assets")
        .join(runtime_id)
        .join("manifest.json");
    if packaged_manifest.is_file() {
        return resolve_script_from_release_manifest(&packaged_manifest, None, &pinned_sha256);
    }

    let repo_manifest = repo_root()
        .join("automation")
        .join(runtime_id)
        .join("manifest.json");
    if repo_manifest.is_file() {
        return resolve_script_from_release_manifest(&repo_manifest, None, &pinned_sha256);
    }

    let manifest_url = manifest_string(&install, "manifestUrl")
        .ok_or_else(|| format!("installer manifest URL unavailable for {runtime_id}"))?;
    let asset_dir = runtime_root.join("automation-assets").join(runtime_id);
    fs::create_dir_all(&asset_dir)
        .map_err(|error| format!("create automation asset dir: {error}"))?;
    let cached_manifest = asset_dir.join("manifest.json");
    download_url_to_file(&manifest_url, &cached_manifest)?;
    let script_url = manifest_string(&install, "scriptUrl");
    resolve_script_from_release_manifest(&cached_manifest, script_url.as_deref(), &pinned_sha256)
}

fn resolve_script_from_release_manifest(
    manifest_path: &Path,
    fallback_script_url: Option<&str>,
    pinned_sha256: &str,
) -> Result<PathBuf, String> {
    let raw = fs::read_to_string(manifest_path)
        .map_err(|error| format!("read {}: {error}", manifest_path.display()))?;
    let manifest: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("parse {}: {error}", manifest_path.display()))?;
    let install_script = manifest
        .get("assets")
        .and_then(Value::as_object)
        .and_then(|assets| assets.get("installScript"))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!(
                "automation release manifest has no assets.installScript: {}",
                manifest_path.display()
            )
        })?;
    let script_path = safe_manifest_relative_path(
        manifest_string(install_script, "path")
            .as_deref()
            .unwrap_or("install.sh"),
    )?;
    let expected_sha256 = manifest_string(install_script, "sha256")
        .ok_or_else(|| "automation release manifest has no install script sha256".to_string())?;
    if !expected_sha256.eq_ignore_ascii_case(pinned_sha256) {
        return Err(format!(
            "automation release manifest checksum drift for {}: runtime manifest pins {pinned_sha256}, release manifest declares {expected_sha256}",
            manifest_path.display()
        ));
    }
    let local_script = manifest_path
        .parent()
        .ok_or_else(|| format!("manifest has no parent: {}", manifest_path.display()))?
        .join(&script_path);
    if local_script.is_file() {
        verify_sha256_hex(&local_script, &expected_sha256)?;
        return Ok(local_script);
    }

    let script_url = manifest_string(install_script, "url")
        .or_else(|| fallback_script_url.map(ToOwned::to_owned))
        .ok_or_else(|| "automation install script URL unavailable".to_string())?;
    download_url_to_file(&script_url, &local_script)?;
    verify_sha256_hex(&local_script, &expected_sha256)?;
    Ok(local_script)
}

fn runtime_install_manifest(
    runtime_root: &Path,
    runtime_id: &str,
) -> Result<Map<String, Value>, String> {
    let manifest_path = runtime_root.join("runtimes").join("manifest.json");
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("read {}: {error}", manifest_path.display()))?;
    let manifest: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("parse {}: {error}", manifest_path.display()))?;
    manifest
        .get("managedRuntimes")
        .and_then(Value::as_object)
        .and_then(|managed| managed.get(runtime_id))
        .and_then(Value::as_object)
        .and_then(|runtime| runtime.get("install"))
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| format!("runtime install manifest unavailable for {runtime_id}"))
}

fn safe_manifest_relative_path(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err(format!("invalid automation asset path: {raw}"));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(format!("unsafe automation asset path: {raw}"));
    }
    Ok(path.to_path_buf())
}

fn manifest_string(manifest: &Map<String, Value>, key: &str) -> Option<String> {
    manifest
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn download_url_to_file(url: &str, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create automation download dir {}: {error}",
                parent.display()
            )
        })?;
    }
    let output = Command::new("curl")
        .args(["-fsSL", url, "-o"])
        .arg(target)
        .output()
        .map_err(|error| format!("run curl for {url}: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!("download {url}: {stderr}"))
}

fn verify_sha256_hex(path: &Path, expected: &str) -> Result<(), String> {
    let actual = sha256_hex(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        return Ok(());
    }
    Err(format!(
        "sha256 mismatch for {}: expected {expected}, got {actual}",
        path.display()
    ))
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    let digest = Sha256::digest(&bytes);
    Ok(format!("{digest:x}"))
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .expect("repo root")
        .to_path_buf()
}

fn open_log_file(path: &Path) -> Result<std::fs::File, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create log dir: {error}"))?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("open {}: {error}", path.display()))
}

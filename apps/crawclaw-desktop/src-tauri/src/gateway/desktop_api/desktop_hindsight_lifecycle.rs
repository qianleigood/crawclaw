use std::env;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crawclaw_runtime::memory::MemoryRuntimeConfig;

use super::desktop_settings_effects::update_desktop_memory_policy;

pub(super) async fn prepare_desktop_hindsight_lifecycle(
    runtime_root: &Path,
) -> Result<Value, String> {
    let configured = MemoryRuntimeConfig::load(runtime_root).hindsight;
    if configured.enabled && !configured.base_url.trim().is_empty() {
        let mode = if is_loopback_url(&configured.base_url) {
            "local"
        } else {
            "remote"
        };
        let lifecycle = json!({
            "hindsightMode": mode,
            "hindsightManaged": false,
            "hindsightLifecycleStatus": "external",
            "hindsightLifecycleReason": Value::Null,
        });
        update_desktop_memory_policy(runtime_root, &lifecycle)?;
        return Ok(json!({
            "status": "external",
            "mode": mode,
            "managed": false,
        }));
    }

    if let Some(policy_base_url) = existing_external_hindsight_base_url(runtime_root) {
        let mode = if is_loopback_url(&policy_base_url) {
            "local"
        } else {
            "remote"
        };
        let lifecycle = json!({
            "hindsightMode": mode,
            "hindsightManaged": false,
            "hindsightLifecycleStatus": "external",
            "hindsightLifecycleReason": Value::Null,
        });
        update_desktop_memory_policy(runtime_root, &lifecycle)?;
        return Ok(json!({
            "status": "external",
            "mode": mode,
            "managed": false,
            "baseUrl": policy_base_url,
        }));
    }

    let Some(binary_path) = find_hindsight_binary(runtime_root) else {
        let lifecycle = json!({
            "hindsightEnabled": Value::Null,
            "hindsightBaseUrl": Value::Null,
            "hindsightMode": "local",
            "hindsightManaged": true,
            "hindsightLifecycleStatus": "unavailable",
            "hindsightLifecycleReason": "hindsight_embed_missing",
        });
        update_desktop_memory_policy(runtime_root, &lifecycle)?;
        return Ok(json!({
            "status": "unavailable",
            "mode": "local",
            "managed": true,
            "reason": "hindsight_embed_missing",
        }));
    };

    if !hindsight_embed_binary_supports_sidecar_server(&binary_path).await {
        let lifecycle = json!({
            "hindsightEnabled": Value::Null,
            "hindsightBaseUrl": Value::Null,
            "hindsightMode": "local",
            "hindsightManaged": true,
            "hindsightLifecycleStatus": "unavailable",
            "hindsightLifecycleReason": "hindsight_embed_cli_only",
        });
        update_desktop_memory_policy(runtime_root, &lifecycle)?;
        return Ok(json!({
            "status": "unavailable",
            "mode": "local",
            "managed": true,
            "reason": "hindsight_embed_cli_only",
        }));
    }

    let port = pick_free_port()?;
    let base_url = format!("http://127.0.0.1:{port}");
    let data_dir = runtime_root.join("hindsight");
    std::fs::create_dir_all(&data_dir).map_err(|error| {
        format!(
            "Failed to create Hindsight data directory {}: {error}",
            data_dir.display()
        )
    })?;
    spawn_hindsight_embed(binary_path, data_dir, port).await?;
    let lifecycle = json!({
        "hindsightEnabled": true,
        "hindsightBaseUrl": base_url,
        "hindsightMode": "local",
        "hindsightManaged": true,
        "hindsightLifecycleStatus": "starting",
        "hindsightLifecycleReason": Value::Null,
    });
    update_desktop_memory_policy(runtime_root, &lifecycle)?;
    Ok(json!({
        "status": "starting",
        "mode": "local",
        "managed": true,
        "baseUrl": base_url,
    }))
}

async fn spawn_hindsight_embed(
    binary_path: PathBuf,
    data_dir: PathBuf,
    port: u16,
) -> Result<(), String> {
    let mut command = Command::new(&binary_path);
    command
        .arg("--port")
        .arg(port.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--embeddings-model")
        .arg("BAAI/bge-m3")
        .arg("--reranker-model")
        .arg("BAAI/bge-reranker-v2-m3")
        .arg("--text-search-extension")
        .arg("pgroonga")
        .arg("--llm-provider")
        .arg("openai")
        .arg("--llm-model")
        .arg("gpt-4o-mini")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Ok(api_key) = env::var("OPENAI_API_KEY") {
        if !api_key.trim().is_empty() {
            command.arg("--llm-api-key").arg(api_key);
        }
    }

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Failed to start Hindsight sidecar {}: {error}",
            binary_path.display()
        )
    })?;

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(pipe_hindsight_logs("stdout", stdout));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(pipe_hindsight_logs("stderr", stderr));
    }
    tokio::spawn(async move {
        match child.wait().await {
            Ok(status) => tracing::warn!(%status, "desktop_hindsight_sidecar_exited"),
            Err(error) => tracing::warn!(error = %error, "desktop_hindsight_sidecar_wait_failed"),
        }
    });
    Ok(())
}

async fn pipe_hindsight_logs(stream_name: &'static str, stream: impl tokio::io::AsyncRead + Unpin) {
    let mut lines = BufReader::new(stream).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                tracing::debug!(stream = stream_name, message = %line, "desktop_hindsight_sidecar_log")
            }
            Ok(None) => break,
            Err(error) => {
                tracing::warn!(stream = stream_name, error = %error, "desktop_hindsight_sidecar_log_failed");
                break;
            }
        }
    }
}

async fn hindsight_embed_binary_supports_sidecar_server(binary_path: &Path) -> bool {
    let Ok(output) = Command::new(binary_path).arg("--help").output().await else {
        return false;
    };
    let mut help = String::from_utf8_lossy(&output.stdout).to_string();
    help.push_str(&String::from_utf8_lossy(&output.stderr));
    hindsight_embed_supports_sidecar_server(&help)
}

fn hindsight_embed_supports_sidecar_server(help: &str) -> bool {
    let help = help.to_ascii_lowercase();
    help.contains("--port")
        && help.contains("--host")
        && help.contains("--data-dir")
        && !help.contains("[options] <command>")
}

fn find_hindsight_binary(runtime_root: &Path) -> Option<PathBuf> {
    if let Some(path) = env::var_os("CRAWCLAW_HINDSIGHT_EMBED_BIN")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
    {
        return Some(path);
    }

    let binary_names = hindsight_binary_names(env::consts::OS);
    let mut candidates = Vec::new();
    for binary_name in &binary_names {
        candidates.push(runtime_root.join("bin").join(binary_name));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            for binary_name in &binary_names {
                candidates.push(dir.join(binary_name));
            }
            candidates.push(dir.join(format!(
                "hindsight-embed-{}-{}",
                env::consts::OS,
                env::consts::ARCH
            )));
        }
    }
    candidates.push(PathBuf::from("/usr/local/bin/hindsight-embed"));
    candidates
        .into_iter()
        .chain(binary_names.iter().flat_map(|name| path_candidates(name)))
        .find(|path| path.is_file())
}

fn hindsight_binary_names(platform: &str) -> Vec<&'static str> {
    if platform == "windows" {
        return vec!["hindsight-embed.exe", "hindsight-embed"];
    }
    vec!["hindsight-embed"]
}

fn path_candidates(binary_name: &str) -> Vec<PathBuf> {
    env::var_os("PATH")
        .map(|paths| {
            env::split_paths(&paths)
                .map(|dir| dir.join(binary_name))
                .collect()
        })
        .unwrap_or_default()
}

fn existing_external_hindsight_base_url(runtime_root: &Path) -> Option<String> {
    let path = runtime_root
        .join("config")
        .join("desktop-memory-policy.json");
    let policy: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    if policy.get("hindsightEnabled").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    if policy.get("hindsightManaged").and_then(Value::as_bool) != Some(false) {
        return None;
    }
    policy
        .get("hindsightBaseUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn pick_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Failed to reserve Hindsight port: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read Hindsight port: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn is_loopback_url(value: &str) -> bool {
    value.contains("://127.0.0.1") || value.contains("://localhost") || value.contains("://[::1]")
}

#[cfg(test)]
mod tests {
    use super::{hindsight_binary_names, hindsight_embed_supports_sidecar_server};

    #[test]
    fn hindsight_binary_names_include_windows_exe_candidate() {
        assert_eq!(
            hindsight_binary_names("windows"),
            vec!["hindsight-embed.exe", "hindsight-embed"]
        );
        assert_eq!(hindsight_binary_names("macos"), vec!["hindsight-embed"]);
    }

    #[test]
    fn hindsight_embed_cli_help_is_not_sidecar_server() {
        let cli_help = r#"Hindsight CLI - Semantic memory system

Usage: hindsight-embed [OPTIONS] <COMMAND>

Commands:
  bank      Manage banks
  memory    Manage memories
  health    Check API health status
"#;

        assert!(!hindsight_embed_supports_sidecar_server(cli_help));
    }

    #[test]
    fn hindsight_embed_server_help_supports_sidecar_server() {
        let server_help = r#"Usage: hindsight-embed [OPTIONS]

Options:
  --host <HOST>
  --port <PORT>
  --data-dir <DATA_DIR>
"#;

        assert!(hindsight_embed_supports_sidecar_server(server_help));
    }
}

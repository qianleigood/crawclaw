use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::timeout;

use crate::error::{invalid_input, runtime_error, NativeResult};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OpenShellConfig {
    #[serde(default = "default_command")]
    pub command: String,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default, rename = "gatewayEndpoint")]
    pub gateway_endpoint: Option<String>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}

fn default_command() -> String {
    "openshell".to_string()
}

pub fn shell_escape(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    if value.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'_' | b'+' | b',' | b'.' | b'/' | b':' | b'=' | b'@' | b'-'
            )
    }) {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn build_remote_command(argv: &[String]) -> String {
    argv.iter()
        .map(|entry| shell_escape(entry))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn build_openshell_base_argv(config: &OpenShellConfig) -> Vec<String> {
    let mut argv = vec![config.command.clone()];
    if let Some(gateway) = config
        .gateway
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        argv.push("--gateway".to_string());
        argv.push(gateway.trim().to_string());
    }
    if let Some(endpoint) = config
        .gateway_endpoint
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        argv.push("--gateway-endpoint".to_string());
        argv.push(endpoint.trim().to_string());
    }
    argv
}

pub async fn run_openshell_cli(input: Value) -> NativeResult<Value> {
    let config_value = input
        .get("config")
        .cloned()
        .unwrap_or_else(|| input.clone());
    let config: OpenShellConfig = serde_json::from_value(config_value)?;
    let args = input
        .get("args")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_input("args required"))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .ok_or_else(|| invalid_input("args entries must be strings"))
        })
        .collect::<NativeResult<Vec<_>>>()?;
    let timeout_ms = input
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .or_else(|| config.timeout_seconds.map(|seconds| seconds * 1000))
        .unwrap_or(60_000)
        .max(200);
    let mut argv = build_openshell_base_argv(&config);
    argv.extend(args);
    let Some(command_name) = argv.first() else {
        return Err(invalid_input("command is required"));
    };
    let mut command = Command::new(command_name);
    command.args(&argv[1..]);
    if let Some(cwd) = input
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        command.current_dir(cwd);
    }
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| runtime_error("failed to capture openshell stdout"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| runtime_error("failed to capture openshell stderr"))?;
    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let result = timeout(Duration::from_millis(timeout_ms), async {
        let wait = async { child.wait().await };
        let read_stdout = async {
            stdout.read_to_end(&mut stdout_buf).await?;
            Ok::<_, std::io::Error>(())
        };
        let read_stderr = async {
            stderr.read_to_end(&mut stderr_buf).await?;
            Ok::<_, std::io::Error>(())
        };
        let (status, _, _) = tokio::try_join!(wait, read_stdout, read_stderr)?;
        Ok::<_, std::io::Error>(status)
    })
    .await;
    let status = match result {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => return Err(error.into()),
        Err(_) => {
            return Ok(json!({
                "code": 1,
                "stdout": "",
                "stderr": format!("command timed out after {timeout_ms}ms")
            }));
        }
    };
    Ok(json!({
        "code": status.code().unwrap_or(1),
        "stdout": String::from_utf8_lossy(&stdout_buf),
        "stderr": String::from_utf8_lossy(&stderr_buf)
    }))
}

pub async fn handle_openshell(operation: &str, input: Value) -> NativeResult<Value> {
    match operation {
        "shell-escape" => {
            let value = input
                .get("value")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid_input("value required"))?;
            Ok(json!({ "value": shell_escape(value) }))
        }
        "remote-command" => {
            let argv = input
                .get("argv")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid_input("argv required"))?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(ToString::to_string)
                        .ok_or_else(|| invalid_input("argv entries must be strings"))
                })
                .collect::<NativeResult<Vec<_>>>()?;
            Ok(json!({ "command": build_remote_command(&argv) }))
        }
        "base-argv" => {
            let config: OpenShellConfig = serde_json::from_value(input)?;
            Ok(json!({ "argv": build_openshell_base_argv(&config) }))
        }
        "run-cli" => run_openshell_cli(input).await,
        other => Err(invalid_input(format!(
            "Unsupported openshell operation: {other}"
        ))),
    }
}

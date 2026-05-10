use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

use crate::error::{invalid_input, runtime_error, NativeResult};

pub fn parse_lobster_envelope(stdout: &str) -> NativeResult<Value> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(invalid_input("lobster returned empty output"));
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return validate_envelope(value);
    }
    for index in trimmed
        .match_indices(['{', '['])
        .map(|(index, _)| index)
        .rev()
    {
        if let Ok(value) = serde_json::from_str::<Value>(&trimmed[index..]) {
            return validate_envelope(value);
        }
    }
    Err(invalid_input("lobster returned invalid JSON"))
}

fn validate_envelope(value: Value) -> NativeResult<Value> {
    match value.get("ok").and_then(Value::as_bool) {
        Some(_) => Ok(value),
        None => Err(invalid_input("lobster returned invalid JSON envelope")),
    }
}

fn build_lobster_argv(action: &str, params: &Value) -> NativeResult<Vec<String>> {
    match action {
        "run" => {
            let pipeline = params
                .get("pipeline")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| invalid_input("pipeline required"))?;
            let mut argv = vec![
                "run".to_string(),
                "--mode".to_string(),
                "tool".to_string(),
                pipeline.to_string(),
            ];
            if let Some(args_json) = params
                .get("argsJson")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                argv.push("--args-json".to_string());
                argv.push(args_json.to_string());
            }
            Ok(argv)
        }
        "resume" => {
            let token = params
                .get("token")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| invalid_input("token required"))?;
            let approve = params
                .get("approve")
                .and_then(Value::as_bool)
                .ok_or_else(|| invalid_input("approve required"))?;
            Ok(vec![
                "resume".to_string(),
                "--token".to_string(),
                token.to_string(),
                "--approve".to_string(),
                if approve { "yes" } else { "no" }.to_string(),
            ])
        }
        other => Err(invalid_input(format!("Unknown action: {other}"))),
    }
}

pub async fn execute_lobster(input: Value) -> NativeResult<Value> {
    let params = input
        .get("params")
        .cloned()
        .unwrap_or_else(|| input.clone());
    let action = params
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid_input("action required"))?;
    let exec_path = input
        .get("execPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("lobster");
    let cwd = input.get("cwd").and_then(Value::as_str);
    let timeout_ms = params
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(20_000)
        .max(200);
    let max_stdout_bytes = params
        .get("maxStdoutBytes")
        .and_then(Value::as_u64)
        .unwrap_or(512_000)
        .max(1024) as usize;

    let mut command = TokioCommand::new(exec_path);
    command.args(build_lobster_argv(action, &params)?);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command.env("LOBSTER_MODE", "tool");
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command.spawn()?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| runtime_error("failed to capture lobster stdout"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| runtime_error("failed to capture lobster stderr"))?;
    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();

    let wait = async {
        let status = child.wait().await?;
        Ok::<_, std::io::Error>(status)
    };
    let read_stdout = async {
        stdout.read_to_end(&mut stdout_buf).await?;
        Ok::<_, std::io::Error>(())
    };
    let read_stderr = async {
        stderr.read_to_end(&mut stderr_buf).await?;
        Ok::<_, std::io::Error>(())
    };
    let result = timeout(Duration::from_millis(timeout_ms), async {
        let (status, _, _) = tokio::try_join!(wait, read_stdout, read_stderr)?;
        Ok::<_, std::io::Error>(status)
    })
    .await;

    let status = match result {
        Ok(Ok(status)) => status,
        Ok(Err(err)) => return Err(err.into()),
        Err(_) => return Err(runtime_error("lobster subprocess timed out")),
    };
    if stdout_buf.len() > max_stdout_bytes {
        return Err(runtime_error("lobster output exceeded maxStdoutBytes"));
    }
    let stdout_text = String::from_utf8_lossy(&stdout_buf);
    let stderr_text = String::from_utf8_lossy(&stderr_buf);
    if !status.success() {
        return Err(runtime_error(format!(
            "lobster failed ({}): {}",
            status
                .code()
                .map_or("?".to_string(), |code| code.to_string()),
            stderr_text.trim()
        )));
    }
    let envelope = parse_lobster_envelope(&stdout_text)?;
    Ok(json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&envelope)? }],
        "details": envelope
    }))
}

#[allow(dead_code)]
fn _elapsed_ms(start: Instant) -> u128 {
    start.elapsed().as_millis()
}

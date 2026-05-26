use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Map, Value};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::{invalid_input, runtime_error, NativeResult};

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const DEFAULT_TIMEOUT_SECONDS: u64 = 300;
const MAX_ERROR_BYTES: usize = 2000;

#[derive(Clone, Debug)]
struct McpCommandSpec {
    program: String,
    args: Vec<String>,
    server_name: &'static str,
}

#[derive(Clone, Debug)]
struct MinimaxMcpRequest {
    tool_name: &'static str,
    command: McpCommandSpec,
    arguments: Value,
    timeout_seconds: u64,
    runtime_root: Option<PathBuf>,
}

pub async fn handle_minimax_mcp(operation: &str, input: Value) -> NativeResult<Value> {
    let request = minimax_mcp_request(operation, &input)?;
    let response = call_mcp_tool(request).await?;
    Ok(minimax_tool_envelope(operation, response)?)
}

fn minimax_mcp_request(operation: &str, input: &Value) -> NativeResult<MinimaxMcpRequest> {
    let (tool_name, command) = match operation {
        "text_to_image" => ("text_to_image", minimax_generation_command()),
        "generate_video" => ("generate_video", minimax_generation_command()),
        "image_to_video" => ("image_to_video", minimax_generation_command()),
        "understand_image" => ("understand_image", minimax_coding_plan_command()),
        other => {
            return Err(invalid_input(format!(
                "Unsupported MiniMax MCP operation: {other}"
            )));
        }
    };
    Ok(MinimaxMcpRequest {
        tool_name,
        command,
        arguments: mcp_tool_arguments(tool_name, input),
        timeout_seconds: timeout_seconds(input),
        runtime_root: runtime_root(input),
    })
}

fn minimax_generation_command() -> McpCommandSpec {
    McpCommandSpec {
        program: "npx".to_string(),
        args: vec!["-y".to_string(), "minimax-mcp-js".to_string()],
        server_name: "minimax-mcp-js",
    }
}

fn minimax_coding_plan_command() -> McpCommandSpec {
    McpCommandSpec {
        program: "uvx".to_string(),
        args: vec!["minimax-coding-plan-mcp".to_string(), "-y".to_string()],
        server_name: "minimax-coding-plan-mcp",
    }
}

fn mcp_tool_arguments(tool_name: &str, input: &Value) -> Value {
    let source = input
        .get("params")
        .filter(|value| value.is_object())
        .unwrap_or(input);
    let Some(object) = source.as_object() else {
        return json!({});
    };
    let mut arguments = Map::new();
    for (key, value) in object {
        if matches!(
            key.as_str(),
            "pluginConfig" | "timeoutMs" | "timeoutSeconds" | "mcp" | "workspaceDir"
        ) {
            continue;
        }
        arguments.insert(key.clone(), value.clone());
    }
    if tool_name == "understand_image" && !arguments.contains_key("image_source") {
        if let Some(value) = arguments
            .remove("image_url")
            .or_else(|| arguments.remove("imageUrl"))
        {
            arguments.insert("image_source".to_string(), value);
        }
    }
    if matches!(tool_name, "generate_video" | "image_to_video")
        && !arguments.contains_key("async_mode")
    {
        if let Some(value) = arguments.remove("asyncMode") {
            arguments.insert("async_mode".to_string(), value);
        }
    }
    Value::Object(arguments)
}

fn timeout_seconds(input: &Value) -> u64 {
    input
        .get("timeoutSeconds")
        .or_else(|| input.pointer("/params/timeoutSeconds"))
        .and_then(Value::as_u64)
        .or_else(|| {
            input
                .get("timeoutMs")
                .or_else(|| input.pointer("/params/timeoutMs"))
                .and_then(Value::as_u64)
                .map(|value| value.div_ceil(1000))
        })
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
        .clamp(1, 1800)
}

fn runtime_root(input: &Value) -> Option<PathBuf> {
    input
        .pointer("/pluginConfig/runtimeRoot")
        .and_then(Value::as_str)
        .map(PathBuf::from)
}

async fn call_mcp_tool(request: MinimaxMcpRequest) -> NativeResult<Value> {
    let mut command = Command::new(&request.command.program);
    command.args(&request.command.args);
    configure_minimax_environment(&mut command, request.runtime_root.as_deref());
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            runtime_error(format!(
                "{} requires `{}` on PATH.",
                request.command.server_name, request.command.program
            ))
        } else {
            runtime_error(format!(
                "failed to start {}: {error}",
                request.command.server_name
            ))
        }
    })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| runtime_error("MiniMax MCP stdin is unavailable"))?;
    let payload = mcp_messages(request.tool_name, request.arguments);
    stdin.write_all(payload.as_bytes()).await?;
    drop(stdin);

    let output = match tokio::time::timeout(
        Duration::from_secs(request.timeout_seconds),
        child.wait_with_output(),
    )
    .await
    {
        Ok(output) => output?,
        Err(_) => {
            return Err(runtime_error(format!(
                "{} timed out after {} seconds",
                request.command.server_name, request.timeout_seconds
            )));
        }
    };
    parse_mcp_tool_output(&output.stdout, &output.stderr, request.tool_name)
}

fn configure_minimax_environment(command: &mut Command, runtime_root: Option<&Path>) {
    command.env(
        "PATH",
        extended_tool_path(
            std::env::var_os("PATH"),
            std::env::var_os("HOME").map(PathBuf::from),
        ),
    );
    if std::env::var_os("MINIMAX_API_HOST").is_none() {
        let host = std::env::var("MINIMAX_BASE_URL")
            .ok()
            .and_then(|value| normalize_minimax_api_host(&value))
            .unwrap_or_else(|| "https://api.minimax.io".to_string());
        command.env("MINIMAX_API_HOST", host);
    }
    if std::env::var_os("MINIMAX_API_RESOURCE_MODE").is_none() {
        command.env("MINIMAX_API_RESOURCE_MODE", "local");
    }
    if std::env::var_os("MINIMAX_MCP_BASE_PATH").is_none() {
        if let Some(root) = runtime_root {
            let output_root = root.join(".crawclaw").join("minimax-mcp");
            let _ = std::fs::create_dir_all(&output_root);
            command.env("MINIMAX_MCP_BASE_PATH", output_root);
        }
    }
}

fn extended_tool_path(current: Option<OsString>, home: Option<PathBuf>) -> OsString {
    let mut dirs = current
        .as_ref()
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    for path in supplemental_tool_paths(home.as_deref()) {
        if !dirs.iter().any(|entry| entry == &path) {
            dirs.push(path);
        }
    }
    std::env::join_paths(&dirs).unwrap_or_else(|_| current.unwrap_or_default())
}

fn supplemental_tool_paths(home: Option<&Path>) -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = home {
        paths.push(home.join(".local").join("bin"));
        paths.push(home.join(".cargo").join("bin"));
        let python_root = home.join("Library").join("Python");
        if let Ok(entries) = std::fs::read_dir(python_root) {
            for entry in entries.flatten() {
                let bin_dir = entry.path().join("bin");
                if bin_dir.is_dir() {
                    paths.push(bin_dir);
                }
            }
        }
    }
    paths
}

fn normalize_minimax_api_host(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    for suffix in ["/anthropic", "/v1"] {
        if let Some(host) = trimmed.strip_suffix(suffix) {
            return Some(host.to_string());
        }
    }
    Some(trimmed.to_string())
}

fn mcp_messages(tool_name: &str, arguments: Value) -> String {
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": "crawclaw-desktop",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    });
    let initialized = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    });
    let call = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    });
    format!("{initialize}\n{initialized}\n{call}\n")
}

fn parse_mcp_tool_output(stdout: &[u8], stderr: &[u8], tool_name: &str) -> NativeResult<Value> {
    let stdout_text = String::from_utf8_lossy(stdout);
    let mut last_json_error = None;
    for line in stdout_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with('{') {
            continue;
        }
        match serde_json::from_str::<Value>(trimmed) {
            Ok(value) if value.get("id").and_then(Value::as_u64) == Some(2) => {
                if let Some(error) = value.get("error") {
                    return Err(runtime_error(format!(
                        "MiniMax MCP {tool_name} failed: {}",
                        truncate(&error.to_string())
                    )));
                }
                return value
                    .get("result")
                    .cloned()
                    .ok_or_else(|| runtime_error("MiniMax MCP response missing result"));
            }
            Ok(_) => {}
            Err(error) => last_json_error = Some(error.to_string()),
        }
    }
    let stderr_text = String::from_utf8_lossy(stderr);
    Err(runtime_error(format!(
        "MiniMax MCP {tool_name} did not return a tool response. stderr: {}{}",
        truncate(stderr_text.trim()),
        last_json_error
            .map(|error| format!("; parse error: {error}"))
            .unwrap_or_default()
    )))
}

fn minimax_tool_envelope(operation: &str, response: Value) -> NativeResult<Value> {
    if response.get("isError").and_then(Value::as_bool) == Some(true) {
        return Err(runtime_error(format!(
            "MiniMax MCP {operation} returned an error: {}",
            truncate(&mcp_content_text(&response).unwrap_or_else(|| response.to_string()))
        )));
    }
    if let Some(text) = mcp_content_text(&response).filter(|text| {
        let trimmed = text.trim_start();
        trimmed.starts_with("Failed to ") || trimmed.contains("API Error:")
    }) {
        return Err(runtime_error(format!(
            "MiniMax MCP {operation} returned an error: {}",
            truncate(&text)
        )));
    }
    Ok(json!({
        "provider": "minimax-mcp",
        "tool": operation,
        "text": mcp_content_text(&response),
        "result": response
    }))
}

fn mcp_content_text(value: &Value) -> Option<String> {
    let content = value.get("content")?.as_array()?;
    let text = content
        .iter()
        .filter_map(|entry| entry.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
}

fn truncate(value: &str) -> String {
    if value.len() <= MAX_ERROR_BYTES {
        value.to_string()
    } else {
        let truncated = value.chars().take(MAX_ERROR_BYTES).collect::<String>();
        format!("{truncated}...")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimax_arguments_strip_host_only_fields() {
        let input = json!({
            "prompt": "draw",
            "n": 1,
            "timeoutSeconds": 5,
            "workspaceDir": "/tmp/root",
            "pluginConfig": { "runtimeRoot": "/tmp/root" },
            "mcp": { "debug": true }
        });
        assert_eq!(
            mcp_tool_arguments("text_to_image", &input),
            json!({
                "prompt": "draw",
                "n": 1
            })
        );
    }

    #[test]
    fn understand_image_arguments_accept_image_url_alias() {
        let input = json!({
            "prompt": "describe",
            "image_url": "https://example.test/image.png"
        });
        assert_eq!(
            mcp_tool_arguments("understand_image", &input),
            json!({
                "prompt": "describe",
                "image_source": "https://example.test/image.png"
            })
        );
    }

    #[test]
    fn video_arguments_accept_async_mode_alias() {
        let input = json!({
            "prompt": "animate",
            "asyncMode": true
        });
        assert_eq!(
            mcp_tool_arguments("generate_video", &input),
            json!({
                "prompt": "animate",
                "async_mode": true
            })
        );
    }

    #[test]
    fn minimax_tool_path_adds_common_gui_missing_bins() {
        let path = extended_tool_path(
            Some(OsString::from("/bin:/usr/bin")),
            Some(PathBuf::from("/Users/example")),
        );
        let dirs = std::env::split_paths(&path).collect::<Vec<_>>();
        assert_eq!(dirs.first(), Some(&PathBuf::from("/bin")));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/Users/example/.local/bin")));
        assert!(dirs.contains(&PathBuf::from("/Users/example/.cargo/bin")));
    }

    #[test]
    fn parse_mcp_output_ignores_npm_noise() {
        let stdout = br#"npm warn Unknown project config
{"jsonrpc":"2.0","id":1,"result":{"ok":true}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"done"}],"isError":false}}
"#;
        let result = parse_mcp_tool_output(stdout, b"", "text_to_image").expect("mcp output");
        assert_eq!(mcp_content_text(&result).as_deref(), Some("done"));
    }

    #[test]
    fn minimax_envelope_treats_failed_tool_text_as_error() {
        let response = json!({
            "content": [{
                "type": "text",
                "text": "Failed to generate video: API Error: usage limit exceeded"
            }]
        });
        let error = minimax_tool_envelope("generate_video", response)
            .expect_err("failed tool text should be an error");
        assert_eq!(error.code(), "runtime_error");
    }

    #[test]
    fn minimax_base_url_is_normalized_to_api_host() {
        assert_eq!(
            normalize_minimax_api_host("https://api.minimax.io/anthropic").as_deref(),
            Some("https://api.minimax.io")
        );
        assert_eq!(
            normalize_minimax_api_host("https://api.minimaxi.com/v1").as_deref(),
            Some("https://api.minimaxi.com")
        );
    }
}

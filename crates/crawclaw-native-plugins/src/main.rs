use std::io::{self, BufRead, Read};

use clap::Parser;
use crawclaw_native_plugins::envelope::NativeEnvelope;
use crawclaw_native_plugins::registry::{
    builtin_native_plugin_descriptors, dispatch_builtin_native_plugin_operation,
    dispatch_builtin_native_service_lifecycle, find_builtin_native_plugin_descriptor,
};
use crawclaw_native_plugins::{NativeError, NativeResult};
use crawclaw_plugin_sdk::{
    NativeDescribeRequest, NativeDescribeResponse, NativeInvocationRequest,
    NativeInvocationResponse, NativeJsonRpcRequest, NativeJsonRpcResponse, NativePluginError,
    NativeServiceLifecycleRequest, NATIVE_PLUGIN_JSONRPC_VERSION,
};
use serde_json::{json, Value};

#[derive(Debug, Parser)]
#[command(name = "crawclaw-native-plugins")]
#[command(about = "Rust native runtime for selected CrawClaw bundled plugins")]
struct Cli {
    #[arg(long)]
    jsonrpc: bool,
    plugin: Option<String>,
    operation: Option<String>,
}

fn read_stdin_json() -> NativeResult<Value> {
    let mut raw = String::new();
    io::stdin().read_to_string(&mut raw)?;
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    Ok(serde_json::from_str(&raw)?)
}

async fn dispatch(cli: &Cli, input: Value) -> NativeResult<Value> {
    let plugin = cli
        .plugin
        .as_deref()
        .ok_or_else(|| NativeError::InvalidInput("missing plugin argument".to_string()))?;
    let operation = cli
        .operation
        .as_deref()
        .ok_or_else(|| NativeError::InvalidInput("missing operation argument".to_string()))?;
    dispatch_builtin_native_plugin_operation(plugin, operation, input).await
}

fn json_rpc_error(
    id: Value,
    code: impl Into<String>,
    message: impl Into<String>,
) -> NativeJsonRpcResponse {
    NativeJsonRpcResponse {
        jsonrpc: NATIVE_PLUGIN_JSONRPC_VERSION.to_string(),
        id,
        result: None,
        error: Some(NativePluginError {
            code: code.into(),
            message: message.into(),
            details: None,
        }),
    }
}

fn json_rpc_result(id: Value, result: Value) -> NativeJsonRpcResponse {
    NativeJsonRpcResponse {
        jsonrpc: NATIVE_PLUGIN_JSONRPC_VERSION.to_string(),
        id,
        result: Some(result),
        error: None,
    }
}

fn native_error_response(id: Value, error: NativeError) -> NativeJsonRpcResponse {
    json_rpc_error(id, error.code(), error.to_string())
}

async fn handle_json_rpc_request(request: NativeJsonRpcRequest) -> NativeJsonRpcResponse {
    let id = request.id.clone();
    match request.method.as_str() {
        "plugin.describe" => {
            let params = serde_json::from_value::<NativeDescribeRequest>(request.params)
                .unwrap_or(NativeDescribeRequest { plugin_id: None });
            let descriptors = if let Some(plugin_id) = params.plugin_id {
                match find_builtin_native_plugin_descriptor(&plugin_id) {
                    Some(descriptor) => vec![descriptor],
                    None => {
                        return json_rpc_error(
                            id,
                            "plugin_not_found",
                            format!("Unknown native plugin: {plugin_id}"),
                        )
                    }
                }
            } else {
                builtin_native_plugin_descriptors()
            };
            json_rpc_result(
                id,
                serde_json::to_value(NativeDescribeResponse { descriptors })
                    .unwrap_or_else(|error| json!({ "serializationError": error.to_string() })),
            )
        }
        "plugin.invoke" => {
            match serde_json::from_value::<NativeInvocationRequest>(request.params) {
                Ok(params) => match dispatch_builtin_native_plugin_operation(
                    &params.target.plugin_id,
                    &params.target.operation,
                    params.input,
                )
                .await
                {
                    Ok(output) => json_rpc_result(
                        id,
                        serde_json::to_value(NativeInvocationResponse { output }).unwrap_or_else(
                            |error| json!({ "serializationError": error.to_string() }),
                        ),
                    ),
                    Err(error) => native_error_response(id, error),
                },
                Err(error) => json_rpc_error(id, "invalid_input", error.to_string()),
            }
        }
        "plugin.service.start" | "plugin.service.stop" => {
            match serde_json::from_value::<NativeServiceLifecycleRequest>(request.params) {
                Ok(params) => match dispatch_builtin_native_service_lifecycle(
                    &params.plugin_id,
                    &params.service_id,
                    request.method == "plugin.service.start",
                    params.input,
                )
                .await
                {
                    Ok(output) => json_rpc_result(
                        id,
                        serde_json::to_value(NativeInvocationResponse { output }).unwrap_or_else(
                            |error| json!({ "serializationError": error.to_string() }),
                        ),
                    ),
                    Err(error) => native_error_response(id, error),
                },
                Err(error) => json_rpc_error(id, "invalid_input", error.to_string()),
            }
        }
        method => json_rpc_error(id, "method_not_found", format!("Unknown method: {method}")),
    }
}

async fn run_json_rpc_loop() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) if line.trim().is_empty() => continue,
            Ok(line) => line,
            Err(error) => {
                let response = json_rpc_error(Value::Null, "io_error", error.to_string());
                println!(
                    "{}",
                    serde_json::to_string(&response).unwrap_or_else(|_| "{}".into())
                );
                continue;
            }
        };
        let response = match serde_json::from_str::<NativeJsonRpcRequest>(&line) {
            Ok(request) => handle_json_rpc_request(request).await,
            Err(error) => json_rpc_error(Value::Null, "parse_error", error.to_string()),
        };
        println!(
            "{}",
            serde_json::to_string(&response).unwrap_or_else(|error| {
                format!(
                    "{{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{{\"code\":\"serialization_failed\",\"message\":{}}}}}",
                    serde_json::to_string(&error.to_string())
                        .unwrap_or_else(|_| "\"unknown\"".to_string())
                )
            })
        );
    }
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    if cli.jsonrpc {
        run_json_rpc_loop().await;
        return;
    }
    let envelope = match read_stdin_json() {
        Ok(input) => match dispatch(&cli, input).await {
            Ok(result) => NativeEnvelope::ok(result),
            Err(error) => NativeEnvelope::err(error),
        },
        Err(error) => NativeEnvelope::err(error),
    };
    println!(
        "{}",
        serde_json::to_string(&envelope).unwrap_or_else(|error| {
            format!(
                "{{\"ok\":false,\"code\":\"serialization_failed\",\"message\":{}}}",
                serde_json::to_string(&error.to_string())
                    .unwrap_or_else(|_| "\"unknown\"".to_string())
            )
        })
    );
}

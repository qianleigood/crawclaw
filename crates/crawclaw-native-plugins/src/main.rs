use std::io::{self, Read};

use clap::Parser;
use crawclaw_native_plugins::comfyui::handle_comfyui;
use crawclaw_native_plugins::envelope::{to_value, NativeEnvelope};
use crawclaw_native_plugins::llm_task::{complete_llm_task, prepare_llm_task, LlmTaskPrepareInput};
use crawclaw_native_plugins::lobster::execute_lobster;
use crawclaw_native_plugins::open_prose::describe_open_prose;
use crawclaw_native_plugins::openshell::handle_openshell;
use crawclaw_native_plugins::qwen3_tts::{build_synthesis_payload, synthesize_qwen3_tts};
use crawclaw_native_plugins::web::{run_open_websearch_search, run_scrapling_fetch};
use crawclaw_native_plugins::{NativeError, NativeResult};
use serde_json::{json, Value};

#[derive(Debug, Parser)]
#[command(name = "crawclaw-native-plugins")]
#[command(about = "Rust native runtime for selected CrawClaw bundled plugins")]
struct Cli {
    plugin: String,
    operation: String,
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
    match (cli.plugin.as_str(), cli.operation.as_str()) {
        ("open-prose", "describe") => Ok(describe_open_prose()),
        ("llm-task", "prepare") => {
            let prepared = prepare_llm_task(serde_json::from_value::<LlmTaskPrepareInput>(input)?)?;
            Ok(to_value(prepared)?)
        }
        ("llm-task", "complete") => complete_llm_task(input),
        ("lobster", "execute") => execute_lobster(input).await,
        ("openshell", operation) => handle_openshell(operation, input).await,
        ("comfyui", operation) => handle_comfyui(operation, input).await,
        ("qwen3-tts", "build-synthesis-payload") => build_synthesis_payload(&input),
        ("qwen3-tts", "synthesize") => synthesize_qwen3_tts(input).await,
        ("open-websearch", "search") => run_open_websearch_search(input).await,
        ("scrapling-fetch", "fetch") => run_scrapling_fetch(input).await,
        (plugin, operation) => Err(NativeError::InvalidInput(format!(
            "Unsupported native plugin operation: {plugin} {operation}"
        ))),
    }
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
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

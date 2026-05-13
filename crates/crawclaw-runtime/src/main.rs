use std::env;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct WorkerRequest {
    id: Option<Value>,
    tool: String,
    #[serde(default)]
    input: Value,
    #[serde(default, rename = "runtimeRoot")]
    runtime_root: Option<PathBuf>,
}

#[tokio::main]
async fn main() {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        print_help();
        return;
    }
    if args[0] == "--version" || args[0] == "-V" {
        println!("crawclaw-runtime {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if args[0] == "--worker" {
        run_worker().await;
        return;
    }

    match args.remove(0).as_str() {
        "status" => status(&args),
        "tool" => run_tool(args).await,
        command => {
            eprintln!("unsupported crawclaw-runtime command: {command}");
            std::process::exit(2);
        }
    }
}

fn status(args: &[String]) {
    if args.iter().any(|arg| arg == "--json") {
        println!(
            "{}",
            json!({
                "ok": true,
                "runtime": "ready",
                "implementation": "rust-native",
                "tools": crawclaw_runtime::pi_agent_rust_tool_names()
            })
        );
        return;
    }
    println!("CrawClaw Rust runtime: ready");
}

async fn run_tool(args: Vec<String>) {
    let Some(tool) = args.first() else {
        eprintln!("usage: crawclaw-runtime tool <name> [json-input]");
        std::process::exit(2);
    };
    let input = match args.get(1) {
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("invalid tool input JSON: {error}");
                std::process::exit(2);
            }
        },
        None => json!({}),
    };
    match crawclaw_runtime::execute_rust_core_tool(&runtime_root(), tool, input).await {
        Ok(result) => println!("{}", json!({ "ok": true, "result": result })),
        Err(message) => {
            println!("{}", json!({ "ok": false, "message": message }));
            std::process::exit(1);
        }
    }
}

async fn run_worker() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({ "ok": false, "message": format!("failed to read worker request: {error}") })
                );
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<WorkerRequest>(&line) {
            Ok(request) => request,
            Err(error) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({ "ok": false, "message": format!("invalid worker request: {error}") })
                );
                continue;
            }
        };
        let root = request.runtime_root.unwrap_or_else(runtime_root);
        let result = if request.tool == "message_policy" {
            crawclaw_runtime::execute_message_policy_operation(request.input)
        } else if request.tool == "agent_run_turn" {
            crawclaw_runtime::execute_agent_run_turn_operation(&root, request.input).await
        } else {
            crawclaw_runtime::execute_rust_core_tool(&root, &request.tool, request.input).await
        };
        let response = match result {
            Ok(result) => json!({ "id": request.id, "ok": true, "result": result }),
            Err(message) => {
                json!({ "id": request.id, "ok": false, "code": "TOOL_FAILED", "message": message })
            }
        };
        let _ = writeln!(stdout, "{response}");
        let _ = stdout.flush();
    }
}

fn runtime_root() -> PathBuf {
    if let Some(value) = env::var_os("CRAWCLAW_RUNTIME_ROOT").filter(|value| !value.is_empty()) {
        return PathBuf::from(value);
    }
    let state_dir = env::var_os("CRAWCLAW_STATE_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".crawclaw")
        });
    state_dir.join("runtime").join("crawclaw")
}

fn print_help() {
    println!("Usage: crawclaw-runtime --worker | status [--json] | tool <name> [json-input]");
}

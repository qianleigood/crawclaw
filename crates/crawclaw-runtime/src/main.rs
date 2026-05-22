use std::env;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::Command;

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
        "stage" => stage(args),
        "tool" => run_tool(args).await,
        command => delegate_legacy_repo_tool_command(command, args),
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
                "tools": crawclaw_runtime::pi_agent_rust_tool_names(),
                "toolCatalog": crawclaw_runtime::rust_tool_catalog_json_payload()
            })
        );
        return;
    }
    println!("CrawClaw Rust runtime: ready");
}

fn stage(args: Vec<String>) {
    if args.len() != 2 || args[0] != "--output" {
        eprintln!("usage: crawclaw-runtime stage --output <dir>");
        std::process::exit(2);
    }
    if let Err(error) = crawclaw_runtime::stage_desktop_runtime_manifests(&PathBuf::from(&args[1]))
    {
        eprintln!("{error}");
        std::process::exit(1);
    }
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
        } else if matches!(
            request.tool.as_str(),
            "agent_run_turn"
                | "agent.command.run"
                | "agent_command_run"
                | "autoReply.run"
                | "auto_reply.run"
                | "auto_reply_run"
        ) {
            crawclaw_runtime::execute_agent_run_turn_operation(&root, request.input).await
        } else if request.tool.starts_with("memory.")
            || request.tool.starts_with("memory_")
            || request.tool == "memory"
        {
            crawclaw_runtime::execute_memory_runtime_operation(&root, &request.tool, request.input)
                .await
        } else if request.tool == "wake"
            || request.tool.starts_with("cron.")
            || request.tool.starts_with("cron_")
            || request.tool == "cron"
        {
            crawclaw_runtime::execute_cron_runtime_operation(&root, &request.tool, request.input)
                .await
        } else if request.tool == "native_plugin_invoke" {
            crawclaw_runtime::execute_native_plugin_invoke_operation(&root, request.input).await
        } else if request.tool == "native_plugin_service_start" {
            let mut input = request.input;
            if let Value::Object(object) = &mut input {
                object.insert("start".to_string(), json!(true));
            }
            crawclaw_runtime::execute_native_plugin_service_lifecycle_operation(&root, input).await
        } else if request.tool == "native_plugin_service_stop" {
            let mut input = request.input;
            if let Value::Object(object) = &mut input {
                object.insert("start".to_string(), json!(false));
            }
            crawclaw_runtime::execute_native_plugin_service_lifecycle_operation(&root, input).await
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

fn delegate_legacy_repo_tool_command(command: &str, args: Vec<String>) {
    if !is_legacy_repo_tool_command(command) {
        eprintln!("unsupported crawclaw-runtime command: {command}");
        std::process::exit(2);
    }

    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let status = Command::new(cargo)
        .args(["run", "-q", "-p", "crawclaw-repo-tools", "--", command])
        .args(args)
        .status();
    match status {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!(
                "failed to delegate legacy crawclaw-runtime command to crawclaw-repo-tools: {error}"
            );
            std::process::exit(1);
        }
    }
}

fn is_legacy_repo_tool_command(command: &str) -> bool {
    matches!(
        command,
        "desktop-check"
            | "desktop-stage"
            | "docs-list"
            | "emit-bundled-capability-metadata"
            | "emit-bundled-provider-auth-env-vars"
            | "emit-config-doc-baseline"
            | "emit-provider-model-normalization"
            | "emit-provider-runtime-constants"
            | "emit-plugin-dependency-plan"
            | "emit-rust-tool-catalog"
            | "ghsa-patch"
            | "github-labels-sync"
            | "npm-package-metadata"
            | "npm-postpublish-verify"
            | "npm-publish-plan"
            | "npm-release-check"
            | "package-artifacts"
            | "package-build-native-artifacts"
            | "package-postbuild"
            | "package-prepack"
            | "package-release-check"
            | "package-write-build-metadata"
            | "plugin-npm-release-check"
            | "plugin-npm-release-plan"
            | "plugins-sync"
            | "repo-check-no-conflict-markers"
            | "repo-check-no-extension-src-imports"
            | "repo-check-no-register-http-handler"
            | "repo-check-plugin-extension-import-boundary"
            | "repo-check-runtime-module-boundaries"
            | "repo-check-ts-loc"
            | "repo-check-web-fetch-provider-boundaries"
            | "repo-check-web-search-provider-boundaries"
            | "repo-check-webhook-auth-body-order"
            | "docs-check-i18n-glossary"
            | "docs-check-links"
            | "run-oxlint"
            | "run-tsgo"
            | "run-typecheck"
            | "test-workspace"
    )
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
    println!(
        "Usage: crawclaw-runtime --worker | status [--json] | stage --output <dir> | tool <name> [json-input]\n\nMaintainer commands moved to crawclaw-repo-tools. Legacy local invocations are delegated when run from a Cargo workspace."
    );
}

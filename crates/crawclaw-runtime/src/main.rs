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
        "desktop-check" => desktop_check(args),
        "desktop-stage" => desktop_stage(args),
        "emit-base-config-schema" => emit_base_config_schema(args),
        "emit-bundled-capability-metadata" => emit_bundled_capability_metadata(args),
        "emit-bundled-provider-auth-env-vars" => emit_bundled_provider_auth_env_vars(args),
        "emit-config-doc-baseline" => emit_config_doc_baseline(args),
        "emit-provider-model-normalization" => emit_provider_model_normalization(args),
        "emit-provider-runtime-constants" => emit_provider_runtime_constants(args),
        "package-artifacts" => package_artifacts(args),
        "package-postbuild" => package_postbuild(args),
        "status" => status(&args),
        "stage" => stage(args),
        "tool" => run_tool(args).await,
        command => {
            eprintln!("unsupported crawclaw-runtime command: {command}");
            std::process::exit(2);
        }
    }
}

fn emit_bundled_capability_metadata(args: Vec<String>) {
    let mut output: Option<PathBuf> = None;
    let mut check = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--check" => {
                check = true;
                index += 1;
            }
            "--write" => {
                index += 1;
            }
            "--output" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--output requires a value");
                    std::process::exit(2);
                };
                output = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                eprintln!("unsupported emit-bundled-capability-metadata option: {other}");
                std::process::exit(2);
            }
        }
    }
    let Some(output_path) = output else {
        eprintln!(
            "usage: crawclaw-runtime emit-bundled-capability-metadata --output <path> [--check|--write]"
        );
        std::process::exit(2);
    };
    match crawclaw_runtime::write_bundled_capability_metadata_module(&output_path, check) {
        Ok(result) => {
            if check {
                if result.changed {
                    eprintln!(
                        "[bundled-capability-metadata] stale generated output at {}",
                        result.output_path.display()
                    );
                    std::process::exit(1);
                }
            } else if result.wrote {
                println!(
                    "[bundled-capability-metadata] wrote {}",
                    result.output_path.display()
                );
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn emit_bundled_provider_auth_env_vars(args: Vec<String>) {
    let mut output: Option<PathBuf> = None;
    let mut check = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--check" => {
                check = true;
                index += 1;
            }
            "--write" => {
                index += 1;
            }
            "--output" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--output requires a value");
                    std::process::exit(2);
                };
                output = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                eprintln!("unsupported emit-bundled-provider-auth-env-vars option: {other}");
                std::process::exit(2);
            }
        }
    }
    let Some(output_path) = output else {
        eprintln!(
            "usage: crawclaw-runtime emit-bundled-provider-auth-env-vars --output <path> [--check|--write]"
        );
        std::process::exit(2);
    };
    match crawclaw_runtime::write_bundled_provider_auth_env_var_module(&output_path, check) {
        Ok(result) => {
            if check {
                if result.changed {
                    eprintln!(
                        "[bundled-provider-auth-env-vars] stale generated output at {}",
                        result.output_path.display()
                    );
                    std::process::exit(1);
                }
            } else if result.wrote {
                println!(
                    "[bundled-provider-auth-env-vars] wrote {}",
                    result.output_path.display()
                );
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn emit_provider_runtime_constants(args: Vec<String>) {
    let mut output: Option<PathBuf> = None;
    let mut check = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--check" => {
                check = true;
                index += 1;
            }
            "--write" => {
                index += 1;
            }
            "--output" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--output requires a value");
                    std::process::exit(2);
                };
                output = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                eprintln!("unsupported emit-provider-runtime-constants option: {other}");
                std::process::exit(2);
            }
        }
    }
    let Some(output_path) = output else {
        eprintln!(
            "usage: crawclaw-runtime emit-provider-runtime-constants --output <path> [--check|--write]"
        );
        std::process::exit(2);
    };
    match crawclaw_runtime::write_provider_runtime_constants_module(&output_path, check) {
        Ok(result) => {
            if check {
                if result.changed {
                    eprintln!(
                        "[provider-runtime-constants] stale generated output at {}",
                        result.output_path.display()
                    );
                    std::process::exit(1);
                }
            } else if result.wrote {
                println!(
                    "[provider-runtime-constants] wrote {}",
                    result.output_path.display()
                );
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn desktop_check(args: Vec<String>) {
    let root = match parse_root_arg(&args) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    let options = crawclaw_runtime::DesktopRuntimeCheckOptions::new(root);
    if let Err(error) = crawclaw_runtime::check_desktop_runtime_release_inputs(&options) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn desktop_stage(args: Vec<String>) {
    let root = match parse_root_arg(&args) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::stage_desktop_tauri_runtime(root) {
        Ok(paths) => println!(
            "Staged CrawClaw Tauri Desktop runtime at {}",
            paths.runtime_root.display()
        ),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn package_postbuild(args: Vec<String>) {
    let root = match parse_root_arg(&args) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    if let Err(error) = crawclaw_runtime::stage_package_postbuild(root) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn package_artifacts(args: Vec<String>) {
    let mut root: Option<PathBuf> = None;
    let mut json_output = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => {
                json_output = true;
                index += 1;
            }
            "--root" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--root requires a value");
                    std::process::exit(2);
                };
                root = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                eprintln!("unsupported package-artifacts option: {other}");
                std::process::exit(2);
            }
        }
    }
    let Some(root_dir) = root else {
        eprintln!("usage: crawclaw-runtime package-artifacts --root <repo-root> --json");
        std::process::exit(2);
    };
    if !json_output {
        eprintln!("usage: crawclaw-runtime package-artifacts --root <repo-root> --json");
        std::process::exit(2);
    }
    let bundled_plugin_pack_artifacts =
        match crawclaw_runtime::list_bundled_plugin_pack_artifacts(&root_dir) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        };
    let static_package_asset_outputs =
        match crawclaw_runtime::list_static_package_asset_outputs(&root_dir) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        };
    println!(
        "{}",
        json!({
            "bundledPluginPackArtifacts": bundled_plugin_pack_artifacts,
            "staticPackageAssetOutputs": static_package_asset_outputs,
        })
    );
}

fn parse_root_arg(args: &[String]) -> Result<PathBuf, String> {
    if args.len() != 2 || args[0] != "--root" {
        return Err(
            "usage: crawclaw-runtime desktop-stage|desktop-check|package-postbuild --root <repo-root>"
                .to_string(),
        );
    }
    Ok(PathBuf::from(&args[1]))
}

fn emit_base_config_schema(args: Vec<String>) {
    match run_emit_base_config_schema(args) {
        Ok(Some(payload)) => println!("{payload}"),
        Ok(None) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn run_emit_base_config_schema(args: Vec<String>) -> Result<Option<String>, String> {
    if args.len() == 2 && args[0] == "--generated-at" {
        return crawclaw_runtime::base_config_schema_payload_json(&args[1]).map(Some);
    }

    let mut output: Option<PathBuf> = None;
    let mut check = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--check" => {
                check = true;
                index += 1;
            }
            "--write" => {
                index += 1;
            }
            "--output" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("--output requires a value".to_string());
                };
                output = Some(PathBuf::from(value));
                index += 2;
            }
            other => return Err(format!("unsupported emit-base-config-schema option: {other}")),
        }
    }

    let Some(output_path) = output else {
        return Err(
            "usage: crawclaw-runtime emit-base-config-schema --generated-at <iso8601> | --output <path> [--check|--write]"
                .to_string(),
        );
    };
    let result = crawclaw_runtime::write_base_config_schema_artifact(&output_path, check)?;
    if check {
        if result.changed {
            return Err(format!(
                "[base-config-schema] stale generated output at {}",
                result.output_path.display()
            ));
        }
    } else if result.wrote {
        println!(
            "[base-config-schema] wrote {}",
            result.output_path.display()
        );
    }
    Ok(None)
}

fn emit_config_doc_baseline(args: Vec<String>) {
    match run_emit_config_doc_baseline(args) {
        Ok(()) => {}
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    }
}

fn run_emit_config_doc_baseline(args: Vec<String>) -> Result<(), String> {
    let mut json_output: Option<PathBuf> = None;
    let mut jsonl_output: Option<PathBuf> = None;
    let mut check = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--check" => {
                check = true;
                index += 1;
            }
            "--write" => {
                index += 1;
            }
            "--json-output" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "--json-output requires a value".to_string())?;
                json_output = Some(PathBuf::from(value));
                index += 2;
            }
            "--jsonl-output" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "--jsonl-output requires a value".to_string())?;
                jsonl_output = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                return Err(format!(
                    "unsupported emit-config-doc-baseline option: {other}"
                ))
            }
        }
    }
    let json_path =
        json_output.ok_or_else(|| "usage: crawclaw-runtime emit-config-doc-baseline --json-output <path> --jsonl-output <path> [--check|--write]".to_string())?;
    let jsonl_path =
        jsonl_output.ok_or_else(|| "usage: crawclaw-runtime emit-config-doc-baseline --json-output <path> --jsonl-output <path> [--check|--write]".to_string())?;
    let result =
        crawclaw_runtime::write_config_doc_baseline_artifacts(&json_path, &jsonl_path, check)?;
    if check {
        if result.changed {
            return Err([
                "Config baseline drift detected.".to_string(),
                format!("Expected current: {}", result.json_path.display()),
                format!("Expected current: {}", result.jsonl_path.display()),
                "If this config-surface change is intentional, run `pnpm config:docs:gen` and commit the updated baseline files.".to_string(),
                "If not intentional, treat this as docs drift or a possible breaking config change and fix the schema/help changes first.".to_string(),
            ].join("\n"));
        }
        println!(
            "OK {} {}",
            result.json_path.display(),
            result.jsonl_path.display()
        );
    } else {
        println!(
            "Wrote {}\nWrote {}",
            result.json_path.display(),
            result.jsonl_path.display()
        );
    }
    Ok(())
}

fn emit_provider_model_normalization(args: Vec<String>) {
    let mut output: Option<PathBuf> = None;
    let mut check = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--check" => {
                check = true;
                index += 1;
            }
            "--write" => {
                index += 1;
            }
            "--output" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--output requires a value");
                    std::process::exit(2);
                };
                output = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                eprintln!("unsupported emit-provider-model-normalization option: {other}");
                std::process::exit(2);
            }
        }
    }
    let Some(output) = output else {
        eprintln!(
            "usage: crawclaw-runtime emit-provider-model-normalization --output <path> [--check|--write]"
        );
        std::process::exit(2);
    };
    let metadata = crawclaw_providers::provider_model_normalization_metadata();
    let source = format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "anthropicModelAliases": metadata.anthropic_model_aliases,
            "googleModelAliases": metadata.google_model_aliases,
            "antigravityLowSuffixIds": metadata.antigravity_low_suffix_ids,
            "xaiModelAliases": metadata.xai_model_aliases,
        }))
        .expect("provider model normalization metadata encodes as JSON")
    );
    let current = match std::fs::read_to_string(&output) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            eprintln!(
                "failed to read provider model normalization artifact {}: {error}",
                output.display()
            );
            std::process::exit(1);
        }
    };
    let changed = current.as_deref() != Some(source.as_str());
    if check {
        if changed {
            eprintln!(
                "[provider-model-normalization] stale generated output at {}",
                output.display()
            );
            std::process::exit(1);
        }
        return;
    }
    if let Some(parent) = output.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            eprintln!(
                "failed to create provider model normalization output dir {}: {error}",
                parent.display()
            );
            std::process::exit(1);
        }
    }
    if changed {
        if let Err(error) = std::fs::write(&output, source) {
            eprintln!(
                "failed to write provider model normalization artifact {}: {error}",
                output.display()
            );
            std::process::exit(1);
        }
        println!("[provider-model-normalization] wrote {}", output.display());
    }
}

fn status(args: &[String]) {
    if args.iter().any(|arg| arg == "--json") {
        let native_tools = crawclaw_runtime::native_plugin_tool_descriptors()
            .into_iter()
            .map(|(plugin_id, descriptor)| {
                json!({
                    "id": descriptor.name,
                    "label": descriptor.label,
                    "description": descriptor.description,
                    "sectionId": "runtime",
                    "defaultProfiles": descriptor.default_profiles,
                    "lifecycle": "runtime_conditional",
                    "includeInCrawClawGroup": true,
                    "defaultEnabled": descriptor.default_enabled,
                    "readOnly": descriptor.read_only,
                    "status": "rust-native",
                    "source": "native-plugin",
                    "pluginId": plugin_id
                })
            })
            .collect::<Vec<_>>();
        println!(
            "{}",
            json!({
                "ok": true,
                "runtime": "ready",
                "implementation": "rust-native",
                "tools": crawclaw_runtime::pi_agent_rust_tool_names(),
                "toolCatalog": {
                    "sections": crawclaw_runtime::rust_core_tool_sections(),
                    "coreTools": crawclaw_runtime::rust_core_tool_definitions(),
                    "nativeTools": native_tools
                }
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
        "Usage: crawclaw-runtime --worker | status [--json] | stage --output <dir> | desktop-stage --root <repo-root> | desktop-check --root <repo-root> | emit-base-config-schema --generated-at <iso8601> | emit-bundled-capability-metadata --output <path> [--check|--write] | emit-bundled-provider-auth-env-vars --output <path> [--check|--write] | emit-config-doc-baseline --json-output <path> --jsonl-output <path> [--check|--write] | emit-provider-model-normalization --output <path> [--check|--write] | emit-provider-runtime-constants --output <path> [--check|--write] | package-artifacts --root <repo-root> --json | package-postbuild --root <repo-root> | tool <name> [json-input]"
    );
}

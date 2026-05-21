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
        println!("crawclaw-repo-tools {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if args[0] == "--worker" {
        run_worker().await;
        return;
    }

    match args.remove(0).as_str() {
        "desktop-check" => desktop_check(args),
        "desktop-stage" => desktop_stage(args),
        "docs-list" => docs_list(args),
        "emit-bundled-capability-metadata" => emit_bundled_capability_metadata(args),
        "emit-bundled-provider-auth-env-vars" => emit_bundled_provider_auth_env_vars(args),
        "emit-config-doc-baseline" => emit_config_doc_baseline(args),
        "emit-provider-model-normalization" => emit_provider_model_normalization(args),
        "emit-provider-runtime-constants" => emit_provider_runtime_constants(args),
        "emit-plugin-dependency-plan" => emit_plugin_dependency_plan(args),
        "emit-rust-tool-catalog" => emit_rust_tool_catalog(args),
        "ghsa-patch" => ghsa_patch(args),
        "github-labels-sync" => github_labels_sync(args),
        "npm-package-metadata" => npm_package_metadata(args),
        "npm-postpublish-verify" => npm_postpublish_verify(args),
        "npm-publish-plan" => npm_publish_plan(args),
        "npm-release-check" => npm_release_check(args),
        "package-artifacts" => package_artifacts(args),
        "package-build-native-artifacts" => package_build_native_artifacts(args),
        "package-postbuild" => package_postbuild(args),
        "package-prepack" => package_prepack(args),
        "package-release-check" => package_release_check(args),
        "package-write-build-metadata" => package_write_build_metadata(args),
        "plugin-npm-release-check" => plugin_npm_release_check(args),
        "plugin-npm-release-plan" => plugin_npm_release_plan(args),
        "repo-check-no-conflict-markers" => repo_check_no_conflict_markers(args),
        "repo-check-no-extension-src-imports" => repo_check_no_extension_src_imports(args),
        "repo-check-no-register-http-handler" => repo_check_no_register_http_handler(args),
        "repo-check-plugin-extension-import-boundary" => {
            repo_check_plugin_extension_import_boundary(args)
        }
        "repo-check-runtime-module-boundaries" => repo_check_runtime_module_boundaries(args),
        "repo-check-ts-loc" => repo_check_ts_loc(args),
        "repo-check-web-fetch-provider-boundaries" => {
            repo_check_web_fetch_provider_boundaries(args)
        }
        "repo-check-web-search-provider-boundaries" => {
            repo_check_web_search_provider_boundaries(args)
        }
        "repo-check-webhook-auth-body-order" => repo_check_webhook_auth_body_order(args),
        "docs-check-i18n-glossary" => docs_check_i18n_glossary(args),
        "docs-check-links" => docs_check_links(args),
        "plugins-sync" => plugins_sync(args),
        "run-oxlint" => run_oxlint(args),
        "run-tsgo" => run_tsgo(args),
        "run-typecheck" => run_typecheck(args),
        "status" => status(&args),
        "stage" => stage(args),
        "test-workspace" => test_workspace(args),
        "tool" => run_tool(args).await,
        command => {
            eprintln!("unsupported crawclaw-repo-tools command: {command}");
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
            "usage: crawclaw-repo-tools emit-bundled-capability-metadata --output <path> [--check|--write]"
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
            "usage: crawclaw-repo-tools emit-bundled-provider-auth-env-vars --output <path> [--check|--write]"
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
            "usage: crawclaw-repo-tools emit-provider-runtime-constants --output <path> [--check|--write]"
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

fn emit_rust_tool_catalog(args: Vec<String>) {
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
                eprintln!("unsupported emit-rust-tool-catalog option: {other}");
                std::process::exit(2);
            }
        }
    }
    let Some(output_path) = output else {
        eprintln!(
            "usage: crawclaw-repo-tools emit-rust-tool-catalog --output <path> [--check|--write]"
        );
        std::process::exit(2);
    };
    match crawclaw_runtime::write_rust_tool_catalog_artifact(&output_path, check) {
        Ok(result) => {
            if check {
                if result.changed {
                    eprintln!(
                        "[rust-tool-catalog] stale generated output at {}",
                        result.output_path.display()
                    );
                    std::process::exit(1);
                }
            } else if result.wrote {
                println!("[rust-tool-catalog] wrote {}", result.output_path.display());
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

fn docs_list(args: Vec<String>) {
    let root = match parse_optional_root_arg(&args, "docs-list") {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::render_docs_list(root) {
        Ok(output) => {
            if let Err(error) = io::stdout().write_all(output.as_bytes()) {
                if error.kind() != io::ErrorKind::BrokenPipe {
                    eprintln!("failed to write docs list: {error}");
                    std::process::exit(1);
                }
            }
        }
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

fn emit_plugin_dependency_plan(args: Vec<String>) {
    let mut json_output: Option<PathBuf> = None;
    let mut jsonl_output: Option<PathBuf> = None;
    let mut check = false;
    let mut write = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--check" => {
                check = true;
                index += 1;
            }
            "--write" => {
                write = true;
                index += 1;
            }
            "--json-output" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--json-output requires a value");
                    std::process::exit(2);
                };
                json_output = Some(PathBuf::from(value));
                index += 2;
            }
            "--jsonl-output" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--jsonl-output requires a value");
                    std::process::exit(2);
                };
                jsonl_output = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                eprintln!("unsupported emit-plugin-dependency-plan option: {other}");
                std::process::exit(2);
            }
        }
    }
    if check == write {
        eprintln!("Use exactly one of --check or --write.");
        std::process::exit(2);
    }
    let repo_root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match crawclaw_runtime::write_plugin_dependency_plan_artifacts(
        &repo_root,
        json_output,
        jsonl_output,
        check,
    ) {
        Ok(result) => {
            let json_path = crawclaw_runtime::plugin_dependency_plan_relative_to_repo(
                &repo_root,
                &result.json_path,
            );
            let jsonl_path = crawclaw_runtime::plugin_dependency_plan_relative_to_repo(
                &repo_root,
                &result.jsonl_path,
            );
            if check {
                if result.changed {
                    eprintln!(
                        "Plugin dependency plan drift detected.\nExpected current: {json_path}\nExpected current: {jsonl_path}\nIf this plugin dependency surface change is intentional, run `pnpm plugin-deps:gen` and commit the updated baseline files.\nIf not intentional, fix the plugin manifest, package metadata, or managed runtime installer change first."
                    );
                    std::process::exit(1);
                }
                println!("OK {json_path} {jsonl_path}");
            } else {
                println!("Wrote {json_path}\nWrote {jsonl_path}");
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn package_build_native_artifacts(args: Vec<String>) {
    let root = match parse_root_arg(&args) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::stage_native_binary_artifacts(&root) {
        Ok(staged) => {
            let staged = staged
                .into_iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            println!("[native-plugins] staged {staged}");
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn npm_release_check(args: Vec<String>) {
    let root = match parse_optional_root_arg(&args, "npm-release-check") {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    let env_lookup = |key: &str| env::var(key).ok();
    match crawclaw_runtime::run_root_npm_release_check(root, &env_lookup) {
        Ok(result) => {
            println!(
                "crawclaw-npm-release-check: validated {} release {} ({} day UTC delta{}{}).",
                result.channel.as_str(),
                result.version,
                result.day_distance,
                if result.metadata_only {
                    "; metadata-only"
                } else {
                    ""
                },
                if result.release_tag_validated {
                    ""
                } else {
                    "; release tag skipped outside release context"
                }
            );
        }
        Err(errors) => {
            for error in errors {
                eprintln!("crawclaw-npm-release-check: {error}");
            }
            std::process::exit(1);
        }
    }
}

fn npm_postpublish_verify(args: Vec<String>) {
    if args.len() != 1 {
        eprintln!("usage: crawclaw-repo-tools npm-postpublish-verify <version>");
        std::process::exit(2);
    }
    match crawclaw_runtime::verify_published_npm_install(args[0].trim()) {
        Ok(lines) => {
            for line in lines {
                println!("{line}");
            }
        }
        Err(error) => {
            eprintln!("crawclaw-npm-postpublish-verify: {error}");
            std::process::exit(1);
        }
    }
}

fn npm_package_metadata(args: Vec<String>) {
    let package_dir = match parse_package_dir_arg(&args, "npm-package-metadata") {
        Ok(package_dir) => package_dir,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::read_package_metadata(package_dir) {
        Ok((name, version)) => {
            println!("{name}");
            println!("{version}");
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn npm_publish_plan(args: Vec<String>) {
    let mut version: Option<String> = None;
    let mut root: Option<PathBuf> = None;
    let mut package_dir: Option<PathBuf> = None;
    let mut current_beta_version: Option<String> = None;
    let mut requested_tag: Option<String> = None;
    let mut publish_mode = "--dry-run".to_string();
    let mut root_package = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--version" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--version requires a value");
                    std::process::exit(2);
                };
                version = Some(value.clone());
                index += 2;
            }
            "--root" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--root requires a value");
                    std::process::exit(2);
                };
                root = Some(PathBuf::from(value));
                index += 2;
            }
            "--package-dir" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--package-dir requires a value");
                    std::process::exit(2);
                };
                package_dir = Some(PathBuf::from(value));
                index += 2;
            }
            "--current-beta-version" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--current-beta-version requires a value");
                    std::process::exit(2);
                };
                current_beta_version = Some(value.clone());
                index += 2;
            }
            "--requested-tag" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--requested-tag requires a value");
                    std::process::exit(2);
                };
                requested_tag = Some(value.clone());
                index += 2;
            }
            "--publish-mode" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--publish-mode requires a value");
                    std::process::exit(2);
                };
                publish_mode = value.clone();
                index += 2;
            }
            "--root-package" => {
                root_package = true;
                index += 1;
            }
            other => {
                eprintln!("unsupported npm-publish-plan option: {other}");
                std::process::exit(2);
            }
        }
    }

    let version = match version {
        Some(version) => version,
        None => {
            let package_dir = package_dir.or(root).unwrap_or_else(|| PathBuf::from("."));
            match crawclaw_runtime::read_package_metadata(package_dir) {
                Ok((_, version)) => version,
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(1);
                }
            }
        }
    };
    let plan = if root_package {
        crawclaw_runtime::resolve_root_npm_publish_plan(&version, requested_tag.as_deref())
    } else {
        crawclaw_runtime::resolve_plugin_npm_publish_plan(&version, current_beta_version.as_deref())
    };
    let plan = match plan {
        Ok(plan) => plan,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let auth = crawclaw_runtime::resolve_npm_dist_tag_mirror_auth(
        env::var("NODE_AUTH_TOKEN").ok().as_deref(),
        env::var("NPM_TOKEN").ok().as_deref(),
    );
    let mirror_auth_required = crawclaw_runtime::should_require_npm_dist_tag_mirror_auth(
        &publish_mode,
        &plan.mirror_dist_tags,
        auth.has_auth,
    );
    for line in crawclaw_runtime::format_npm_publish_plan_lines(&plan, &auth, mirror_auth_required)
    {
        println!("{line}");
    }
}

fn package_prepack(args: Vec<String>) {
    let root = match parse_root_arg(&args) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    if let Err(error) = crawclaw_runtime::run_package_prepack(root) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn plugin_npm_release_check(args: Vec<String>) {
    let (root, release_args) =
        match parse_plugin_release_command_args(args, "plugin-npm-release-check") {
            Ok(value) => value,
            Err(message) => {
                eprintln!("{message}");
                std::process::exit(2);
            }
        };
    let parsed = match crawclaw_runtime::parse_plugin_release_args(&release_args) {
        Ok(parsed) => parsed,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::select_publishable_plugin_packages(&root, &parsed) {
        Ok(selected) => {
            println!("plugin-npm-release-check: publishable plugin metadata looks OK.");
            if parsed.base_ref.is_some() && parsed.head_ref.is_some() && selected.is_empty() {
                println!(
                    "  - no publishable plugin package changes detected between {} and {}",
                    parsed.base_ref.unwrap_or_default(),
                    parsed.head_ref.unwrap_or_default()
                );
            }
            for plugin in selected {
                println!(
                    "  - {}@{} ({}, {})",
                    plugin.package_name,
                    plugin.version,
                    plugin.channel.as_str(),
                    plugin.extension_id
                );
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn plugin_npm_release_plan(args: Vec<String>) {
    let (root, release_args) =
        match parse_plugin_release_command_args(args, "plugin-npm-release-plan") {
            Ok(value) => value,
            Err(message) => {
                eprintln!("{message}");
                std::process::exit(2);
            }
        };
    let parsed = match crawclaw_runtime::parse_plugin_release_args(&release_args) {
        Ok(parsed) => parsed,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::collect_plugin_release_plan(&root, &parsed) {
        Ok(plan) => println!(
            "{}",
            serde_json::to_string_pretty(&plan)
                .unwrap_or_else(|error| format!("{{\"error\":\"{error}\"}}"))
        ),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn plugins_sync(args: Vec<String>) {
    let root = match parse_optional_root_arg(&args, "plugins-sync") {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::sync_plugin_versions(root) {
        Ok(summary) => {
            println!(
                "Synced plugin versions to {}. Updated: {}. Changelogged: {}. Skipped: {}.",
                summary.target_version,
                summary.updated.len(),
                summary.changelogged.len(),
                summary.skipped.len()
            );
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn run_oxlint(args: Vec<String>) {
    exit_with_tool_result(crawclaw_runtime::run_oxlint(&args));
}

fn run_tsgo(args: Vec<String>) {
    exit_with_tool_result(crawclaw_runtime::run_tsgo(&args));
}

fn run_typecheck(args: Vec<String>) {
    exit_with_tool_result(crawclaw_runtime::run_typecheck(&args));
}

fn github_labels_sync(args: Vec<String>) {
    exit_with_tool_result(crawclaw_runtime::run_github_labels_sync(&args));
}

fn ghsa_patch(args: Vec<String>) {
    exit_with_tool_result(crawclaw_runtime::run_ghsa_patch(&args));
}

fn exit_with_tool_result(result: Result<i32, String>) {
    match result {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn package_release_check(args: Vec<String>) {
    let root = match parse_root_arg(&args) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::collect_package_release_check_errors(root) {
        Ok(errors) => {
            if errors.is_empty() {
                println!("release-check: npm pack contents look OK.");
                return;
            }
            for line in crawclaw_runtime::format_package_release_check_errors(&errors) {
                eprintln!("{line}");
            }
            std::process::exit(1);
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn package_write_build_metadata(args: Vec<String>) {
    let mut include_build_info = false;
    let mut root_args = Vec::new();
    for arg in args {
        if arg == "--build-info" {
            include_build_info = true;
        } else {
            root_args.push(arg);
        }
    }
    let root = match parse_root_arg(&root_args) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    match crawclaw_runtime::write_package_build_metadata(&root, include_build_info) {
        Ok(written) => {
            let written = written
                .into_iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            println!("[build-metadata] wrote {written}");
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn test_workspace(args: Vec<String>) {
    let forwarded = if args.first().is_some_and(|arg| arg == "--") {
        &args[1..]
    } else {
        &args[..]
    };
    let mut cargo_args = vec!["test".to_string(), "--workspace".to_string()];
    cargo_args.extend(forwarded.iter().cloned());
    cargo_args.extend(["--".to_string(), "--test-threads=1".to_string()]);
    let status = Command::new("cargo")
        .args(&cargo_args)
        .env(
            "RUST_MIN_STACK",
            env::var("RUST_MIN_STACK").unwrap_or_else(|_| "16777216".to_string()),
        )
        .status();
    match status {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("failed to run cargo test workspace: {error}");
            std::process::exit(1);
        }
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
        eprintln!("usage: crawclaw-repo-tools package-artifacts --root <repo-root> --json");
        std::process::exit(2);
    };
    if !json_output {
        eprintln!("usage: crawclaw-repo-tools package-artifacts --root <repo-root> --json");
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

fn repo_check_ts_loc(args: Vec<String>) {
    let mut root = PathBuf::from(".");
    let mut max_lines = 500usize;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--root" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--root requires a value");
                    std::process::exit(2);
                };
                root = PathBuf::from(value);
                index += 2;
            }
            "--max" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--max requires a value");
                    std::process::exit(2);
                };
                max_lines = match value.parse::<usize>() {
                    Ok(value) => value,
                    Err(_) => {
                        eprintln!("Missing/invalid --max value");
                        std::process::exit(2);
                    }
                };
                index += 2;
            }
            other => {
                eprintln!("unsupported repo-check-ts-loc option: {other}");
                std::process::exit(2);
            }
        }
    }
    match crawclaw_runtime::collect_ts_loc_offenders(root, max_lines) {
        Ok(offenders) => {
            for offender in &offenders {
                if writeln!(io::stdout(), "{}\t{}", offender.lines, offender.file_path).is_err() {
                    return;
                }
            }
            if !offenders.is_empty() {
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn repo_check_no_conflict_markers(args: Vec<String>) {
    let root = parse_repo_check_root_arg(args, "repo-check-no-conflict-markers");
    finish_check_report(crawclaw_runtime::run_no_conflict_markers(root));
}

fn repo_check_runtime_module_boundaries(args: Vec<String>) {
    let (root, json) =
        parse_repo_check_root_json_args(args, "repo-check-runtime-module-boundaries");
    finish_check_report(crawclaw_runtime::run_runtime_module_boundaries(root, json));
}

fn repo_check_plugin_extension_import_boundary(args: Vec<String>) {
    let (root, json) =
        parse_repo_check_root_json_args(args, "repo-check-plugin-extension-import-boundary");
    finish_check_report(crawclaw_runtime::run_plugin_extension_import_boundary(
        root, json,
    ));
}

fn repo_check_no_extension_src_imports(args: Vec<String>) {
    let root = parse_repo_check_root_arg(args, "repo-check-no-extension-src-imports");
    finish_check_report(crawclaw_runtime::run_no_extension_src_imports(root));
}

fn repo_check_no_register_http_handler(args: Vec<String>) {
    let root = parse_repo_check_root_arg(args, "repo-check-no-register-http-handler");
    finish_check_report(crawclaw_runtime::run_no_register_http_handler(root));
}

fn repo_check_web_fetch_provider_boundaries(args: Vec<String>) {
    let (root, json) =
        parse_repo_check_root_json_args(args, "repo-check-web-fetch-provider-boundaries");
    finish_check_report(crawclaw_runtime::run_web_fetch_provider_boundaries(
        root, json,
    ));
}

fn repo_check_web_search_provider_boundaries(args: Vec<String>) {
    let (root, json) =
        parse_repo_check_root_json_args(args, "repo-check-web-search-provider-boundaries");
    finish_check_report(crawclaw_runtime::run_web_search_provider_boundaries(
        root, json,
    ));
}

fn repo_check_webhook_auth_body_order(args: Vec<String>) {
    let root = parse_repo_check_root_arg(args, "repo-check-webhook-auth-body-order");
    finish_check_report(crawclaw_runtime::run_webhook_auth_body_order(root));
}

fn docs_check_i18n_glossary(args: Vec<String>) {
    let mut root = PathBuf::from(".");
    let mut base: Option<String> = None;
    let mut head: Option<String> = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--root" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--root requires a value");
                    std::process::exit(2);
                };
                root = PathBuf::from(value);
                index += 2;
            }
            "--base" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--base requires a value");
                    std::process::exit(2);
                };
                base = Some(value.clone());
                index += 2;
            }
            "--head" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--head requires a value");
                    std::process::exit(2);
                };
                head = Some(value.clone());
                index += 2;
            }
            other => {
                eprintln!("unsupported docs-check-i18n-glossary option: {other}");
                std::process::exit(2);
            }
        }
    }
    finish_check_report(crawclaw_runtime::run_docs_i18n_glossary(
        root,
        base.as_deref(),
        head.as_deref(),
    ));
}

fn docs_check_links(args: Vec<String>) {
    let mut root = PathBuf::from(".");
    let mut anchors = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--anchors" => {
                anchors = true;
                index += 1;
            }
            "--root" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--root requires a value");
                    std::process::exit(2);
                };
                root = PathBuf::from(value);
                index += 2;
            }
            other => {
                eprintln!("unsupported docs-check-links option: {other}");
                std::process::exit(2);
            }
        }
    }
    if anchors {
        finish_check_report(crawclaw_runtime::run_docs_anchor_audit(root));
    } else {
        finish_check_report(crawclaw_runtime::run_docs_link_audit(root));
    }
}

fn parse_repo_check_root_arg(args: Vec<String>, command: &str) -> PathBuf {
    let (root, json) = parse_repo_check_root_json_args(args, command);
    if json {
        eprintln!("unsupported {command} option: --json");
        std::process::exit(2);
    }
    root
}

fn parse_repo_check_root_json_args(args: Vec<String>, command: &str) -> (PathBuf, bool) {
    let mut root = PathBuf::from(".");
    let mut json = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => {
                json = true;
                index += 1;
            }
            "--root" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--root requires a value");
                    std::process::exit(2);
                };
                root = PathBuf::from(value);
                index += 2;
            }
            other => {
                eprintln!("unsupported {command} option: {other}");
                std::process::exit(2);
            }
        }
    }
    (root, json)
}

fn finish_check_report(result: Result<crawclaw_runtime::CheckReport, String>) {
    match result {
        Ok(report) => {
            if !report.stdout.is_empty() {
                println!("{}", report.stdout.trim_end_matches('\n'));
            }
            if !report.stderr.is_empty() {
                eprint!("{}", report.stderr);
            }
            if !report.ok {
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn parse_root_arg(args: &[String]) -> Result<PathBuf, String> {
    if args.len() != 2 || args[0] != "--root" {
        return Err(
            "usage: crawclaw-repo-tools desktop-stage|desktop-check|package-postbuild|package-build-native-artifacts|package-prepack|package-release-check|package-write-build-metadata --root <repo-root>"
                .to_string(),
        );
    }
    Ok(PathBuf::from(&args[1]))
}

fn parse_optional_root_arg(args: &[String], command: &str) -> Result<PathBuf, String> {
    if args.is_empty() {
        return Ok(PathBuf::from("."));
    }
    if args.len() == 2 && args[0] == "--root" {
        return Ok(PathBuf::from(&args[1]));
    }
    Err(format!(
        "usage: crawclaw-repo-tools {command} [--root <repo-root>]"
    ))
}

fn parse_package_dir_arg(args: &[String], command: &str) -> Result<PathBuf, String> {
    if args.len() == 2 && args[0] == "--package-dir" {
        return Ok(PathBuf::from(&args[1]));
    }
    Err(format!(
        "usage: crawclaw-repo-tools {command} --package-dir <package-dir>"
    ))
}

fn parse_plugin_release_command_args(
    args: Vec<String>,
    command: &str,
) -> Result<(PathBuf, Vec<String>), String> {
    let mut root = PathBuf::from(".");
    let mut forwarded = Vec::new();
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--root" {
            let Some(value) = args.get(index + 1) else {
                return Err("--root requires a value".to_string());
            };
            root = PathBuf::from(value);
            index += 2;
            continue;
        }
        forwarded.push(args[index].clone());
        index += 1;
    }
    if forwarded.first().is_some_and(|arg| arg == "--") {
        forwarded.remove(0);
    }
    if forwarded.iter().any(|arg| arg == "--root") {
        return Err(format!(
            "usage: crawclaw-repo-tools {command} [--root <repo-root>] [plugin release options]"
        ));
    }
    Ok((root, forwarded))
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
                ));
            }
        }
    }
    let json_path =
        json_output.ok_or_else(|| "usage: crawclaw-repo-tools emit-config-doc-baseline --json-output <path> --jsonl-output <path> [--check|--write]".to_string())?;
    let jsonl_path =
        jsonl_output.ok_or_else(|| "usage: crawclaw-repo-tools emit-config-doc-baseline --json-output <path> --jsonl-output <path> [--check|--write]".to_string())?;
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
            "usage: crawclaw-repo-tools emit-provider-model-normalization --output <path> [--check|--write]"
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
        eprintln!("usage: crawclaw-repo-tools stage --output <dir>");
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
        eprintln!("usage: crawclaw-repo-tools tool <name> [json-input]");
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
        "Usage: crawclaw-repo-tools --worker | status [--json] | stage --output <dir> | desktop-stage --root <repo-root> | desktop-check --root <repo-root> | docs-check-i18n-glossary [--root <repo-root>] [--base <rev>] [--head <rev>] | docs-check-links [--root <repo-root>] [--anchors] | emit-bundled-capability-metadata --output <path> [--check|--write] | emit-bundled-provider-auth-env-vars --output <path> [--check|--write] | emit-config-doc-baseline --json-output <path> --jsonl-output <path> [--check|--write] | emit-plugin-dependency-plan [--check|--write] [--json-output <path>] [--jsonl-output <path>] | emit-provider-model-normalization --output <path> [--check|--write] | emit-provider-runtime-constants --output <path> [--check|--write] | emit-rust-tool-catalog --output <path> [--check|--write] | ghsa-patch --ghsa <GHSA-id-or-url> --summary <text> --severity <level> --description-file <path> --vulnerable-version-range <range> --patched-versions <range-or-null> | github-labels-sync [--root <repo-root>] [--check] | npm-package-metadata --package-dir <package-dir> | npm-publish-plan [--root <repo-root>|--package-dir <package-dir>|--version <version>] [--root-package] [--requested-tag <tag>] [--current-beta-version <version>] [--publish-mode <mode>] | npm-release-check [--root <repo-root>] | npm-postpublish-verify <version> | plugin-npm-release-check [--root <repo-root>] [plugin release options] | plugin-npm-release-plan [--root <repo-root>] [plugin release options] | plugins-sync [--root <repo-root>] | run-oxlint [args...] | run-tsgo [args...] | run-typecheck [args...] | package-artifacts --root <repo-root> --json | package-postbuild --root <repo-root> | package-build-native-artifacts --root <repo-root> | package-prepack --root <repo-root> | package-release-check --root <repo-root> | package-write-build-metadata --root <repo-root> [--build-info] | repo-check-no-conflict-markers [--root <repo-root>] | repo-check-runtime-module-boundaries [--root <repo-root>] [--json] | repo-check-plugin-extension-import-boundary [--root <repo-root>] [--json] | repo-check-no-extension-src-imports [--root <repo-root>] | repo-check-no-register-http-handler [--root <repo-root>] | repo-check-web-fetch-provider-boundaries [--root <repo-root>] [--json] | repo-check-web-search-provider-boundaries [--root <repo-root>] [--json] | repo-check-webhook-auth-body-order [--root <repo-root>] | repo-check-ts-loc --root <repo-root> --max <lines> | test-workspace [cargo-test-filter...] | tool <name> [json-input]"
    );
}

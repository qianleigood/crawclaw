use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

use crawclaw_gateway::{GatewayBind, GatewayRunConfig};

#[tokio::main]
async fn main() {
    let mut args = match normalize_root_args(env::args().skip(1).collect::<Vec<_>>()) {
        Ok(args) => args,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        print_help();
        return;
    }
    if args[0] == "--version" || args[0] == "-V" {
        println!("CrawClaw {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    match args.remove(0).as_str() {
        "status" => status(args),
        "health" => health(args),
        "config" => config(args),
        "gateway" => gateway(args).await,
        "plugins" => plugins(args).await,
        "memory" => memory(args),
        "completion" => completion(args),
        "channels" => channels(args),
        "daemon" => daemon(args),
        "doctor" => doctor(args),
        "desktop-runtime" => desktop_runtime(args),
        "runtime" => runtime(args),
        "runtimes" => runtimes(args),
        command => {
            eprintln!("unsupported crawclaw Rust command: {command}");
            std::process::exit(2);
        }
    }
}

fn normalize_root_args(args: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--dev" => {
                apply_profile_env("dev")?;
                index += 1;
            }
            "--profile" => {
                let profile = args
                    .get(index + 1)
                    .ok_or_else(|| "--profile requires a profile name".to_string())?;
                apply_profile_env(profile)?;
                index += 2;
            }
            "--lang" | "--log-level" => {
                if args.get(index + 1).is_none() {
                    return Err(format!("{} requires a value", args[index]));
                }
                index += 2;
            }
            "--no-color" => {
                env::set_var("NO_COLOR", "1");
                env::set_var("FORCE_COLOR", "0");
                index += 1;
            }
            _ => {
                normalized.push(args[index].clone());
                index += 1;
            }
        }
    }
    Ok(normalized)
}

fn apply_profile_env(profile: &str) -> Result<(), String> {
    let trimmed = profile.trim();
    if trimmed.is_empty() {
        return Err("profile name must not be empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("profile name must not contain path separators or '..'".to_string());
    }
    let state_dir = if trimmed == "dev" {
        resolve_home_dir().join(".crawclaw-dev")
    } else {
        resolve_home_dir().join(format!(".crawclaw-{trimmed}"))
    };
    if env::var_os("CRAWCLAW_STATE_DIR").is_none() {
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
    }
    if env::var_os("CRAWCLAW_CONFIG_PATH").is_none() {
        env::set_var("CRAWCLAW_CONFIG_PATH", state_dir.join("crawclaw.json"));
    }
    Ok(())
}

fn status(args: Vec<String>) {
    if has_flag(&args, "--json") {
        print_json(serde_json::json!({
            "ok": true,
            "runtime": "ready",
            "implementation": "rust-native",
            "providers": crawclaw_providers::native_provider_ids(),
            "providerTransports": crawclaw_providers::native_provider_transports(),
            "providerPlugins": crawclaw_providers::bundled_provider_plugin_metadata(),
            "providerDescriptors": crawclaw_providers::bundled_provider_descriptors(),
            "defaultModels": crawclaw_providers::bundled_provider_default_models(),
            "channels": crawclaw_plugin_host::native_channel_ids(),
        }));
        return;
    }
    println!("CrawClaw runtime: ready (rust-native)");
}

fn health(args: Vec<String>) {
    if has_flag(&args, "--json") {
        print_json(serde_json::json!({
            "ok": true,
            "runtime": "ready",
            "implementation": "rust-native",
        }));
        return;
    }
    println!("ok");
}

fn channels(args: Vec<String>) {
    if command_starts_with(&args, &["list"]) && has_flag(&args, "--json") {
        print_json(serde_json::json!({
            "ok": true,
            "implementation": "rust-native",
            "channels": crawclaw_plugin_host::native_channels(),
        }));
        return;
    }

    if command_starts_with(&args, &["list"]) {
        for channel in crawclaw_plugin_host::native_channels() {
            println!("{}\t{}", channel.id, channel.label);
        }
        return;
    }

    eprintln!("usage: crawclaw channels list [--json]");
    std::process::exit(2);
}

struct PluginsCommandResult {
    json: bool,
    value: serde_json::Value,
    lines: Vec<String>,
}

async fn plugins(args: Vec<String>) {
    match plugins_command_result(&args).await {
        Ok(result) => {
            if result.json {
                print_json(result.value);
                return;
            }
            for line in result.lines {
                println!("{line}");
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

async fn plugins_command_result(args: &[String]) -> Result<PluginsCommandResult, String> {
    if args.is_empty() || has_flag(args, "--help") || has_flag(args, "-h") {
        return Ok(PluginsCommandResult {
            json: false,
            value: serde_json::Value::Null,
            lines: plugins_usage(),
        });
    }

    match args[0].as_str() {
        "list" => plugins_list_command(&args[1..]).await,
        "install" => plugins_install_command(&args[1..]).await,
        "update" => plugins_update_command(&args[1..]).await,
        "enable" => plugins_toggle_command(&args[1..], "plugins.enable", true).await,
        "disable" => plugins_toggle_command(&args[1..], "plugins.disable", false).await,
        "uninstall" | "remove" => plugins_uninstall_command(&args[1..]).await,
        other => Err(format!("unsupported crawclaw plugins command: {other}")),
    }
}

fn plugins_usage() -> Vec<String> {
    vec![
        "crawclaw plugins list [--json]".to_string(),
        "crawclaw plugins install <path-or-spec-or-plugin> [--json] [--link] [--pin] [--marketplace <source>]".to_string(),
        "crawclaw plugins update [id] [--all] [--dry-run] [--force] [--json]".to_string(),
        "crawclaw plugins enable <id> [--json]".to_string(),
        "crawclaw plugins disable <id> [--json]".to_string(),
        "crawclaw plugins uninstall <id> [--keep-files] [--json]".to_string(),
    ]
}

async fn plugins_list_command(args: &[String]) -> Result<PluginsCommandResult, String> {
    let json_output = has_flag(args, "--json");
    let value =
        crawclaw_gateway::call_local_gateway_method("plugins.list", serde_json::json!({})).await?;
    let lines = if json_output {
        Vec::new()
    } else {
        plugin_list_lines(&value)
    };
    Ok(PluginsCommandResult {
        json: json_output,
        value,
        lines,
    })
}

async fn plugins_install_command(args: &[String]) -> Result<PluginsCommandResult, String> {
    let json_output = has_flag(args, "--json");
    let positionals = collect_positionals(args, &["--marketplace"])?;
    let raw = positionals
        .first()
        .ok_or_else(|| "usage: crawclaw plugins install <path-or-spec-or-plugin>".to_string())?;
    let marketplace = string_flag_value(args, "--marketplace")?;
    if marketplace.is_some() && has_flag(args, "--link") {
        return Err("`--link` is not supported with `--marketplace`.".to_string());
    }

    let mut params = serde_json::Map::new();
    if let Some(marketplace) = marketplace {
        params.insert(
            "marketplaceSource".to_string(),
            serde_json::Value::String(marketplace),
        );
        params.insert(
            "marketplacePlugin".to_string(),
            serde_json::Value::String(raw.clone()),
        );
    } else {
        params.insert("raw".to_string(), serde_json::Value::String(raw.clone()));
    }
    for (key, flag) in [
        ("link", "--link"),
        ("pin", "--pin"),
        (
            "dangerouslyForceUnsafeInstall",
            "--dangerously-force-unsafe-install",
        ),
    ] {
        if has_flag(args, flag) {
            params.insert(key.to_string(), serde_json::Value::Bool(true));
        }
    }

    let value = crawclaw_gateway::call_local_gateway_method(
        "plugins.install",
        serde_json::Value::Object(params),
    )
    .await?;
    let plugin_id = value
        .get("pluginId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(raw.as_str())
        .to_string();
    Ok(PluginsCommandResult {
        json: json_output,
        value,
        lines: if json_output {
            Vec::new()
        } else {
            vec![
                format!("Installed plugin \"{plugin_id}\"."),
                "Restart the gateway to apply changes.".to_string(),
            ]
        },
    })
}

async fn plugins_update_command(args: &[String]) -> Result<PluginsCommandResult, String> {
    let json_output = has_flag(args, "--json");
    let positionals = collect_positionals(args, &[])?;
    let all = has_flag(args, "--all");
    if !all && positionals.is_empty() {
        return Err("Provide a plugin id, or use --all.".to_string());
    }

    let mut params = serde_json::Map::new();
    if all {
        params.insert("all".to_string(), serde_json::Value::Bool(true));
    } else if let Some(id) = positionals.first() {
        params.insert("id".to_string(), serde_json::Value::String(id.clone()));
    }
    for (key, flag) in [("dryRun", "--dry-run"), ("force", "--force")] {
        if has_flag(args, flag) {
            params.insert(key.to_string(), serde_json::Value::Bool(true));
        }
    }

    let value = crawclaw_gateway::call_local_gateway_method(
        "plugins.update",
        serde_json::Value::Object(params),
    )
    .await?;
    let mut lines = plugin_update_lines(&value);
    if value
        .get("requiresRestart")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        lines.push("Restart the gateway to apply changes.".to_string());
    }
    Ok(PluginsCommandResult {
        json: json_output,
        value,
        lines: if json_output { Vec::new() } else { lines },
    })
}

async fn plugins_toggle_command(
    args: &[String],
    method: &str,
    enabled: bool,
) -> Result<PluginsCommandResult, String> {
    let json_output = has_flag(args, "--json");
    let id = collect_positionals(args, &[])?
        .first()
        .cloned()
        .ok_or_else(|| {
            format!(
                "usage: crawclaw plugins {} <id>",
                if enabled { "enable" } else { "disable" }
            )
        })?;
    let value =
        crawclaw_gateway::call_local_gateway_method(method, serde_json::json!({ "id": id }))
            .await?;
    Ok(PluginsCommandResult {
        json: json_output,
        value,
        lines: if json_output {
            Vec::new()
        } else {
            vec![format!(
                "{} plugin \"{}\". Restart the gateway to apply changes.",
                if enabled { "Enabled" } else { "Disabled" },
                id
            )]
        },
    })
}

async fn plugins_uninstall_command(args: &[String]) -> Result<PluginsCommandResult, String> {
    let json_output = has_flag(args, "--json");
    let id = collect_positionals(args, &[])?
        .first()
        .cloned()
        .ok_or_else(|| "usage: crawclaw plugins uninstall <id>".to_string())?;
    let value = crawclaw_gateway::call_local_gateway_method(
        "plugins.uninstall",
        serde_json::json!({
            "id": id,
            "keepFiles": has_flag(args, "--keep-files")
        }),
    )
    .await?;
    Ok(PluginsCommandResult {
        json: json_output,
        value,
        lines: if json_output {
            Vec::new()
        } else {
            vec![format!(
                "Uninstalled plugin \"{id}\". Restart the gateway to apply changes."
            )]
        },
    })
}

fn plugin_list_lines(value: &serde_json::Value) -> Vec<String> {
    let Some(plugins) = value.get("plugins").and_then(serde_json::Value::as_array) else {
        return vec!["No plugins installed.".to_string()];
    };
    if plugins.is_empty() {
        return vec!["No plugins installed.".to_string()];
    }
    plugins
        .iter()
        .map(|plugin| {
            let id = plugin
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown");
            let status = plugin
                .get("status")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown");
            let version = plugin
                .get("version")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("-");
            format!("{id}\t{status}\t{version}")
        })
        .collect()
}

fn plugin_update_lines(value: &serde_json::Value) -> Vec<String> {
    value
        .get("outcomes")
        .and_then(serde_json::Value::as_array)
        .map(|outcomes| {
            outcomes
                .iter()
                .filter_map(|outcome| {
                    outcome
                        .get("message")
                        .and_then(serde_json::Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .collect::<Vec<_>>()
        })
        .filter(|lines| !lines.is_empty())
        .unwrap_or_else(|| vec!["No plugin updates were applied.".to_string()])
}

fn string_flag_value(args: &[String], flag: &str) -> Result<Option<String>, String> {
    let Some(index) = args.iter().position(|arg| arg == flag) else {
        return Ok(None);
    };
    args.get(index + 1)
        .filter(|value| !value.starts_with('-'))
        .cloned()
        .map(Some)
        .ok_or_else(|| format!("{flag} requires a value"))
}

fn collect_positionals(args: &[String], value_flags: &[&str]) -> Result<Vec<String>, String> {
    let mut values = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--" {
            values.extend(args.iter().skip(index + 1).cloned());
            break;
        }
        if arg.starts_with('-') {
            if value_flags.iter().any(|flag| *flag == arg) {
                if args.get(index + 1).is_none() {
                    return Err(format!("{arg} requires a value"));
                }
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }
        values.push(arg.clone());
        index += 1;
    }
    Ok(values)
}

fn config(args: Vec<String>) {
    if command_starts_with(&args, &["get"]) {
        let Some(key) = args.get(1) else {
            eprintln!("usage: crawclaw config get <key>");
            std::process::exit(2);
        };
        match config_get(key) {
            Ok(Some(value)) => {
                print_config_value(&value);
            }
            Ok(None) => std::process::exit(1),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }

    if command_starts_with(&args, &["set"]) {
        let Some(key) = args.get(1) else {
            eprintln!("usage: crawclaw config set <key> <value> [--strict-json]");
            std::process::exit(2);
        };
        let Some(raw_value) = args.get(2) else {
            eprintln!("usage: crawclaw config set <key> <value> [--strict-json]");
            std::process::exit(2);
        };
        let value = match parse_config_value(raw_value, has_flag(&args, "--strict-json")) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(2);
            }
        };
        if let Err(error) = config_set(key, value) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    eprintln!("usage: crawclaw config get <key> | crawclaw config set <key> <value>");
    std::process::exit(2);
}

fn config_get(key: &str) -> Result<Option<serde_json::Value>, String> {
    let config = read_config_json()?;
    Ok(get_json_path(&config, key).cloned())
}

fn config_set(key: &str, value: serde_json::Value) -> Result<(), String> {
    let mut config = read_config_json()?;
    set_json_path(&mut config, key, value)?;
    let config_path = resolve_config_path();
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create config directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("failed to serialize config: {error}"))?;
    fs::write(&config_path, format!("{raw}\n"))
        .map_err(|error| format!("failed to write config {}: {error}", config_path.display()))
}

fn read_config_json() -> Result<serde_json::Value, String> {
    let config_path = resolve_config_path();
    match fs::read_to_string(&config_path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("invalid config {}: {error}", config_path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(serde_json::Value::Object(serde_json::Map::new()))
        }
        Err(error) => Err(format!(
            "failed to read config {}: {error}",
            config_path.display()
        )),
    }
}

fn parse_config_value(raw: &str, strict_json: bool) -> Result<serde_json::Value, String> {
    if strict_json {
        return serde_json::from_str(raw)
            .map_err(|error| format!("invalid JSON config value: {error}"));
    }
    match raw {
        "true" => Ok(serde_json::Value::Bool(true)),
        "false" => Ok(serde_json::Value::Bool(false)),
        "null" => Ok(serde_json::Value::Null),
        _ => Ok(raw
            .parse::<i64>()
            .map(|value| serde_json::Value::Number(value.into()))
            .or_else(|_| raw.parse::<f64>().map(json_number))
            .unwrap_or_else(|_| serde_json::Value::String(raw.to_string()))),
    }
}

fn json_number(value: f64) -> serde_json::Value {
    serde_json::Number::from_f64(value)
        .map(serde_json::Value::Number)
        .unwrap_or_else(|| serde_json::Value::String(value.to_string()))
}

fn print_config_value(value: &serde_json::Value) {
    match value {
        serde_json::Value::String(value) => println!("{value}"),
        other => println!("{other}"),
    }
}

fn get_json_path<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a serde_json::Value> {
    let mut current = value;
    for segment in key.split('.').filter(|segment| !segment.is_empty()) {
        current = current.get(segment)?;
    }
    Some(current)
}

fn set_json_path(
    value: &mut serde_json::Value,
    key: &str,
    next_value: serde_json::Value,
) -> Result<(), String> {
    let segments = key
        .split('.')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return Err("config key must not be empty".to_string());
    }
    if !value.is_object() {
        *value = serde_json::Value::Object(serde_json::Map::new());
    }
    let mut current = value;
    for segment in &segments[..segments.len() - 1] {
        let object = current
            .as_object_mut()
            .ok_or_else(|| format!("config path segment is not an object: {segment}"))?;
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if !current.is_object() {
            *current = serde_json::Value::Object(serde_json::Map::new());
        }
    }
    let object = current
        .as_object_mut()
        .ok_or_else(|| "config root is not an object".to_string())?;
    object.insert(segments[segments.len() - 1].to_string(), next_value);
    Ok(())
}

fn completion(args: Vec<String>) {
    if !has_flag(&args, "--write-state") {
        eprintln!("usage: crawclaw completion [--shell <shell>] --write-state");
        std::process::exit(2);
    }

    let shells = match completion_shells_from_args(&args) {
        Ok(shells) => shells,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };

    if let Err(error) = write_completion_state(&shells) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn completion_shells_from_args(args: &[String]) -> Result<Vec<&'static str>, String> {
    if let Some(index) = args.iter().position(|arg| arg == "--shell" || arg == "-s") {
        let value = args.get(index + 1).ok_or_else(|| {
            "completion --shell requires zsh, bash, fish, or powershell".to_string()
        })?;
        let shell = normalize_completion_shell(value)?;
        return Ok(vec![shell]);
    }
    Ok(vec!["zsh", "bash", "fish", "powershell"])
}

fn normalize_completion_shell(value: &str) -> Result<&'static str, String> {
    match value {
        "zsh" => Ok("zsh"),
        "bash" => Ok("bash"),
        "fish" => Ok("fish"),
        "powershell" | "pwsh" => Ok("powershell"),
        other => Err(format!("unsupported completion shell: {other}")),
    }
}

fn write_completion_state(shells: &[&str]) -> Result<(), String> {
    let cache_dir = resolve_completion_cache_dir();
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "failed to create completion cache directory {}: {error}",
            cache_dir.display()
        )
    })?;

    for shell in shells {
        let path = completion_cache_path(&cache_dir, shell);
        fs::write(&path, completion_script(shell)).map_err(|error| {
            format!(
                "failed to write completion cache {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn completion_script(shell: &str) -> String {
    match shell {
        "fish" => {
            "complete -c crawclaw -f -a 'channels gateway plugins memory desktop-runtime runtime runtimes completion daemon doctor'\n"
                .to_string()
        }
        "powershell" => {
            "Register-ArgumentCompleter -Native -CommandName crawclaw -ScriptBlock { param($wordToComplete) 'channels','gateway','plugins','memory','desktop-runtime','runtime','runtimes','completion','daemon','doctor' | Where-Object { $_ -like \"$wordToComplete*\" } }\n"
                .to_string()
        }
        "bash" => {
            "_crawclaw_completions() { COMPREPLY=( $(compgen -W \"channels gateway plugins memory desktop-runtime runtime runtimes completion daemon doctor\" -- \"${COMP_WORDS[COMP_CWORD]}\") ); }\ncomplete -F _crawclaw_completions crawclaw\n"
                .to_string()
        }
        _ => {
            "#compdef crawclaw\n_arguments '1:command:(channels gateway plugins memory desktop-runtime runtime runtimes completion daemon doctor)'\n"
                .to_string()
        }
    }
}

fn completion_cache_path(cache_dir: &Path, shell: &str) -> PathBuf {
    let extension = match shell {
        "powershell" => "ps1",
        "fish" => "fish",
        "bash" => "bash",
        _ => "zsh",
    };
    cache_dir.join(format!("crawclaw.{extension}"))
}

fn resolve_completion_cache_dir() -> PathBuf {
    resolve_state_dir().join("completions")
}

fn daemon(args: Vec<String>) {
    if command_starts_with(&args, &["install"]) {
        if let Err(error) = install_gateway_service() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    eprintln!("usage: crawclaw daemon install [--force]");
    std::process::exit(2);
}

fn doctor(args: Vec<String>) {
    let repair_requested = has_flag(&args, "--repair") || has_flag(&args, "--fix");
    if repair_requested {
        if let Err(error) = install_gateway_service() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
    println!("CrawClaw Rust doctor completed.");
}

fn install_gateway_service() -> Result<(), String> {
    let service_path = resolve_home_dir()
        .join(".config")
        .join("systemd")
        .join("user")
        .join("crawclaw-gateway.service");
    let service_dir = service_path
        .parent()
        .ok_or_else(|| "failed to resolve gateway service directory".to_string())?;
    fs::create_dir_all(service_dir).map_err(|error| {
        format!(
            "failed to create gateway service directory {}: {error}",
            service_dir.display()
        )
    })?;

    let entrypoint = resolve_cli_entrypoint()?;
    let unit = build_gateway_systemd_unit(&entrypoint);
    fs::write(&service_path, unit).map_err(|error| {
        format!(
            "failed to write gateway service unit {}: {error}",
            service_path.display()
        )
    })?;
    Ok(())
}

fn build_gateway_systemd_unit(entrypoint: &Path) -> String {
    let exec_start = [
        systemd_escape_arg(entrypoint.to_string_lossy().as_ref()),
        "gateway".to_string(),
        "--allow-unconfigured".to_string(),
    ]
    .join(" ");
    [
        "[Unit]",
        "Description=CrawClaw Gateway",
        "After=network-online.target",
        "Wants=network-online.target",
        "",
        "[Service]",
        &format!("ExecStart={exec_start}"),
        "Restart=always",
        "RestartSec=5",
        "TimeoutStopSec=30",
        "TimeoutStartSec=30",
        "SuccessExitStatus=0 143",
        "KillMode=control-group",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
    ]
    .join("\n")
}

fn systemd_escape_arg(value: &str) -> String {
    if value.contains('\n') || value.contains('\r') {
        return value.replace(['\n', '\r'], "");
    }
    if !value
        .chars()
        .any(|ch| ch.is_whitespace() || ch == '"' || ch == '\\')
    {
        return value.to_string();
    }
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn resolve_cli_entrypoint() -> Result<PathBuf, String> {
    if let Some(entrypoint) = env::var_os("CRAWCLAW_CLI_ENTRYPOINT") {
        let value = PathBuf::from(entrypoint);
        if !value.as_os_str().is_empty() {
            return Ok(value);
        }
    }
    env::current_exe().map_err(|error| format!("failed to resolve crawclaw executable: {error}"))
}

fn resolve_home_dir() -> PathBuf {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_state_dir() -> PathBuf {
    if let Some(value) = env::var_os("CRAWCLAW_STATE_DIR").filter(|value| !value.is_empty()) {
        let raw = PathBuf::from(value);
        if let Ok(rest) = raw.strip_prefix("~") {
            return resolve_home_dir().join(rest);
        }
        return raw;
    }
    resolve_home_dir().join(".crawclaw")
}

fn resolve_config_path() -> PathBuf {
    if let Some(value) = env::var_os("CRAWCLAW_CONFIG_PATH").filter(|value| !value.is_empty()) {
        return PathBuf::from(value);
    }
    resolve_state_dir().join("crawclaw.json")
}

async fn gateway(args: Vec<String>) {
    if has_flag(&args, "--help") || has_flag(&args, "-h") {
        println!("crawclaw gateway - Rust-native local Gateway runtime");
        return;
    }

    if command_starts_with(&args, &["status"]) && has_flag(&args, "--json") {
        print_json(serde_json::json!({
            "ok": true,
            "service": {
                "runtime": {
                    "status": "running",
                    "implementation": "rust-native",
                    "owner": "rust-gateway",
                    "coreTools": crawclaw_runtime::pi_agent_rust_tool_names()
                }
            }
        }));
        return;
    }

    if command_starts_with(&args, &["install"]) && has_flag(&args, "--json") {
        print_unsupported(
            "gateway.install",
            "Gateway install is owned by the Tauri Desktop host for the Rust runtime.",
        );
        return;
    }

    if command_starts_with(&args, &["start"]) && has_flag(&args, "--json") {
        print_unsupported(
            "gateway.start",
            "Gateway lifecycle is owned by the Tauri Desktop host for the Rust runtime.",
        );
        return;
    }

    if command_starts_with(&args, &["stop"]) && has_flag(&args, "--json") {
        print_unsupported(
            "gateway.stop",
            "Gateway lifecycle is owned by the Tauri Desktop host for the Rust runtime.",
        );
        return;
    }

    if command_starts_with(&args, &["restart"]) && has_flag(&args, "--json") {
        print_unsupported(
            "gateway.restart",
            "Gateway lifecycle is owned by the Tauri Desktop host for the Rust runtime.",
        );
        return;
    }

    if command_starts_with(&args, &["call", "logs.tail"]) && has_flag(&args, "--json") {
        print_unsupported(
            "logs.tail",
            "Gateway log tailing is exposed through the Tauri Desktop host, not the Rust CLI.",
        );
        return;
    }

    let config = match parse_gateway_run_config(&args) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    if let Err(error) = crawclaw_gateway::run_gateway(config).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn parse_gateway_run_config(args: &[String]) -> Result<GatewayRunConfig, String> {
    let mut config = GatewayRunConfig::default();
    let mut index = usize::from(args.first().map(String::as_str) == Some("run"));
    while index < args.len() {
        match args[index].as_str() {
            "--allow-unconfigured" | "--force" | "--reset" | "--verbose" => {
                index += 1;
            }
            "--runtime-root" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "gateway --runtime-root requires a path".to_string())?;
                config.runtime_root = Some(PathBuf::from(value));
                index += 2;
            }
            "--token" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "gateway --token requires a non-empty token".to_string())?;
                let token = value.trim();
                if token.is_empty() {
                    return Err("gateway --token requires a non-empty token".to_string());
                }
                config.auth_token = Some(token.to_string());
                index += 2;
            }
            "--bind" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "gateway --bind requires loopback or lan".to_string())?;
                config.bind = match value.as_str() {
                    "loopback" => GatewayBind::Loopback,
                    "lan" => GatewayBind::Lan,
                    other => return Err(format!("unsupported gateway bind mode: {other}")),
                };
                index += 2;
            }
            "--port" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "gateway --port requires a port number".to_string())?;
                config.port = value
                    .parse::<u16>()
                    .map_err(|_| format!("invalid gateway port: {value}"))?;
                index += 2;
            }
            other => return Err(format!("unsupported gateway argument: {other}")),
        }
    }
    Ok(config)
}

fn memory(args: Vec<String>) {
    let runtime_root = resolve_runtime_root();
    let runtime = crawclaw_runtime::memory::RustMemoryRuntime::new(runtime_root);

    let result = if args.is_empty() || command_starts_with(&args, &["status"]) {
        runtime.status()
    } else if command_starts_with(&args, &["refresh"]) {
        runtime
            .refresh_notebooklm()
            .map(|provider| serde_json::json!({ "status": "ok", "provider": provider }))
    } else if command_starts_with(&args, &["login"]) {
        runtime
            .login_notebooklm()
            .map(|provider| serde_json::json!({ "status": "ok", "provider": provider }))
    } else if command_starts_with(&args, &["sync"]) {
        runtime.sync_experience_outbox()
    } else if command_starts_with(&args, &["durable", "index", "list"]) {
        let scope = arg_value(&args, "--scope").unwrap_or_else(|| "main".to_string());
        let limit = arg_value(&args, "--limit")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(50);
        runtime.durable_index_list(&scope, limit)
    } else if command_starts_with(&args, &["durable", "index", "get"]) {
        let scope = arg_value(&args, "--scope").unwrap_or_else(|| "main".to_string());
        let id = arg_value(&args, "--id").or_else(|| args.get(3).cloned());
        match id {
            Some(id) => runtime.durable_index_get(&scope, &id),
            None => {
                Err("usage: crawclaw memory durable index get <id> [--scope <scope>]".to_string())
            }
        }
    } else if command_starts_with(&args, &["dream", "status"]) {
        runtime.dream_store().status()
    } else if command_starts_with(&args, &["dream", "history"]) {
        runtime
            .dream_store()
            .history()
            .map(|history| serde_json::json!({ "status": "ok", "history": history }))
    } else if command_starts_with(&args, &["dream", "run"]) {
        let scope = arg_value(&args, "--scope").unwrap_or_else(|| "main".to_string());
        let task = positional_tail(&args, 2);
        runtime
            .dream_store()
            .run(&scope, &task)
            .map(|result| serde_json::json!({ "status": "completed", "kind": "dream", "result": result }))
    } else if command_starts_with(&args, &["session-summary", "status"]) {
        let scope = arg_value(&args, "--scope")
            .or_else(|| arg_value(&args, "--session-id"))
            .unwrap_or_else(|| "main".to_string());
        runtime
            .session_summary_store()
            .status(&scope)
            .map(|status| serde_json::json!(status))
    } else if command_starts_with(&args, &["session-summary", "refresh"]) {
        let scope = arg_value(&args, "--scope")
            .or_else(|| arg_value(&args, "--session-id"))
            .unwrap_or_else(|| "main".to_string());
        let content = positional_tail(&args, 2);
        runtime
            .session_summary_store()
            .refresh(&scope, &content)
            .map(|result| serde_json::json!({ "status": "completed", "kind": "session-summary", "result": result }))
    } else if command_starts_with(&args, &["experience", "outbox", "list"]) {
        runtime
            .experience_store()
            .list()
            .map(|entries| serde_json::json!({ "status": "ok", "entries": entries }))
    } else if command_starts_with(&args, &["experience", "outbox", "updateStatus"]) {
        let entry_id = arg_value(&args, "--id").or_else(|| args.get(3).cloned());
        let status = arg_value(&args, "--status").or_else(|| args.get(4).cloned());
        match (entry_id, status) {
            (Some(entry_id), Some(status)) => {
                runtime.experience_store().update_status(&entry_id, &status)
            }
            _ => Err(
                "usage: crawclaw memory experience outbox updateStatus <id> <status>".to_string(),
            ),
        }
    } else if command_starts_with(&args, &["experience", "outbox", "prune"]) {
        runtime.experience_store().prune()
    } else if command_starts_with(&args, &["experience", "sync", "flush"]) {
        runtime.sync_experience_outbox()
    } else {
        Err("usage: crawclaw memory status|login|refresh|sync|durable|dream|session-summary|experience ...".to_string())
    };

    match result {
        Ok(value) => {
            if has_flag(&args, "--json") {
                print_json(value);
            } else {
                println!("{value}");
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

fn resolve_runtime_root() -> PathBuf {
    if let Some(value) = env::var_os("CRAWCLAW_RUNTIME_ROOT").filter(|value| !value.is_empty()) {
        return PathBuf::from(value);
    }
    resolve_state_dir().join("runtime").join("crawclaw")
}

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == flag)
        .and_then(|index| args.get(index + 1))
        .map(ToOwned::to_owned)
}

fn positional_tail(args: &[String], start: usize) -> String {
    args.iter()
        .skip(start)
        .filter(|arg| !arg.starts_with("--"))
        .cloned()
        .collect::<Vec<_>>()
        .join(" ")
}

fn desktop_runtime(args: Vec<String>) {
    if command_starts_with(&args, &["status"]) && has_flag(&args, "--json") {
        print_json(serde_json::json!({
            "ok": true,
            "runtime": "ready",
            "providers": crawclaw_providers::native_provider_ids(),
            "providerTransports": crawclaw_providers::native_provider_transports(),
            "providerPlugins": crawclaw_providers::bundled_provider_plugin_metadata(),
            "providerDescriptors": crawclaw_providers::bundled_provider_descriptors(),
            "defaultModels": crawclaw_providers::bundled_provider_default_models(),
            "channels": crawclaw_plugin_host::native_channel_ids(),
            "jsPluginRuntime": "pi-quickjs"
        }));
        return;
    }
    eprintln!("usage: crawclaw desktop-runtime status --json");
    std::process::exit(2);
}

fn runtime(args: Vec<String>) {
    if args.len() == 3 && args[0] == "stage" && args[1] == "--output" {
        stage_runtime(PathBuf::from(&args[2]));
        return;
    }
    eprintln!("usage: crawclaw runtime stage --output <dir>");
    std::process::exit(2);
}

fn stage_runtime(output: PathBuf) {
    let runtimes_dir = output.join("runtimes");
    let channels_dir = output.join("channels");
    let providers_dir = output.join("providers");
    let plugins_dir = output.join("plugins");
    fs::create_dir_all(&runtimes_dir).expect("create runtimes dir");
    fs::create_dir_all(&channels_dir).expect("create channels dir");
    fs::create_dir_all(&providers_dir).expect("create providers dir");
    fs::create_dir_all(&plugins_dir).expect("create plugins dir");
    fs::write(
        runtimes_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "runtime": "rust-native",
            "jsPluginRuntime": "pi-quickjs",
        }))
        .expect("runtime manifest json"),
    )
    .expect("write runtime manifest");
    fs::write(
        channels_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "implementation": "rust-native",
            "channels": crawclaw_plugin_host::native_channels(),
        }))
        .expect("channel manifest json"),
    )
    .expect("write channel manifest");
    fs::write(
        providers_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "providers": crawclaw_providers::native_provider_ids(),
            "transports": crawclaw_providers::native_provider_transports(),
            "providerPlugins": crawclaw_providers::bundled_provider_plugin_metadata(),
            "providerDescriptors": crawclaw_providers::bundled_provider_descriptors(),
            "defaultModels": crawclaw_providers::bundled_provider_default_models(),
        }))
        .expect("provider manifest json"),
    )
    .expect("write provider manifest");
    fs::write(
        plugins_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "readModel": true,
            "jsPluginRuntime": "pi-quickjs",
            "nativeChannels": crawclaw_plugin_host::native_channel_ids(),
        }))
        .expect("plugin manifest json"),
    )
    .expect("write plugin manifest");
}

fn runtimes(args: Vec<String>) {
    if command_starts_with(&args, &["list"]) && has_flag(&args, "--json") {
        print_json(serde_json::json!({
            "ok": true,
            "manifest": read_runtime_manifest(),
        }));
        return;
    }

    if command_starts_with(&args, &["install"]) && has_flag(&args, "--json") {
        print_json(install_managed_runtimes());
        return;
    }

    eprintln!("usage: crawclaw runtimes list --json");
    std::process::exit(2);
}

fn install_managed_runtimes() -> serde_json::Value {
    let mut plugins = serde_json::Map::new();
    let mut ok = true;
    match crawclaw_native_plugins::web::install_open_websearch_runtime_from_env() {
        Ok(value) => {
            plugins.insert("open-websearch".to_string(), value);
        }
        Err(error) => {
            ok = false;
            plugins.insert(
                "open-websearch".to_string(),
                serde_json::json!({
                    "state": "unavailable",
                    "reason": error.to_string()
                }),
            );
        }
    }
    match crawclaw_native_plugins::web::install_scrapling_runtime_from_env() {
        Ok(value) => {
            plugins.insert("scrapling-fetch".to_string(), value);
        }
        Err(error) => {
            ok = false;
            plugins.insert(
                "scrapling-fetch".to_string(),
                serde_json::json!({
                    "state": "unavailable",
                    "reason": error.to_string()
                }),
            );
        }
    }
    serde_json::json!({
        "ok": ok,
        "manifest": {
            "plugins": plugins
        }
    })
}

fn read_runtime_manifest() -> serde_json::Value {
    let manifest_path = env::var_os("CRAWCLAW_PLUGIN_RUNTIMES_DIR")
        .and_then(|value| env::split_paths(&value).next())
        .unwrap_or_else(|| {
            env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("runtimes")
        })
        .join("manifest.json");

    match fs::read_to_string(manifest_path) {
        Ok(source) => {
            serde_json::from_str(&source).unwrap_or_else(|_| serde_json::json!({ "plugins": {} }))
        }
        Err(_) => serde_json::json!({ "plugins": {} }),
    }
}

fn command_starts_with(args: &[String], expected: &[&str]) -> bool {
    args.len() >= expected.len()
        && expected
            .iter()
            .enumerate()
            .all(|(index, value)| args[index] == *value)
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|arg| arg == flag)
}

fn print_unsupported(code: &str, message: &str) {
    print_json(serde_json::json!({
        "ok": false,
        "code": "unsupported",
        "operation": code,
        "message": message,
    }));
}

fn print_json(value: serde_json::Value) {
    println!("{value}");
}

fn print_help() {
    println!("crawclaw - Rust-native CrawClaw runtime");
    println!("commands: status, health, config, channels, gateway, plugins, memory, desktop-runtime, runtime, runtimes, completion, daemon, doctor");
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        build_gateway_systemd_unit, completion_cache_path, config_get, config_set,
        normalize_root_args, parse_config_value, parse_gateway_run_config, plugins_command_result,
        stage_runtime, systemd_escape_arg, write_completion_state, GatewayBind,
    };

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn parses_default_gateway_run_config() {
        let config = parse_gateway_run_config(&["--allow-unconfigured".to_string()]).unwrap();
        assert_eq!(config.bind, GatewayBind::Loopback);
        assert_eq!(config.port, 18789);
    }

    #[test]
    fn parses_lan_gateway_run_config() {
        let config = parse_gateway_run_config(&[
            "run".to_string(),
            "--bind".to_string(),
            "lan".to_string(),
            "--port".to_string(),
            "18888".to_string(),
        ])
        .unwrap();
        assert_eq!(config.bind, GatewayBind::Lan);
        assert_eq!(config.port, 18888);
    }

    #[test]
    fn parses_gateway_runtime_root_and_token() {
        let config = parse_gateway_run_config(&[
            "run".to_string(),
            "--runtime-root".to_string(),
            "/tmp/crawclaw-runtime".to_string(),
            "--token".to_string(),
            "secret-token".to_string(),
        ])
        .unwrap();
        assert_eq!(
            config.runtime_root,
            Some(PathBuf::from("/tmp/crawclaw-runtime"))
        );
        assert_eq!(config.auth_token.as_deref(), Some("secret-token"));
    }

    #[test]
    fn parses_gateway_reset_and_verbose_as_runtime_wrapper_flags() {
        let config = parse_gateway_run_config(&[
            "--reset".to_string(),
            "--verbose".to_string(),
            "--port".to_string(),
            "19001".to_string(),
        ])
        .unwrap();
        assert_eq!(config.port, 19001);
    }

    #[test]
    fn normalizes_root_profile_flags_before_command_dispatch() {
        let _guard = env_lock().lock().expect("env lock");
        let previous_state = env::var_os("CRAWCLAW_STATE_DIR");
        let previous_config = env::var_os("CRAWCLAW_CONFIG_PATH");
        env::remove_var("CRAWCLAW_STATE_DIR");
        env::remove_var("CRAWCLAW_CONFIG_PATH");

        let args = normalize_root_args(vec![
            "--dev".to_string(),
            "--lang".to_string(),
            "zh-CN".to_string(),
            "gateway".to_string(),
            "--reset".to_string(),
        ])
        .unwrap();

        assert_eq!(args, vec!["gateway".to_string(), "--reset".to_string()]);
        assert!(env::var_os("CRAWCLAW_STATE_DIR")
            .unwrap()
            .to_string_lossy()
            .ends_with(".crawclaw-dev"));

        restore_env("CRAWCLAW_STATE_DIR", previous_state);
        restore_env("CRAWCLAW_CONFIG_PATH", previous_config);
    }

    #[test]
    fn writes_completion_state_to_crawclaw_state_dir() {
        let _guard = env_lock().lock().expect("env lock");
        let dir = unique_temp_dir("completion-state");
        let previous = env::var_os("CRAWCLAW_STATE_DIR");
        env::set_var("CRAWCLAW_STATE_DIR", &dir);

        write_completion_state(&["zsh", "bash", "fish", "powershell"]).unwrap();

        assert!(completion_cache_path(&dir.join("completions"), "zsh").exists());
        assert!(completion_cache_path(&dir.join("completions"), "bash").exists());
        assert!(completion_cache_path(&dir.join("completions"), "fish").exists());
        assert!(completion_cache_path(&dir.join("completions"), "powershell").exists());

        restore_env("CRAWCLAW_STATE_DIR", previous);
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn plugins_install_command_uses_rust_gateway_lifecycle() {
        let _guard = env_lock().lock().expect("env lock");
        let dir = unique_temp_dir("plugins-command");
        let state_dir = dir.join("state");
        let config_path = state_dir.join("crawclaw.json");
        let plugin_dir = dir.join("plugin");
        fs::create_dir_all(&plugin_dir).unwrap();
        fs::write(
            plugin_dir.join("crawclaw.plugin.json"),
            r#"{"id":"rust-cli-demo","name":"Rust CLI Demo","version":"1.0.0"}"#,
        )
        .unwrap();

        let previous_state = env::var_os("CRAWCLAW_STATE_DIR");
        let previous_config = env::var_os("CRAWCLAW_CONFIG_PATH");
        let previous_runtime = env::var_os("CRAWCLAW_RUNTIME_ROOT");
        env::set_var("CRAWCLAW_STATE_DIR", &state_dir);
        env::set_var("CRAWCLAW_CONFIG_PATH", &config_path);
        env::set_var("CRAWCLAW_RUNTIME_ROOT", state_dir.join("runtime"));

        let installed = plugins_command_result(&[
            "install".to_string(),
            plugin_dir.to_string_lossy().to_string(),
            "--json".to_string(),
        ])
        .await
        .unwrap();
        assert!(installed.json);
        assert_eq!(installed.value["implementation"], "rust-native");
        assert_eq!(installed.value["pluginId"], "rust-cli-demo");

        let config: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(
            config["plugins"]["entries"]["rust-cli-demo"]["enabled"],
            true
        );
        assert_eq!(
            config["plugins"]["installs"]["rust-cli-demo"]["source"],
            "path"
        );

        let updated = plugins_command_result(&[
            "update".to_string(),
            "rust-cli-demo".to_string(),
            "--dry-run".to_string(),
            "--json".to_string(),
        ])
        .await
        .unwrap();
        assert!(updated.json);
        assert_eq!(updated.value["implementation"], "rust-native");

        restore_env("CRAWCLAW_STATE_DIR", previous_state);
        restore_env("CRAWCLAW_CONFIG_PATH", previous_config);
        restore_env("CRAWCLAW_RUNTIME_ROOT", previous_runtime);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn gateway_systemd_unit_uses_native_cli_entrypoint() {
        let unit = build_gateway_systemd_unit(&PathBuf::from("/opt/CrawClaw/bin/crawclaw"));
        assert!(unit.contains("ExecStart=/opt/CrawClaw/bin/crawclaw gateway --allow-unconfigured"));
    }

    #[test]
    fn systemd_escape_quotes_paths_with_spaces() {
        assert_eq!(
            systemd_escape_arg("/Applications/CrawClaw Desktop.app/bin/crawclaw"),
            "\"/Applications/CrawClaw Desktop.app/bin/crawclaw\"",
        );
    }

    #[test]
    fn runtime_stage_records_pi_quickjs_plugin_runtime() {
        let dir = unique_temp_dir("runtime-stage");

        stage_runtime(dir.clone());

        let runtime_manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("runtimes/manifest.json")).unwrap())
                .unwrap();
        let provider_manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("providers/manifest.json")).unwrap())
                .unwrap();
        let plugin_manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("plugins/manifest.json")).unwrap())
                .unwrap();
        assert_eq!(runtime_manifest["jsPluginRuntime"], "pi-quickjs");
        assert!(provider_manifest["providerDescriptors"]
            .as_array()
            .expect("provider descriptors")
            .iter()
            .any(|provider| provider["provider"] == "openai"
                && provider["transport"] == "openai-responses"));
        assert!(provider_manifest["defaultModels"]
            .as_array()
            .expect("default models")
            .iter()
            .any(|model| model["provider"] == "openai" && model["model"] == "gpt-5.4"));
        assert_eq!(plugin_manifest["jsPluginRuntime"], "pi-quickjs");
        assert!(!dir.join("compat/js-plugin-runner.mjs").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn config_set_and_get_round_trips_nested_json() {
        let _guard = env_lock().lock().expect("env lock");
        let dir = unique_temp_dir("config-store");
        let previous = env::var_os("CRAWCLAW_CONFIG_PATH");
        let config_path = dir.join("crawclaw.json");
        env::set_var("CRAWCLAW_CONFIG_PATH", &config_path);

        config_set(
            "channels.discord.guilds",
            serde_json::json!({"guild": {"allow": true}}),
        )
        .unwrap();
        assert_eq!(
            config_get("channels.discord.guilds").unwrap(),
            Some(serde_json::json!({"guild": {"allow": true}})),
        );

        restore_env("CRAWCLAW_CONFIG_PATH", previous);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn parses_strict_and_scalar_config_values() {
        assert_eq!(
            parse_config_value("{\"enabled\":true}", true).unwrap(),
            serde_json::json!({"enabled": true}),
        );
        assert_eq!(
            parse_config_value("true", false).unwrap(),
            serde_json::json!(true)
        );
        assert_eq!(
            parse_config_value("18789", false).unwrap(),
            serde_json::json!(18789)
        );
        assert_eq!(
            parse_config_value("token", false).unwrap(),
            serde_json::json!("token"),
        );
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("crawclaw-{label}-{}-{suffix}", std::process::id()))
    }

    fn restore_env(key: &str, previous: Option<std::ffi::OsString>) {
        match previous {
            Some(value) => env::set_var(key, value),
            None => env::remove_var(key),
        }
    }
}

use std::env;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use reqwest::StatusCode;
use serde_json::{json, Map, Value};
use tokio::process::Command;
use tokio::time::sleep;

use crate::{NativeError, NativeResult};

const DEFAULT_PRESET_INSTRUCTIONS: &str = "natural, warm, expressive";
const PRESET_FAST_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice";
const PRESET_BALANCED_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice";
const CLONE_FAST_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-0.6B-Base";
const CLONE_BALANCED_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-1.7B-Base";
const VOICE_DESIGN_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign";
const DEFAULT_READY_POLL_INTERVAL_MS: u64 = 250;

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::InvalidInput(message.into())
}

fn as_object<'a>(value: &'a Value, label: &str) -> NativeResult<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("Qwen3-TTS {label} must be an object")))
}

fn object_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> NativeResult<&'a Map<String, Value>> {
    object
        .get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(format!("Qwen3-TTS input missing {key} object")))
}

fn string_field<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn required_string(object: &Map<String, Value>, key: &str) -> NativeResult<String> {
    string_field(object, key)
        .map(ToOwned::to_owned)
        .ok_or_else(|| invalid(format!("Qwen3-TTS input missing {key}")))
}

fn trailing_slash_trimmed(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn normalize_health_path(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("/health").trim();
    if trimmed.is_empty() {
        return "/health".to_string();
    }
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn qwen_runtime_defaults(raw_runtime: Option<&str>) -> (&'static str, &'static str) {
    match raw_runtime.unwrap_or("auto").trim() {
        "mlx-audio" => ("mlx-audio", "http://127.0.0.1:8011"),
        "vllm-omni" => ("vllm-omni", "http://127.0.0.1:8010"),
        "qwen3-tts.cpp" => ("qwen3-tts.cpp", "http://127.0.0.1:8012"),
        "qwen-tts" | "cpu" => ("qwen-tts", "http://127.0.0.1:8013"),
        _ if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") => {
            ("mlx-audio", "http://127.0.0.1:8011")
        }
        _ => ("qwen-tts", "http://127.0.0.1:8013"),
    }
}

fn response_format(input: &Map<String, Value>) -> String {
    if let Some(value) = string_field(input, "responseFormat") {
        return value.to_string();
    }
    match string_field(input, "target") {
        Some("telephony") => "pcm".to_string(),
        Some("voice-note") => "opus".to_string(),
        _ => "wav".to_string(),
    }
}

fn profile_id<'a>(
    input: &'a Map<String, Value>,
    provider_config: &'a Map<String, Value>,
    overrides: &'a Map<String, Value>,
) -> &'a str {
    if let Some(profile) = string_field(overrides, "profile") {
        return profile;
    }
    if let Some(agent_id) = string_field(input, "agentId") {
        if let Some(agent_profile) = provider_config
            .get("agentProfiles")
            .and_then(Value::as_object)
            .and_then(|profiles| profiles.get(agent_id))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return agent_profile;
        }
    }
    string_field(provider_config, "defaultProfile").unwrap_or("assistant")
}

fn resolve_profile<'a>(
    input: &'a Map<String, Value>,
    provider_config: &'a Map<String, Value>,
    overrides: &'a Map<String, Value>,
) -> NativeResult<&'a Map<String, Value>> {
    let selected_profile_id = profile_id(input, provider_config, overrides);
    provider_config
        .get("profiles")
        .and_then(Value::as_object)
        .and_then(|profiles| profiles.get(selected_profile_id))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            invalid(format!(
                "Qwen3-TTS profile \"{selected_profile_id}\" is not defined"
            ))
        })
}

fn preset_model(profile: &Map<String, Value>, overrides: &Map<String, Value>) -> String {
    if let Some(model) = string_field(overrides, "model") {
        return model.to_string();
    }
    match string_field(profile, "quality") {
        Some("fast") => PRESET_FAST_MODEL.to_string(),
        _ => PRESET_BALANCED_MODEL.to_string(),
    }
}

fn clone_model(profile: &Map<String, Value>, overrides: &Map<String, Value>) -> String {
    if let Some(model) = string_field(overrides, "model") {
        return model.to_string();
    }
    match string_field(profile, "quality") {
        Some("clone-fast") => CLONE_FAST_MODEL.to_string(),
        _ => CLONE_BALANCED_MODEL.to_string(),
    }
}

fn set_optional_string(payload: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        payload.insert(key.to_string(), Value::String(value));
    }
}

pub fn build_synthesis_payload(input_value: &Value) -> NativeResult<Value> {
    let input = as_object(input_value, "input")?;
    let text = required_string(input, "text")?;
    let provider_config = object_field(input, "providerConfig")?;
    let empty_overrides = Map::new();
    let overrides = input
        .get("providerOverrides")
        .and_then(Value::as_object)
        .unwrap_or(&empty_overrides);
    let profile = resolve_profile(input, provider_config, overrides)?;
    let runtime = string_field(provider_config, "runtime")
        .unwrap_or("qwen-tts")
        .to_string();
    let response_format = response_format(input);
    let source = string_field(profile, "source").unwrap_or("preset");

    let mut payload = Map::new();
    payload.insert("text".to_string(), Value::String(text));
    payload.insert("responseFormat".to_string(), Value::String(response_format));
    payload.insert("runtime".to_string(), Value::String(runtime));

    match source {
        "clone" => {
            let ref_text = required_string(profile, "refText")?;
            payload.insert("task".to_string(), Value::String("clone".to_string()));
            payload.insert(
                "model".to_string(),
                Value::String(clone_model(profile, overrides)),
            );
            payload.insert(
                "refAudio".to_string(),
                Value::String(required_string(profile, "refAudio")?),
            );
            payload.insert("refText".to_string(), Value::String(ref_text));
            set_optional_string(
                &mut payload,
                "language",
                string_field(overrides, "language")
                    .or_else(|| string_field(profile, "language"))
                    .map(ToOwned::to_owned),
            );
            set_optional_string(
                &mut payload,
                "instructions",
                string_field(overrides, "instructions")
                    .or_else(|| string_field(profile, "instructions"))
                    .map(ToOwned::to_owned),
            );
        }
        "design" => {
            payload.insert("task".to_string(), Value::String("design".to_string()));
            payload.insert(
                "model".to_string(),
                Value::String(
                    string_field(overrides, "model")
                        .unwrap_or(VOICE_DESIGN_MODEL)
                        .to_string(),
                ),
            );
            payload.insert(
                "prompt".to_string(),
                Value::String(required_string(profile, "prompt")?),
            );
            set_optional_string(
                &mut payload,
                "language",
                string_field(overrides, "language")
                    .or_else(|| string_field(profile, "language"))
                    .map(ToOwned::to_owned),
            );
        }
        _ => {
            payload.insert("task".to_string(), Value::String("preset".to_string()));
            payload.insert(
                "model".to_string(),
                Value::String(preset_model(profile, overrides)),
            );
            payload.insert(
                "voice".to_string(),
                Value::String(
                    string_field(overrides, "voice")
                        .or_else(|| string_field(profile, "voice"))
                        .unwrap_or("vivian")
                        .to_string(),
                ),
            );
            payload.insert(
                "language".to_string(),
                Value::String(
                    string_field(overrides, "language")
                        .or_else(|| string_field(profile, "language"))
                        .unwrap_or("Auto")
                        .to_string(),
                ),
            );
            payload.insert(
                "instructions".to_string(),
                Value::String(
                    string_field(overrides, "instructions")
                        .or_else(|| string_field(profile, "instructions"))
                        .unwrap_or(DEFAULT_PRESET_INSTRUCTIONS)
                        .to_string(),
                ),
            );
        }
    }

    Ok(Value::Object(payload))
}

fn sidecar_url(input: &Value) -> NativeResult<String> {
    let input = as_object(input, "input")?;
    let provider_config = object_field(input, "providerConfig")?;
    let base_url = string_field(provider_config, "baseUrl")
        .ok_or_else(|| invalid("Qwen3-TTS input missing providerConfig.baseUrl"))?;
    let path = if string_field(input, "target") == Some("telephony") {
        "synthesize-telephony"
    } else {
        "synthesize"
    };
    Ok(format!("{}/{}", trailing_slash_trimmed(base_url), path))
}

fn timeout(input: &Value) -> Duration {
    let timeout_ms = input
        .as_object()
        .and_then(|object| object.get("timeoutMs"))
        .and_then(Value::as_u64)
        .unwrap_or(30_000);
    Duration::from_millis(timeout_ms)
}

fn provider_config(input: &Value) -> Option<&Map<String, Value>> {
    input
        .get("providerConfig")
        .and_then(Value::as_object)
        .or_else(|| {
            input
                .get("input")
                .and_then(Value::as_object)
                .and_then(|input| input.get("providerConfig"))
                .and_then(Value::as_object)
        })
        .or_else(|| {
            input
                .get("pluginConfig")
                .and_then(Value::as_object)
                .and_then(|plugin_config| plugin_config.get("providerConfig"))
                .and_then(Value::as_object)
        })
}

fn string_config<'a>(config: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    string_field(config, key)
}

fn bool_config(config: &Map<String, Value>, key: &str) -> bool {
    config.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn u64_config(config: &Map<String, Value>, key: &str, fallback: u64) -> u64 {
    config.get(key).and_then(Value::as_u64).unwrap_or(fallback)
}

fn string_array_config(config: &Map<String, Value>, key: &str) -> Vec<String> {
    config
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn top_string<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn path_list_separator() -> char {
    if cfg!(windows) {
        ';'
    } else {
        ':'
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn state_dir() -> PathBuf {
    env::var("CRAWCLAW_STATE_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".crawclaw")))
        .unwrap_or_else(|| PathBuf::from(".crawclaw"))
}

fn plugin_runtime_roots() -> Vec<PathBuf> {
    if let Ok(value) = env::var("CRAWCLAW_PLUGIN_RUNTIMES_DIR") {
        let roots = value
            .split(path_list_separator())
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        if !roots.is_empty() {
            return roots;
        }
    }
    vec![state_dir().join("runtimes")]
}

fn qwen3_tts_runtime_python() -> PathBuf {
    let runtime_dir = plugin_runtime_roots()
        .into_iter()
        .map(|root| root.join("qwen3-tts"))
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| state_dir().join("runtimes").join("qwen3-tts"));
    let venv = runtime_dir.join("venv");
    if cfg!(windows) {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

fn qwen3_tts_sidecar_script_candidates(input: &Value, filename: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(plugin_root) = top_string(input, "pluginRoot") {
        candidates.push(PathBuf::from(plugin_root).join("python").join(filename));
    }
    if let Some(workspace_dir) = top_string(input, "workspaceDir") {
        candidates.push(
            PathBuf::from(workspace_dir)
                .join("extensions")
                .join("qwen3-tts")
                .join("python")
                .join(filename),
        );
    }
    if let Ok(cwd) = env::current_dir() {
        candidates.push(
            cwd.join("extensions")
                .join("qwen3-tts")
                .join("python")
                .join(filename),
        );
    }
    if let Ok(exe) = env::current_exe() {
        for ancestor in exe.ancestors() {
            candidates.push(
                ancestor
                    .join("extensions")
                    .join("qwen3-tts")
                    .join("python")
                    .join(filename),
            );
        }
    }
    candidates
}

fn qwen3_tts_sidecar_script(input: &Value, runtime: &str) -> PathBuf {
    let filename = if runtime == "mlx-audio" {
        "qwen3_tts_sidecar.py"
    } else {
        "qwen3_tts_python_sidecar.py"
    };
    let candidates = qwen3_tts_sidecar_script_candidates(input, filename);
    candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned()
        .unwrap_or_else(|| {
            candidates
                .into_iter()
                .next()
                .unwrap_or_else(|| PathBuf::from(filename))
        })
}

fn qwen3_tts_managed_runtime(runtime: &str) -> Option<&'static str> {
    match runtime {
        "mlx-audio" => Some("mlx-audio"),
        "qwen-tts" | "cpu" => Some("qwen-tts"),
        _ => None,
    }
}

fn sidecar_host_port(base_url: &str, fallback_port: &str) -> NativeResult<(String, String)> {
    let parsed = reqwest::Url::parse(base_url)
        .map_err(|error| invalid(format!("Invalid Qwen3-TTS baseUrl: {error}")))?;
    let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
    let port = parsed
        .port()
        .map(|port| port.to_string())
        .unwrap_or_else(|| fallback_port.to_string());
    Ok((host, port))
}

fn fill_default_launch_config(
    config: &mut Map<String, Value>,
    input: &Value,
    runtime: &str,
    base_url: &str,
    health_path: &str,
) -> NativeResult<()> {
    if string_config(config, "launchCommand").is_some()
        || !string_array_config(config, "launchArgs").is_empty()
    {
        return Ok(());
    }
    let Some(managed_runtime) = qwen3_tts_managed_runtime(runtime) else {
        return Ok(());
    };
    let fallback_port = if managed_runtime == "mlx-audio" {
        "8011"
    } else {
        "8013"
    };
    let (host, port) = sidecar_host_port(base_url, fallback_port)?;
    config.insert(
        "managedRuntime".to_string(),
        Value::String(managed_runtime.to_string()),
    );
    config.insert(
        "launchCommand".to_string(),
        Value::String(qwen3_tts_runtime_python().to_string_lossy().to_string()),
    );
    config.insert(
        "launchArgs".to_string(),
        Value::Array(vec![
            Value::String(
                qwen3_tts_sidecar_script(input, runtime)
                    .to_string_lossy()
                    .to_string(),
            ),
            Value::String("--host".to_string()),
            Value::String(host),
            Value::String("--port".to_string()),
            Value::String(port),
            Value::String("--health-path".to_string()),
            Value::String(health_path.to_string()),
        ]),
    );
    Ok(())
}

fn is_loopback_base_url(base_url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(base_url) else {
        return false;
    };
    if parsed.scheme() != "http" {
        return false;
    }
    matches!(
        parsed.host_str().map(|host| host.to_ascii_lowercase()),
        Some(host) if host == "localhost" || host == "127.0.0.1" || host == "::1"
    )
}

fn health_url(base_url: &str, health_path: &str) -> NativeResult<String> {
    let mut url = reqwest::Url::parse(&trailing_slash_trimmed(base_url))
        .map_err(|error| invalid(format!("Invalid Qwen3-TTS baseUrl: {error}")))?;
    url.set_path(health_path);
    url.set_query(None);
    Ok(url.to_string())
}

async fn probe_ready(base_url: &str, health_path: &str) -> NativeResult<bool> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()?;
    let response = client
        .get(health_url(base_url, health_path)?)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await;
    Ok(response
        .map(|response| response.status().is_success())
        .unwrap_or(false))
}

async fn wait_for_ready(base_url: &str, health_path: &str, timeout_ms: u64) -> NativeResult<()> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while Instant::now() <= deadline {
        if probe_ready(base_url, health_path).await? {
            return Ok(());
        }
        sleep(Duration::from_millis(DEFAULT_READY_POLL_INTERVAL_MS)).await;
    }
    Err(NativeError::Message(format!(
        "Managed Qwen3-TTS daemon did not become ready at {base_url}{health_path} within {timeout_ms}ms."
    )))
}

fn daemon_log_path() -> PathBuf {
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".crawclaw")
        .join("logs")
        .join("qwen3-tts-daemon.log")
}

fn runtime_check_script(runtime: Option<&str>) -> &'static str {
    if runtime == Some("qwen-tts") {
        return "import qwen_tts\nimport torch\nimport soundfile\nimport numpy\nprint('ok')\n";
    }
    "import mlx\nimport mlx_audio\nimport huggingface_hub\nimport numpy\nimport soundfile\nimport librosa\nimport transformers\nprint('ok')\n"
}

async fn ensure_managed_runtime_ready(command: &str, runtime: Option<&str>) -> NativeResult<()> {
    let output = Command::new(command)
        .arg("-c")
        .arg(runtime_check_script(runtime))
        .env("NO_COLOR", "1")
        .output()
        .await?;
    if output.status.success() {
        return Ok(());
    }
    let detail = [
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    Err(NativeError::Message(format!(
        "Qwen3-TTS runtime is not installed or failed verification. Configure the native Qwen3-TTS sidecar runtime.{}",
        if detail.is_empty() {
            String::new()
        } else {
            format!(" Verification error: {detail}")
        }
    )))
}

async fn spawn_daemon(config: &Map<String, Value>) -> NativeResult<u32> {
    let command = string_config(config, "launchCommand")
        .ok_or_else(|| invalid("Qwen3-TTS autoStart requires launchCommand"))?;
    if let Some(runtime) = string_config(config, "managedRuntime") {
        ensure_managed_runtime_ready(command, Some(runtime)).await?;
    }
    let log_path = daemon_log_path();
    if let Some(parent) = log_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let stderr = stdout.try_clone()?;
    let mut process = Command::new(command);
    process
        .args(string_array_config(config, "launchArgs"))
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .env("NO_COLOR", "1");
    if let Some(cwd) = string_config(config, "launchCwd") {
        process.current_dir(cwd);
    }
    let child = process.spawn()?;
    Ok(child.id().unwrap_or_default())
}

pub async fn start_qwen3_tts_service(input: Value) -> NativeResult<Value> {
    let empty = Map::new();
    let config = provider_config(&input).unwrap_or(&empty);
    let (runtime, default_base_url) = qwen_runtime_defaults(string_config(config, "runtime"));
    let base_url = string_config(config, "baseUrl")
        .map(trailing_slash_trimmed)
        .unwrap_or_else(|| default_base_url.to_string());
    let health_path = normalize_health_path(string_config(config, "healthPath"));
    let auto_start = bool_config(config, "autoStart");
    let startup_timeout_ms = u64_config(config, "startupTimeoutMs", 30_000);

    if !auto_start || !is_loopback_base_url(&base_url) {
        return Ok(json!({
            "status": "external",
            "provider": "qwen3-tts",
            "runtime": runtime,
            "baseUrl": base_url,
            "healthPath": health_path
        }));
    }

    if probe_ready(&base_url, &health_path).await? {
        return Ok(json!({
            "status": "running",
            "provider": "qwen3-tts",
            "runtime": runtime,
            "baseUrl": base_url,
            "healthPath": health_path
        }));
    }

    let mut resolved_config = config.clone();
    fill_default_launch_config(
        &mut resolved_config,
        &input,
        runtime,
        &base_url,
        &health_path,
    )?;
    let pid = spawn_daemon(&resolved_config).await?;
    wait_for_ready(&base_url, &health_path, startup_timeout_ms).await?;
    Ok(json!({
        "status": "started",
        "provider": "qwen3-tts",
        "runtime": runtime,
        "baseUrl": base_url,
        "healthPath": health_path,
        "pid": pid
    }))
}

pub fn stop_qwen3_tts_service() -> Value {
    json!({
        "status": "not-supported",
        "provider": "qwen3-tts",
        "message": "Qwen3-TTS daemon stop is not tracked yet; stop the configured launchCommand process manually."
    })
}

fn validate_sidecar_response(status: StatusCode, payload: Value) -> NativeResult<Value> {
    if !status.is_success() {
        return Err(NativeError::Message(format!(
            "Qwen3-TTS sidecar error ({}): {}",
            status.as_u16(),
            payload
        )));
    }
    let object = as_object(&payload, "sidecar response")?;
    let audio_base64 = string_field(object, "audioBase64");
    let output_format = string_field(object, "outputFormat");
    if audio_base64.is_none() || output_format.is_none() {
        return Err(invalid("Qwen3-TTS sidecar returned an incomplete response"));
    }
    Ok(json!(object))
}

pub async fn synthesize_qwen3_tts(input: Value) -> NativeResult<Value> {
    let payload = build_synthesis_payload(&input)?;
    let url = sidecar_url(&input)?;
    let client = reqwest::Client::builder()
        .timeout(timeout(&input))
        .build()?;
    let response = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&payload)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    let parsed = serde_json::from_str(&body).unwrap_or_else(|_| json!({ "message": body }));
    validate_sidecar_response(status, parsed)
}

use std::env;
use std::fs::{self, OpenOptions};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::Utc;
use reqwest::Url;
use serde_json::{json, Value};

use crate::error::{invalid_input, runtime_error, NativeError, NativeResult};
use crate::spider_fetch::run_spider_dynamic_fetch;

const DEFAULT_SEARCH_COUNT: usize = 5;
const DEFAULT_TIMEOUT_SECONDS: u64 = 20;
pub(crate) const DESKTOP_USER_AGENT: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const SEARXNG_DEFAULT_HOST: &str = "127.0.0.1";
const SEARXNG_DEFAULT_PORT: u64 = 3210;
const SEARXNG_DEFAULT_STARTUP_TIMEOUT_MS: u64 = 20_000;
const SEARXNG_DEFAULT_HEALTH_PATH: &str = "/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearxngSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub engine: Option<String>,
    pub source: Option<String>,
    pub category: Option<String>,
    pub published_at: Option<String>,
}

pub struct SearxngSearchRequest {
    pub query: String,
    pub engines: Vec<String>,
    pub categories: Vec<String>,
    pub language: Option<String>,
    pub safe_search: Option<String>,
    pub time_range: Option<String>,
}

pub async fn run_searxng_search(input: Value) -> NativeResult<Value> {
    let params = tool_params(&input);
    let query = read_required_string(params, "query")?;
    let count = read_count(params);
    let base_url = resolve_searxng_base_url(&input, params);
    validate_searxng_base_url(&base_url)?;
    let auto_start = read_bool(params, "autoStart")
        .or_else(|| nested_bool(&input, &["pluginConfig", "webSearch", "autoStart"]))
        .unwrap_or(true);
    let startup_timeout_ms = read_u64(params, "startupTimeoutMs")
        .or_else(|| nested_u64(&input, &["pluginConfig", "webSearch", "startupTimeoutMs"]))
        .unwrap_or(SEARXNG_DEFAULT_STARTUP_TIMEOUT_MS);
    let health_path = read_string(params, "healthPath")
        .or_else(|| nested_string(&input, &["pluginConfig", "webSearch", "healthPath"]))
        .unwrap_or_else(|| SEARXNG_DEFAULT_HEALTH_PATH.to_string());
    if auto_start {
        ensure_searxng_daemon(&input, &base_url, &health_path, startup_timeout_ms).await?;
    }
    let timeout_seconds = read_u64(params, "timeoutSeconds").unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    let started = Instant::now();
    let categories = {
        let from_params = read_string_list_param(params, "categories");
        if from_params.is_empty() {
            nested_string(&input, &["pluginConfig", "webSearch", "categories"])
                .map(|value| split_csv(&value))
                .unwrap_or_default()
        } else {
            from_params
        }
    };
    let request = SearxngSearchRequest {
        query: query.clone(),
        engines: read_string_list_param(params, "engines"),
        categories,
        language: read_string(params, "language")
            .or_else(|| nested_string(&input, &["pluginConfig", "webSearch", "language"])),
        safe_search: normalize_searxng_safe_search(read_string(params, "safeSearch"))?,
        time_range: normalize_searxng_time_range(read_string(params, "timeRange"))?,
    };
    let url = build_searxng_search_url(&base_url, &request)?;
    let text = http_get_text(url.as_str(), timeout_seconds, "SearXNG").await?;
    let results = parse_searxng_response_text(&text, count)?;
    Ok(searxng_payload(&query, results, started))
}

pub async fn start_searxng_service(input: Value) -> NativeResult<Value> {
    let params = tool_params(&input);
    let base_url = resolve_searxng_base_url(&input, params);
    validate_searxng_base_url(&base_url)?;
    let startup_timeout_ms = read_u64(params, "startupTimeoutMs")
        .or_else(|| nested_u64(&input, &["pluginConfig", "webSearch", "startupTimeoutMs"]))
        .unwrap_or(SEARXNG_DEFAULT_STARTUP_TIMEOUT_MS);
    let health_path = read_string(params, "healthPath")
        .or_else(|| nested_string(&input, &["pluginConfig", "webSearch", "healthPath"]))
        .unwrap_or_else(|| SEARXNG_DEFAULT_HEALTH_PATH.to_string());
    ensure_searxng_daemon(&input, &base_url, &health_path, startup_timeout_ms).await?;
    Ok(json!({
        "status": "running",
        "provider": "searxng",
        "baseUrl": base_url,
        "healthPath": health_path
    }))
}

pub fn stop_searxng_service() -> Value {
    json!({
        "status": "not-supported",
        "provider": "searxng",
        "message": "SearXNG is launched as a detached local Python sidecar in this runtime."
    })
}

pub async fn run_spider_fetch(input: Value) -> NativeResult<Value> {
    let params = tool_params(&input);
    let url = read_required_string(params, "url")?;
    let output = read_string(params, "output")
        .or_else(|| read_string(params, "extractMode"))
        .unwrap_or_else(|| "markdown".to_string());
    let render = read_string(params, "render").unwrap_or_else(|| "auto".to_string());
    let timeout_seconds = read_u64(params, "timeoutSeconds").unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    let max_chars = read_u64(params, "maxChars").unwrap_or(20_000) as usize;
    let started = Instant::now();
    if render == "dynamic" || render == "stealth" {
        return run_spider_dynamic_fetch(params, &url, &output, &render, started).await;
    }
    let client = http_client_builder(&url, timeout_seconds).build()?;
    let response = client.get(&url).send().await?;
    let status_code = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("text/plain")
        .to_string();
    let body = response.text().await?;
    let title = extract_html_title(&body);
    let plain_text = strip_html(&body);
    let selected = match output.as_str() {
        "html" => body.clone(),
        "text" | "markdown" | "structured" => plain_text.clone(),
        _ => plain_text.clone(),
    };
    let (content, truncated) = truncate_chars(&selected, max_chars);
    let content_preview = truncate_chars(&plain_text, 2_000).0;
    let wrapped_preview = wrap_web_content(&content_preview, "web_fetch");
    let wrapped_content = wrap_web_content(&content, "web_fetch");
    let wrapped_text = wrap_external_content(&content, "web_fetch", true);
    let wrapped_html = if output == "html" {
        Some(wrap_web_content(&content, "web_fetch"))
    } else {
        None
    };
    Ok(json!({
        "status": "ok",
        "provider": "spider",
        "fetcher": "spider-rust-static",
        "url": url,
        "finalUrl": final_url,
        "statusCode": status_code,
        "contentType": content_type,
        "title": title,
        "summary": Value::Null,
        "keyPoints": Value::Null,
        "headings": Value::Null,
        "contentPreview": wrapped_preview,
        "html": wrapped_html,
        "content": wrapped_content,
        "text": wrapped_text,
        "metadata": {
            "runtime": "rust-native",
            "render": render,
            "staticFetch": true
        },
        "externalContent": {
            "untrusted": true,
            "source": "web_fetch",
            "provider": "spider",
            "wrapped": true
        },
        "rendered": false,
        "usedFallback": false,
        "blockedDetected": false,
        "truncated": truncated,
        "length": content.chars().count(),
        "rawLength": selected.chars().count(),
        "wrappedLength": wrapped_content.chars().count(),
        "fetchedAt": now_iso_like(),
        "tookMs": started.elapsed().as_millis() as u64,
        "warning": Value::Null,
        "request": {
            "url": url,
            "output": output,
            "render": render,
            "timeoutSeconds": timeout_seconds,
            "maxChars": max_chars
        }
    }))
}

pub fn build_searxng_search_url(
    base_url: &str,
    request: &SearxngSearchRequest,
) -> NativeResult<Url> {
    let mut url = Url::parse(base_url)
        .map_err(|_| invalid_input("SearXNG base URL must be a valid http:// or https:// URL."))?;
    let pathname = if url.path().ends_with('/') {
        format!("{}search", url.path())
    } else {
        format!("{}/search", url.path())
    };
    url.set_path(&pathname);
    {
        let mut query = url.query_pairs_mut();
        query.clear();
        query.append_pair("q", &request.query);
        query.append_pair("format", "json");
        if !request.engines.is_empty() {
            query.append_pair("engines", &request.engines.join(","));
        }
        if !request.categories.is_empty() {
            query.append_pair("categories", &request.categories.join(","));
        }
        if let Some(language) = &request.language {
            query.append_pair("language", language);
        }
        if let Some(safe_search) = &request.safe_search {
            query.append_pair("safesearch", safe_search);
        }
        if let Some(time_range) = &request.time_range {
            query.append_pair("time_range", time_range);
        }
    }
    Ok(url)
}

pub fn parse_searxng_response_text(
    text: &str,
    count: usize,
) -> NativeResult<Vec<SearxngSearchResult>> {
    let parsed: Value =
        serde_json::from_str(text).map_err(|_| invalid_input("SearXNG returned invalid JSON."))?;
    let raw_results = parsed
        .as_array()
        .or_else(|| parsed.get("results").and_then(Value::as_array))
        .or_else(|| {
            parsed
                .get("data")
                .and_then(|data| data.get("results"))
                .and_then(Value::as_array)
        });
    let mut results = Vec::new();
    if let Some(raw_results) = raw_results {
        for raw in raw_results {
            let Some(url) = raw.get("url").and_then(Value::as_str).map(str::trim) else {
                continue;
            };
            let Some(title) = raw.get("title").and_then(Value::as_str).map(str::trim) else {
                continue;
            };
            if url.is_empty() || title.is_empty() {
                continue;
            }
            let snippet = raw
                .get("snippet")
                .or_else(|| raw.get("description"))
                .or_else(|| raw.get("content"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let engine = value_string(raw.get("engine")).or_else(|| {
                raw.get("engines")
                    .and_then(Value::as_array)
                    .and_then(|values| values.iter().filter_map(value_string_from_value).next())
            });
            let source = raw
                .get("source")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            results.push(SearxngSearchResult {
                title: title.to_string(),
                url: url.to_string(),
                snippet,
                engine,
                source: source.or_else(|| value_string(raw.get("parsed_url"))),
                category: value_string(raw.get("category")),
                published_at: value_string(raw.get("publishedDate"))
                    .or_else(|| value_string(raw.get("published_date"))),
            });
            if results.len() >= count {
                break;
            }
        }
    }
    Ok(results)
}

pub fn searxng_runtime_python_candidates(
    workspace_dir: Option<&Path>,
    state_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(workspace_dir) = workspace_dir {
        candidates.push(searxng_python_for_runtime_root(
            &workspace_dir.join("runtimes"),
        ));
    }
    if let Ok(root) = env::var("CRAWCLAW_PLUGIN_RUNTIMES_DIR") {
        for root in split_path_list(&root) {
            candidates.push(searxng_python_for_runtime_root(&root));
        }
    }
    if let Some(state_dir) = state_dir {
        candidates.push(searxng_python_for_runtime_root(&state_dir.join("runtimes")));
    }
    candidates
}

pub fn searxng_settings_candidates(
    workspace_dir: Option<&Path>,
    state_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(workspace_dir) = workspace_dir {
        candidates.push(
            workspace_dir
                .join("runtimes")
                .join("searxng")
                .join("settings.yml"),
        );
    }
    if let Ok(root) = env::var("CRAWCLAW_PLUGIN_RUNTIMES_DIR") {
        for root in split_path_list(&root) {
            candidates.push(root.join("searxng").join("settings.yml"));
        }
    }
    if let Some(state_dir) = state_dir {
        candidates.push(
            state_dir
                .join("runtimes")
                .join("searxng")
                .join("settings.yml"),
        );
    }
    candidates
}

pub fn strip_html(html: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                output.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    normalize_whitespace(&output)
}

pub fn decode_html_entities(text: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0;
    while let Some(start_rel) = text[cursor..].find('&') {
        let start = cursor + start_rel;
        output.push_str(&text[cursor..start]);
        let Some(end_rel) = text[start..].find(';') else {
            output.push_str(&text[start..]);
            return output;
        };
        let end = start + end_rel;
        let entity = &text[start + 1..end];
        let decoded = match entity {
            "amp" => Some("&".to_string()),
            "lt" => Some("<".to_string()),
            "gt" => Some(">".to_string()),
            "quot" => Some("\"".to_string()),
            "apos" | "#39" | "#x27" => Some("'".to_string()),
            "nbsp" => Some(" ".to_string()),
            "ndash" => Some("-".to_string()),
            "mdash" => Some("--".to_string()),
            "hellip" => Some("...".to_string()),
            _ if entity.starts_with("#x") => u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32)
                .map(|ch| ch.to_string()),
            _ if entity.starts_with('#') => entity[1..]
                .parse::<u32>()
                .ok()
                .and_then(char::from_u32)
                .map(|ch| ch.to_string()),
            _ => None,
        };
        if let Some(decoded) = decoded {
            output.push_str(&decoded);
        } else {
            output.push_str(&text[start..=end]);
        }
        cursor = end + 1;
    }
    output.push_str(&text[cursor..]);
    output
}

fn tool_params(input: &Value) -> &Value {
    input.get("params").unwrap_or(input)
}

fn read_required_string(params: &Value, key: &str) -> NativeResult<String> {
    read_string(params, key).ok_or_else(|| invalid_input(format!("Missing required field: {key}")))
}

fn read_string(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn nested_string(input: &Value, path: &[&str]) -> Option<String> {
    let mut current = input;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn read_u64(params: &Value, key: &str) -> Option<u64> {
    params
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
}

fn nested_u64(input: &Value, path: &[&str]) -> Option<u64> {
    let mut current = input;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_u64().filter(|value| *value > 0)
}

fn nested_bool(input: &Value, path: &[&str]) -> Option<bool> {
    let mut current = input;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_bool()
}

fn read_bool(params: &Value, key: &str) -> Option<bool> {
    params.get(key).and_then(Value::as_bool)
}

fn read_string_array(params: &Value, key: &str) -> Vec<String> {
    params
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn read_string_list_param(params: &Value, key: &str) -> Vec<String> {
    if let Some(value) = read_string(params, key) {
        return split_csv(&value);
    }
    read_string_array(params, key)
}

fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn normalize_searxng_safe_search(value: Option<String>) -> NativeResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let normalized = match value.trim().to_ascii_lowercase().as_str() {
        "0" | "off" | "none" | "false" => "0",
        "1" | "moderate" | "medium" => "1",
        "2" | "strict" | "on" | "true" => "2",
        other => {
            return Err(invalid_input(format!(
                "SearXNG safeSearch must be one of off, moderate, strict, 0, 1, or 2; got {other}"
            )))
        }
    };
    Ok(Some(normalized.to_string()))
}

fn normalize_searxng_time_range(value: Option<String>) -> NativeResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let normalized = match value.trim().to_ascii_lowercase().as_str() {
        "day" | "week" | "month" | "year" => value.trim().to_ascii_lowercase(),
        other => {
            return Err(invalid_input(format!(
                "SearXNG timeRange must be one of day, week, month, or year; got {other}"
            )))
        }
    };
    Ok(Some(normalized))
}

fn read_count(params: &Value) -> usize {
    params
        .get("count")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .map(|value| value.clamp(1, 10) as usize)
        .unwrap_or(DEFAULT_SEARCH_COUNT)
}

async fn http_get_text(url: &str, timeout_seconds: u64, label: &str) -> NativeResult<String> {
    let client = http_client_builder(url, timeout_seconds).build()?;
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        if label == "SearXNG" && status.as_u16() == 403 {
            return Err(runtime_error(
                "SearXNG JSON format is disabled. Enable json in the SearXNG settings.yml formats list.",
            ));
        }
        return Err(runtime_error(format!(
            "{label} search error ({}): {}",
            status.as_u16(),
            truncate_chars(&text, 2_000).0
        )));
    }
    Ok(text)
}

fn resolve_searxng_base_url(input: &Value, params: &Value) -> String {
    read_string(params, "baseUrl")
        .or_else(|| nested_string(input, &["pluginConfig", "webSearch", "baseUrl"]))
        .unwrap_or_else(|| {
            let host = nested_string(input, &["pluginConfig", "webSearch", "host"])
                .unwrap_or_else(|| SEARXNG_DEFAULT_HOST.to_string());
            let port = nested_u64(input, &["pluginConfig", "webSearch", "port"])
                .unwrap_or(SEARXNG_DEFAULT_PORT);
            format!("http://{host}:{port}")
        })
}

fn validate_searxng_base_url(base_url: &str) -> NativeResult<()> {
    let parsed = Url::parse(base_url)
        .map_err(|_| invalid_input("SearXNG base URL must be a valid http:// or https:// URL."))?;
    match parsed.scheme() {
        "https" => Ok(()),
        "http" if is_loopback_host(parsed.host_str().unwrap_or_default()) => Ok(()),
        "http" => Err(invalid_input(
            "SearXNG HTTP base URL must target a loopback host in the Rust native runtime. Use https:// for remote hosts.",
        )),
        _ => Err(invalid_input(
            "SearXNG base URL must use http:// or https://.",
        )),
    }
}

async fn ensure_searxng_daemon(
    input: &Value,
    base_url: &str,
    health_path: &str,
    startup_timeout_ms: u64,
) -> NativeResult<()> {
    let parsed = Url::parse(base_url)
        .map_err(|_| invalid_input("SearXNG base URL must be a valid http:// or https:// URL."))?;
    if parsed.scheme() != "http" || !is_loopback_host(parsed.host_str().unwrap_or_default()) {
        return Ok(());
    }
    if probe_http_ok(build_searxng_health_url(base_url, health_path)?.as_str()).await {
        return Ok(());
    }
    let host = parsed.host_str().unwrap_or(SEARXNG_DEFAULT_HOST);
    let port = parsed
        .port_or_known_default()
        .unwrap_or(SEARXNG_DEFAULT_PORT as u16);
    let python = resolve_searxng_runtime_python(input)?;
    let settings = resolve_searxng_settings(input)?;
    spawn_searxng_daemon(&python, &settings, host, port)?;
    wait_for_http_ready(
        build_searxng_health_url(base_url, health_path)?.as_str(),
        startup_timeout_ms,
        "Managed SearXNG daemon",
    )
    .await
}

fn build_searxng_health_url(base_url: &str, health_path: &str) -> NativeResult<Url> {
    let mut url = Url::parse(base_url)
        .map_err(|_| invalid_input("SearXNG base URL must be a valid http:// or https:// URL."))?;
    let normalized = if health_path.starts_with('/') {
        health_path.to_string()
    } else {
        format!("/{health_path}")
    };
    let pathname = join_url_path(url.path(), &normalized);
    url.set_path(&pathname);
    url.set_query(None);
    Ok(url)
}

fn join_url_path(base_path: &str, child_path: &str) -> String {
    let base = base_path.trim_end_matches('/');
    let child = child_path.trim_start_matches('/');
    if base.is_empty() {
        format!("/{child}")
    } else if child.is_empty() {
        base.to_string()
    } else {
        format!("{base}/{child}")
    }
}

fn resolve_searxng_runtime_python(input: &Value) -> NativeResult<PathBuf> {
    let workspace_dir = workspace_dir(input);
    let state_dir = state_dir();
    for candidate in searxng_runtime_python_candidates(workspace_dir.as_deref(), Some(&state_dir)) {
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(runtime_error(
        "SearXNG runtime is not installed. Expected a prebuilt runtimes/searxng/venv Python runtime. Configure an explicit SearXNG baseUrl or disable autoStart.",
    ))
}

fn searxng_python_for_runtime_root(root: &Path) -> PathBuf {
    let venv = root.join("searxng").join("venv");
    if cfg!(windows) {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

fn split_path_list(value: &str) -> Vec<PathBuf> {
    value
        .split(path_list_separator())
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn path_list_separator() -> char {
    if cfg!(windows) {
        ';'
    } else {
        ':'
    }
}

fn resolve_searxng_settings(input: &Value) -> NativeResult<PathBuf> {
    if let Some(path) = nested_string(input, &["pluginConfig", "webSearch", "settingsPath"]) {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }
    let workspace_dir = workspace_dir(input);
    let state_dir = state_dir();
    for candidate in searxng_settings_candidates(workspace_dir.as_deref(), Some(&state_dir)) {
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(runtime_error(
        "SearXNG settings.yml is not installed. The managed sidecar requires a settings.yml with json enabled in formats.",
    ))
}

fn spawn_searxng_daemon(python: &Path, settings: &Path, host: &str, port: u16) -> NativeResult<()> {
    let log = daemon_log_file("searxng-daemon.log")?;
    let stderr = log.try_clone()?;
    Command::new(python)
        .arg("-m")
        .arg("searx.webapp")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .env("NO_COLOR", "1")
        .env("SEARXNG_SETTINGS_PATH", settings)
        .env("SEARXNG_BIND_ADDRESS", host)
        .env("SEARXNG_PORT", port.to_string())
        .env("SEARXNG_SECRET", searxng_secret())
        .spawn()
        .map_err(|error| {
            runtime_error(format!(
                "Failed to start SearXNG daemon at {}: {error}",
                python.display()
            ))
        })?;
    Ok(())
}

fn searxng_secret() -> String {
    env::var("CRAWCLAW_SEARXNG_SECRET")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("crawclaw-searxng-{}", boundary_id()))
}

fn is_loopback_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

fn searxng_payload(query: &str, results: Vec<SearxngSearchResult>, started: Instant) -> Value {
    json!({
        "query": query,
        "provider": "searxng",
        "count": results.len(),
        "tookMs": started.elapsed().as_millis() as u64,
        "externalContent": {
            "untrusted": true,
            "source": "web_search",
            "provider": "searxng",
            "wrapped": true
        },
        "results": results.into_iter().map(|result| {
            json!({
                "title": wrap_web_content(&result.title, "web_search"),
                "url": result.url,
                "snippet": if result.snippet.is_empty() {
                    String::new()
                } else {
                    wrap_web_content(&result.snippet, "web_search")
                },
                "siteName": resolve_site_name(&result.url),
                "engine": result.engine,
                "source": result.source,
                "category": result.category,
                "publishedAt": result.published_at
            })
        }).collect::<Vec<_>>()
    })
}

fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let tag_end = html[start..].find('>')? + start;
    let close = find_ci(&html[tag_end + 1..], "</title>")? + tag_end + 1;
    let title = decode_html_entities(&strip_html(&html[tag_end + 1..close]));
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

pub(crate) fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut output = String::new();
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            return (output, true);
        }
        output.push(ch);
    }
    (output, false)
}

fn resolve_site_name(url: &str) -> Option<String> {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(ToString::to_string))
        .map(|host| host.trim_start_matches("www.").to_string())
        .filter(|host| !host.is_empty())
}

pub(crate) fn wrap_web_content(content: &str, source: &str) -> String {
    wrap_external_content(content, source, source == "web_fetch")
}

pub(crate) fn wrap_external_content(content: &str, source: &str, include_warning: bool) -> String {
    let id = boundary_id();
    let source_label = match source {
        "web_fetch" => "Web Fetch",
        "web_search" => "Web Search",
        _ => "External",
    };
    let warning = if include_warning {
        "SECURITY NOTICE: The following content is from an EXTERNAL, UNTRUSTED source.\n\n"
    } else {
        ""
    };
    format!(
        "{warning}<<<EXTERNAL_UNTRUSTED_CONTENT id=\"{id}\">>>\nSource: {source_label}\n---\n{}\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id=\"{id}\">>>",
        sanitize_markers(content)
    )
}

fn sanitize_markers(value: &str) -> String {
    value
        .replace(
            "<<<EXTERNAL_UNTRUSTED_CONTENT",
            "[EXTERNAL_UNTRUSTED_CONTENT",
        )
        .replace(
            "<<<END_EXTERNAL_UNTRUSTED_CONTENT",
            "[END_EXTERNAL_UNTRUSTED_CONTENT",
        )
}

fn boundary_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos:x}")
}

pub(crate) fn now_iso_like() -> String {
    Utc::now().to_rfc3339()
}

async fn probe_http_ok(url: &str) -> bool {
    match http_client_builder(url, 2).build() {
        Ok(client) => client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

fn http_client_builder(url: &str, timeout_seconds: u64) -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(DESKTOP_USER_AGENT);
    if is_loopback_url(url) {
        builder.no_proxy()
    } else {
        builder
    }
}

fn is_loopback_url(url: &str) -> bool {
    Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(ToOwned::to_owned))
        .is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<IpAddr>()
                    .map(|address| address.is_loopback())
                    .unwrap_or(false)
        })
}

async fn wait_for_http_ready(url: &str, timeout_ms: u64, label: &str) -> NativeResult<()> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while Instant::now() <= deadline {
        if probe_http_ok(url).await {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(runtime_error(format!(
        "{label} did not become ready at {url} within {timeout_ms}ms."
    )))
}

fn workspace_dir(input: &Value) -> Option<PathBuf> {
    nested_string(input, &["workspaceDir"]).map(PathBuf::from)
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

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn daemon_log_file(name: &str) -> NativeResult<std::fs::File> {
    let log_dir = state_dir().join("logs");
    fs::create_dir_all(&log_dir)?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join(name))
        .map_err(NativeError::from)
}

pub(crate) fn value_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn value_string_from_value(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

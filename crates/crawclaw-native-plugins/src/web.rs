use std::env;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::Utc;
use reqwest::Url;
use serde_json::{json, Value};

use crate::error::{invalid_input, runtime_error, NativeError, NativeResult};

const DEFAULT_SEARCH_COUNT: usize = 5;
const DEFAULT_TIMEOUT_SECONDS: u64 = 20;
const DESKTOP_USER_AGENT: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const OPEN_WEBSEARCH_DEFAULT_HOST: &str = "127.0.0.1";
const OPEN_WEBSEARCH_DEFAULT_PORT: u64 = 3210;
const OPEN_WEBSEARCH_DEFAULT_STARTUP_TIMEOUT_MS: u64 = 20_000;
const SCRAPLING_DEFAULT_BASE_URL: &str = "http://127.0.0.1:32119";
const SCRAPLING_DEFAULT_HEALTHCHECK_PATH: &str = "/health";
const SCRAPLING_DEFAULT_FETCH_PATH: &str = "/fetch";
const SCRAPLING_DEFAULT_STARTUP_TIMEOUT_MS: u64 = 15_000;
const SCRAPLING_SIDECAR_SCRIPT: &str =
    include_str!("../../../extensions/scrapling-fetch/python/scrapling_sidecar.py");
const SCRAPLING_REQUIREMENTS: &str =
    include_str!("../../../extensions/scrapling-fetch/runtime/requirements.lock.txt");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenWebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub engine: Option<String>,
    pub source: Option<String>,
}

pub async fn run_open_websearch_search(input: Value) -> NativeResult<Value> {
    let params = tool_params(&input);
    let query = read_required_string(params, "query")?;
    let count = read_count(params);
    let base_url = read_string(params, "baseUrl")
        .or_else(|| nested_string(&input, &["pluginConfig", "webSearch", "baseUrl"]))
        .unwrap_or_else(|| {
            let host = nested_string(&input, &["pluginConfig", "webSearch", "host"])
                .unwrap_or_else(|| OPEN_WEBSEARCH_DEFAULT_HOST.to_string());
            let port = nested_u64(&input, &["pluginConfig", "webSearch", "port"])
                .unwrap_or(OPEN_WEBSEARCH_DEFAULT_PORT);
            format!("http://{host}:{port}")
        });
    validate_open_websearch_base_url(&base_url)?;
    let auto_start = read_bool(params, "autoStart")
        .or_else(|| nested_bool(&input, &["pluginConfig", "webSearch", "autoStart"]))
        .unwrap_or(true);
    let startup_timeout_ms = read_u64(params, "startupTimeoutMs")
        .or_else(|| nested_u64(&input, &["pluginConfig", "webSearch", "startupTimeoutMs"]))
        .unwrap_or(OPEN_WEBSEARCH_DEFAULT_STARTUP_TIMEOUT_MS);
    if auto_start {
        ensure_open_websearch_daemon(&input, &base_url, startup_timeout_ms).await?;
    }
    let engines = read_string_array(params, "engines");
    let timeout_seconds = read_u64(params, "timeoutSeconds").unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    let url = build_open_websearch_search_url(&base_url)?;
    let started = Instant::now();
    let mut body = serde_json::Map::new();
    body.insert("query".to_string(), Value::String(query.clone()));
    body.insert("limit".to_string(), json!(count));
    if !engines.is_empty() {
        body.insert(
            "engines".to_string(),
            Value::Array(engines.into_iter().map(Value::String).collect()),
        );
    }
    let text = http_post_json_text(url.as_str(), Value::Object(body), timeout_seconds).await?;
    let results = parse_open_websearch_response_text(&text, count)?;
    Ok(open_websearch_payload(&query, results, started))
}

pub async fn start_open_websearch_service(input: Value) -> NativeResult<Value> {
    let params = tool_params(&input);
    let base_url = read_string(params, "baseUrl")
        .or_else(|| nested_string(&input, &["pluginConfig", "webSearch", "baseUrl"]))
        .unwrap_or_else(|| {
            let host = nested_string(&input, &["pluginConfig", "webSearch", "host"])
                .unwrap_or_else(|| OPEN_WEBSEARCH_DEFAULT_HOST.to_string());
            let port = nested_u64(&input, &["pluginConfig", "webSearch", "port"])
                .unwrap_or(OPEN_WEBSEARCH_DEFAULT_PORT);
            format!("http://{host}:{port}")
        });
    validate_open_websearch_base_url(&base_url)?;
    let startup_timeout_ms = read_u64(params, "startupTimeoutMs")
        .or_else(|| nested_u64(&input, &["pluginConfig", "webSearch", "startupTimeoutMs"]))
        .unwrap_or(OPEN_WEBSEARCH_DEFAULT_STARTUP_TIMEOUT_MS);
    ensure_open_websearch_daemon(&input, &base_url, startup_timeout_ms).await?;
    Ok(json!({
        "status": "running",
        "provider": "open-websearch",
        "baseUrl": base_url
    }))
}

pub fn stop_open_websearch_service() -> Value {
    json!({
        "status": "not-supported",
        "provider": "open-websearch",
        "message": "Open-WebSearch is launched as a detached native sidecar in this runtime."
    })
}

pub async fn run_scrapling_fetch(input: Value) -> NativeResult<Value> {
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
        return run_scrapling_sidecar_fetch(&input, params, &url, &output, &render, started).await;
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(DESKTOP_USER_AGENT)
        .build()?;
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
    let warning = match render.as_str() {
        "dynamic" | "stealth" => Some(
            "Rust native scrapling-fetch returned static HTTP content; browser rendering remains unavailable in this path.",
        ),
        _ => None,
    };

    Ok(json!({
        "status": "ok",
        "provider": "scrapling",
        "fetcher": "scrapling-rust-static",
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
            "provider": "scrapling",
            "wrapped": true
        },
        "rendered": false,
        "usedFallback": render == "dynamic" || render == "stealth",
        "blockedDetected": false,
        "truncated": truncated,
        "length": content.chars().count(),
        "rawLength": selected.chars().count(),
        "wrappedLength": wrapped_content.chars().count(),
        "fetchedAt": now_iso_like(),
        "tookMs": started.elapsed().as_millis() as u64,
        "warning": warning,
        "request": {
            "url": url,
            "output": output,
            "render": render,
            "timeoutSeconds": timeout_seconds,
            "maxChars": max_chars
        }
    }))
}

pub async fn start_scrapling_fetch_service(input: Value) -> NativeResult<Value> {
    let base_url = nested_string(&input, &["pluginConfig", "webFetch", "baseUrl"])
        .or_else(|| nested_string(&input, &["pluginConfig", "service", "baseUrl"]))
        .unwrap_or_else(|| SCRAPLING_DEFAULT_BASE_URL.to_string());
    let fetch_path = nested_string(&input, &["pluginConfig", "service", "fetchPath"])
        .unwrap_or_else(|| SCRAPLING_DEFAULT_FETCH_PATH.to_string());
    let healthcheck_path = nested_string(&input, &["pluginConfig", "service", "healthcheckPath"])
        .unwrap_or_else(|| SCRAPLING_DEFAULT_HEALTHCHECK_PATH.to_string());
    let bootstrap = nested_bool(&input, &["pluginConfig", "service", "bootstrap"]).unwrap_or(true);
    let startup_timeout_ms = nested_u64(&input, &["pluginConfig", "service", "startupTimeoutMs"])
        .unwrap_or(SCRAPLING_DEFAULT_STARTUP_TIMEOUT_MS);
    ensure_scrapling_sidecar(
        &input,
        &base_url,
        &healthcheck_path,
        &fetch_path,
        startup_timeout_ms,
        bootstrap,
    )
    .await?;
    Ok(json!({
        "status": "running",
        "provider": "scrapling",
        "baseUrl": base_url,
        "fetchPath": fetch_path,
        "healthcheckPath": healthcheck_path
    }))
}

pub fn stop_scrapling_fetch_service() -> Value {
    json!({
        "status": "not-supported",
        "provider": "scrapling",
        "message": "Scrapling fetch is launched as a detached native sidecar in this runtime."
    })
}

async fn run_scrapling_sidecar_fetch(
    input: &Value,
    params: &Value,
    url: &str,
    output: &str,
    render: &str,
    started: Instant,
) -> NativeResult<Value> {
    let base_url = read_string(params, "baseUrl")
        .or_else(|| nested_string(input, &["pluginConfig", "webFetch", "baseUrl"]))
        .or_else(|| nested_string(input, &["pluginConfig", "service", "baseUrl"]))
        .unwrap_or_else(|| SCRAPLING_DEFAULT_BASE_URL.to_string());
    let fetch_path = nested_string(input, &["pluginConfig", "service", "fetchPath"])
        .unwrap_or_else(|| SCRAPLING_DEFAULT_FETCH_PATH.to_string());
    let healthcheck_path = nested_string(input, &["pluginConfig", "service", "healthcheckPath"])
        .unwrap_or_else(|| SCRAPLING_DEFAULT_HEALTHCHECK_PATH.to_string());
    let service_enabled =
        nested_bool(input, &["pluginConfig", "service", "enabled"]).unwrap_or(true);
    let bootstrap = nested_bool(input, &["pluginConfig", "service", "bootstrap"]).unwrap_or(true);
    let startup_timeout_ms = nested_u64(input, &["pluginConfig", "service", "startupTimeoutMs"])
        .unwrap_or(SCRAPLING_DEFAULT_STARTUP_TIMEOUT_MS);
    if service_enabled {
        ensure_scrapling_sidecar(
            input,
            &base_url,
            &healthcheck_path,
            &fetch_path,
            startup_timeout_ms,
            bootstrap,
        )
        .await?;
    }
    let request = scrapling_sidecar_request(params, url, output, render);
    let endpoint = build_path_endpoint(&base_url, &fetch_path)?;
    let timeout_seconds = read_u64(params, "timeoutSeconds").unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(DESKTOP_USER_AGENT)
        .build()?;
    let response = client
        .post(endpoint)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&request)
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    let payload: Value = serde_json::from_str(&text).map_err(|_| {
        runtime_error(format!(
            "Scrapling sidecar returned invalid JSON: {}",
            truncate_chars(&text, 2_000).0
        ))
    })?;
    if !status.is_success() || payload.get("status").and_then(Value::as_str) == Some("error") {
        return Err(runtime_error(format!(
            "Scrapling sidecar error ({}): {}",
            status.as_u16(),
            payload
        )));
    }
    normalize_scrapling_sidecar_payload(payload, request, started)
}

fn scrapling_sidecar_request(params: &Value, url: &str, output: &str, render: &str) -> Value {
    let mut request = serde_json::Map::new();
    request.insert("url".to_string(), Value::String(url.to_string()));
    request.insert("output".to_string(), Value::String(output.to_string()));
    request.insert(
        "detail".to_string(),
        Value::String(read_string(params, "detail").unwrap_or_else(|| "brief".to_string())),
    );
    request.insert("render".to_string(), Value::String(render.to_string()));
    request.insert(
        "extractMode".to_string(),
        Value::String(read_string(params, "extractMode").unwrap_or_else(|| "markdown".to_string())),
    );
    request.insert(
        "extract".to_string(),
        Value::String(read_string(params, "extract").unwrap_or_else(|| "readable".to_string())),
    );
    request.insert(
        "mainContentOnly".to_string(),
        Value::Bool(read_bool(params, "mainContentOnly").unwrap_or(true)),
    );
    if let Some(max_chars) = read_u64(params, "maxChars") {
        request.insert("maxChars".to_string(), json!(max_chars));
    }
    if let Some(timeout_seconds) = read_u64(params, "timeoutSeconds") {
        request.insert("timeoutSeconds".to_string(), json!(timeout_seconds));
    }
    if let Some(wait_until) = read_string(params, "waitUntil") {
        request.insert("waitUntil".to_string(), Value::String(wait_until));
    }
    if let Some(wait_for) = read_string(params, "waitFor") {
        request.insert("waitFor".to_string(), Value::String(wait_for));
    }
    if let Some(session_id) = read_string(params, "sessionId") {
        request.insert("sessionId".to_string(), Value::String(session_id));
    }
    Value::Object(request)
}

fn normalize_scrapling_sidecar_payload(
    payload: Value,
    request: Value,
    started: Instant,
) -> NativeResult<Value> {
    let object = payload
        .as_object()
        .ok_or_else(|| runtime_error("Scrapling sidecar returned a non-object payload."))?;
    let text = value_string(object.get("text"))
        .or_else(|| value_string(object.get("content")))
        .unwrap_or_default();
    let html = value_string(object.get("html"));
    let summary = value_string(object.get("summary"));
    let content_preview = value_string(object.get("contentPreview"))
        .or_else(|| summary.clone())
        .unwrap_or_else(|| truncate_chars(&text, 2_000).0);
    let content = value_string(object.get("content")).unwrap_or_else(|| text.clone());
    let wrapped_text = wrap_external_content(&text, "web_fetch", true);
    let wrapped_content = if content.is_empty() {
        wrapped_text.clone()
    } else {
        wrap_web_content(&content, "web_fetch")
    };
    let wrapped_preview = wrap_web_content(&content_preview, "web_fetch");
    let wrapped_html = html.map(|value| wrap_web_content(&value, "web_fetch"));
    Ok(json!({
        "status": "ok",
        "provider": "scrapling",
        "fetcher": value_string(object.get("fetcher")).unwrap_or_else(|| "scrapling-sidecar".to_string()),
        "url": value_string(object.get("url")).or_else(|| value_string(request.get("url"))).unwrap_or_default(),
        "finalUrl": value_string(object.get("finalUrl")).or_else(|| value_string(object.get("url"))).or_else(|| value_string(request.get("url"))).unwrap_or_default(),
        "statusCode": object.get("statusCode").and_then(Value::as_u64).unwrap_or(200),
        "contentType": value_string(object.get("contentType")).unwrap_or_else(|| if wrapped_html.is_some() { "text/html".to_string() } else { "text/plain".to_string() }),
        "title": value_string(object.get("title")),
        "summary": summary.map(|value| wrap_web_content(&value, "web_fetch")),
        "keyPoints": object.get("keyPoints").cloned().unwrap_or(Value::Null),
        "headings": object.get("headings").cloned().unwrap_or(Value::Null),
        "contentPreview": wrapped_preview,
        "html": wrapped_html,
        "content": wrapped_content,
        "text": wrapped_text,
        "metadata": object.get("metadata").cloned().unwrap_or(Value::Null),
        "externalContent": {
            "untrusted": true,
            "source": "web_fetch",
            "provider": "scrapling",
            "wrapped": true
        },
        "rendered": object.get("rendered").and_then(Value::as_bool).unwrap_or(false),
        "usedFallback": object.get("usedFallback").and_then(Value::as_bool).unwrap_or(false),
        "blockedDetected": object.get("blockedDetected").and_then(Value::as_bool).unwrap_or(false),
        "truncated": object.get("truncated").and_then(Value::as_bool).unwrap_or(false),
        "length": object.get("length").and_then(Value::as_u64).unwrap_or(text.chars().count() as u64),
        "rawLength": object.get("rawLength").and_then(Value::as_u64).unwrap_or(text.chars().count() as u64),
        "wrappedLength": object.get("wrappedLength").and_then(Value::as_u64).unwrap_or(wrapped_content.chars().count() as u64),
        "fetchedAt": value_string(object.get("fetchedAt")).unwrap_or_else(now_iso_like),
        "tookMs": object.get("tookMs").and_then(Value::as_u64).unwrap_or(started.elapsed().as_millis() as u64),
        "warning": value_string(object.get("warning")),
        "request": request
    }))
}

pub fn build_open_websearch_search_url(base_url: &str) -> NativeResult<Url> {
    let mut url = Url::parse(base_url).map_err(|_| {
        invalid_input("Open-WebSearch base URL must be a valid http:// or https:// URL.")
    })?;
    let pathname = if url.path().ends_with('/') {
        format!("{}search", url.path())
    } else {
        format!("{}/search", url.path())
    };
    url.set_path(&pathname);
    url.set_query(None);
    Ok(url)
}

pub fn parse_open_websearch_response_text(
    text: &str,
    count: usize,
) -> NativeResult<Vec<OpenWebSearchResult>> {
    let parsed: Value = serde_json::from_str(text)
        .map_err(|_| invalid_input("Open-WebSearch returned invalid JSON."))?;
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
            let engine = raw
                .get("engine")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            let source = raw
                .get("source")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
            results.push(OpenWebSearchResult {
                title: title.to_string(),
                url: url.to_string(),
                snippet,
                engine,
                source,
            });
            if results.len() >= count {
                break;
            }
        }
    }
    Ok(results)
}

pub fn open_websearch_runtime_bin_candidates(
    workspace_dir: Option<&Path>,
    state_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let bin = managed_bin_name("open-websearch");
    let mut candidates = Vec::new();
    if let Some(workspace_dir) = workspace_dir {
        candidates.push(
            workspace_dir
                .join("runtimes")
                .join("open-websearch")
                .join("node_modules")
                .join(".bin")
                .join(&bin),
        );
    }
    if let Ok(root) = env::var("CRAWCLAW_PLUGIN_RUNTIMES_DIR") {
        let root = root.trim();
        if !root.is_empty() {
            candidates.push(
                PathBuf::from(root)
                    .join("open-websearch")
                    .join("node_modules")
                    .join(".bin")
                    .join(&bin),
            );
        }
    }
    if let Some(state_dir) = state_dir {
        candidates.push(
            state_dir
                .join("runtimes")
                .join("open-websearch")
                .join("node_modules")
                .join(".bin")
                .join(bin),
        );
    }
    candidates
}

pub fn install_scrapling_runtime_from_env() -> NativeResult<Value> {
    let python = install_scrapling_runtime(&state_dir())?;
    Ok(json!({
        "state": "healthy",
        "runtime": "python-http",
        "python": python.to_string_lossy(),
        "venvDir": python.parent().and_then(Path::parent).map(|path| path.to_string_lossy().to_string()),
        "installedAt": now_iso_like(),
        "packages": scrapling_requirements()
    }))
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

fn read_count(params: &Value) -> usize {
    params
        .get("count")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .map(|value| value.clamp(1, 10) as usize)
        .unwrap_or(DEFAULT_SEARCH_COUNT)
}

async fn http_post_json_text(url: &str, body: Value, timeout_seconds: u64) -> NativeResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .user_agent(DESKTOP_USER_AGENT)
        .build()?;
    let response = client
        .post(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(runtime_error(format!(
            "Open-WebSearch search error ({}): {}",
            status.as_u16(),
            truncate_chars(&text, 2_000).0
        )));
    }
    Ok(text)
}

fn validate_open_websearch_base_url(base_url: &str) -> NativeResult<()> {
    let parsed = Url::parse(base_url).map_err(|_| {
        invalid_input("Open-WebSearch base URL must be a valid http:// or https:// URL.")
    })?;
    match parsed.scheme() {
        "https" => Ok(()),
        "http" if is_loopback_host(parsed.host_str().unwrap_or_default()) => Ok(()),
        "http" => Err(invalid_input(
            "Open-WebSearch HTTP base URL must target a loopback host in the Rust native runtime. Use https:// for remote hosts.",
        )),
        _ => Err(invalid_input(
            "Open-WebSearch base URL must use http:// or https://.",
        )),
    }
}

async fn ensure_open_websearch_daemon(
    input: &Value,
    base_url: &str,
    startup_timeout_ms: u64,
) -> NativeResult<()> {
    let parsed = Url::parse(base_url).map_err(|_| {
        invalid_input("Open-WebSearch base URL must be a valid http:// or https:// URL.")
    })?;
    if parsed.scheme() != "http" || !is_loopback_host(parsed.host_str().unwrap_or_default()) {
        return Ok(());
    }
    if probe_http_ok(build_open_websearch_status_url(base_url)?.as_str()).await {
        return Ok(());
    }
    let host = parsed.host_str().unwrap_or(OPEN_WEBSEARCH_DEFAULT_HOST);
    let port = parsed
        .port_or_known_default()
        .unwrap_or(OPEN_WEBSEARCH_DEFAULT_PORT as u16);
    let bin = resolve_open_websearch_runtime_bin(input)?;
    spawn_open_websearch_daemon(&bin, host, port)?;
    wait_for_http_ready(
        build_open_websearch_status_url(base_url)?.as_str(),
        startup_timeout_ms,
        "Managed Open-WebSearch daemon",
    )
    .await
}

fn build_open_websearch_status_url(base_url: &str) -> NativeResult<Url> {
    let mut url = Url::parse(base_url).map_err(|_| {
        invalid_input("Open-WebSearch base URL must be a valid http:// or https:// URL.")
    })?;
    let pathname = if url.path().ends_with('/') {
        format!("{}status", url.path())
    } else {
        format!("{}/status", url.path())
    };
    url.set_path(&pathname);
    url.set_query(None);
    Ok(url)
}

fn resolve_open_websearch_runtime_bin(input: &Value) -> NativeResult<PathBuf> {
    let workspace_dir = workspace_dir(input);
    let state_dir = state_dir();
    for candidate in
        open_websearch_runtime_bin_candidates(workspace_dir.as_deref(), Some(&state_dir))
    {
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(runtime_error(
        "Open-WebSearch runtime is not installed. Configure an explicit native Open-WebSearch runtime or disable autoStart.",
    ))
}

fn spawn_open_websearch_daemon(bin: &Path, host: &str, port: u16) -> NativeResult<()> {
    let log = daemon_log_file("open-websearch-daemon.log")?;
    let stderr = log.try_clone()?;
    Command::new(bin)
        .arg("serve")
        .arg("--host")
        .arg(host)
        .arg("--port")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .env("NO_COLOR", "1")
        .spawn()
        .map_err(|error| {
            runtime_error(format!(
                "Failed to start Open-WebSearch daemon at {}: {error}",
                bin.display()
            ))
        })?;
    Ok(())
}

async fn ensure_scrapling_sidecar(
    input: &Value,
    base_url: &str,
    healthcheck_path: &str,
    fetch_path: &str,
    startup_timeout_ms: u64,
    bootstrap: bool,
) -> NativeResult<()> {
    let parsed = Url::parse(base_url).map_err(|_| {
        invalid_input("Scrapling base URL must be a valid http:// or https:// URL.")
    })?;
    if parsed.scheme() != "http" || !is_loopback_host(parsed.host_str().unwrap_or_default()) {
        return Ok(());
    }
    let health_url = build_path_endpoint(base_url, healthcheck_path)?;
    if probe_http_ok(health_url.as_str()).await {
        return Ok(());
    }
    let host = parsed.host_str().unwrap_or("127.0.0.1");
    let port = parsed.port_or_known_default().unwrap_or(32119);
    let python = resolve_scrapling_python(input, bootstrap)?;
    let script = materialize_scrapling_sidecar_script()?;
    spawn_scrapling_sidecar_process(&python, &script, host, port, healthcheck_path, fetch_path)?;
    wait_for_http_ready(
        health_url.as_str(),
        startup_timeout_ms,
        "Managed Scrapling fetch sidecar",
    )
    .await
}

fn resolve_scrapling_python(input: &Value, bootstrap: bool) -> NativeResult<PathBuf> {
    if let Some(command) = nested_string(input, &["pluginConfig", "service", "command"]) {
        return Ok(PathBuf::from(command));
    }
    let state_dir = state_dir();
    let python = managed_python_path(&state_dir, "scrapling-fetch");
    if python.exists() && verify_scrapling_runtime(&python) {
        return Ok(python);
    }
    if bootstrap {
        return install_scrapling_runtime(&state_dir);
    }
    Err(runtime_error(
        "Scrapling fetch runtime is not installed. Configure the native Scrapling sidecar runtime or enable service.bootstrap.",
    ))
}

fn install_scrapling_runtime(state_dir: &Path) -> NativeResult<PathBuf> {
    let runtime_dir = state_dir.join("runtimes").join("scrapling-fetch");
    let venv_dir = runtime_dir.join("venv");
    fs::create_dir_all(&runtime_dir)?;
    let python = resolve_python_command()?;
    if !managed_python_path_from_venv(&venv_dir).exists() {
        run_command(&python, &["-m", "venv", &path_arg(&venv_dir)])?;
    }
    let venv_python = managed_python_path_from_venv(&venv_dir);
    run_command(
        &venv_python,
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "pip",
            "setuptools",
            "wheel",
        ],
    )?;
    let packages = scrapling_requirements();
    let mut args = vec![
        "-m".to_string(),
        "pip".to_string(),
        "install".to_string(),
        "--disable-pip-version-check".to_string(),
    ];
    args.extend(packages);
    run_command_owned(&venv_python, &args)?;
    if !verify_scrapling_runtime(&venv_python) {
        return Err(runtime_error(format!(
            "Scrapling runtime verification failed at {}",
            venv_python.display()
        )));
    }
    Ok(venv_python)
}

fn spawn_scrapling_sidecar_process(
    python: &Path,
    script: &Path,
    host: &str,
    port: u16,
    healthcheck_path: &str,
    fetch_path: &str,
) -> NativeResult<()> {
    let log = daemon_log_file("scrapling-fetch-sidecar.log")?;
    let stderr = log.try_clone()?;
    Command::new(python)
        .arg(script)
        .arg("--host")
        .arg(host)
        .arg("--port")
        .arg(port.to_string())
        .arg("--healthcheck-path")
        .arg(healthcheck_path)
        .arg("--fetch-path")
        .arg(fetch_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .env("NO_COLOR", "1")
        .spawn()
        .map_err(|error| {
            runtime_error(format!(
                "Failed to start Scrapling sidecar with {}: {error}",
                python.display()
            ))
        })?;
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

fn open_websearch_payload(
    query: &str,
    results: Vec<OpenWebSearchResult>,
    started: Instant,
) -> Value {
    json!({
        "query": query,
        "provider": "open-websearch",
        "count": results.len(),
        "tookMs": started.elapsed().as_millis() as u64,
        "externalContent": {
            "untrusted": true,
            "source": "web_search",
            "provider": "open-websearch",
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
                "source": result.source
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

fn extract_html_title(html: &str) -> Option<String> {
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

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
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

fn wrap_web_content(content: &str, source: &str) -> String {
    wrap_external_content(content, source, source == "web_fetch")
}

fn wrap_external_content(content: &str, source: &str, include_warning: bool) -> String {
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

fn now_iso_like() -> String {
    Utc::now().to_rfc3339()
}

async fn probe_http_ok(url: &str) -> bool {
    match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .user_agent(DESKTOP_USER_AGENT)
        .build()
    {
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

fn build_path_endpoint(base_url: &str, path: &str) -> NativeResult<Url> {
    let mut url = Url::parse(base_url)
        .map_err(|_| invalid_input("Base URL must be a valid http:// or https:// URL."))?;
    url.set_path(if path.starts_with('/') {
        path
    } else {
        return Err(invalid_input("Endpoint path must start with '/'."));
    });
    url.set_query(None);
    Ok(url)
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

fn managed_bin_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.cmd")
    } else {
        name.to_string()
    }
}

fn managed_python_path(state_dir: &Path, runtime_id: &str) -> PathBuf {
    managed_python_path_from_venv(&state_dir.join("runtimes").join(runtime_id).join("venv"))
}

fn managed_python_path_from_venv(venv_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_dir.join("Scripts").join("python.exe")
    } else {
        venv_dir.join("bin").join("python")
    }
}

fn verify_scrapling_runtime(python: &Path) -> bool {
    Command::new(python)
        .arg("-c")
        .arg(scrapling_verify_script())
        .env("NO_COLOR", "1")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn scrapling_verify_script() -> &'static str {
    "from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher\nimport curl_cffi\nimport playwright\nimport browserforge\nimport msgspec\nprint('ok')"
}

fn resolve_python_command() -> NativeResult<PathBuf> {
    let mut candidates = Vec::new();
    for key in ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_SCRAPLING_PYTHON"] {
        if let Ok(value) = env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed));
            }
        }
    }
    candidates.extend(
        [
            "python3.14",
            "python3.13",
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
        ]
        .into_iter()
        .map(PathBuf::from),
    );
    for candidate in candidates {
        if python_version_supported(&candidate) {
            return Ok(candidate);
        }
    }
    Err(runtime_error(
        "No supported Python interpreter found for scrapling-fetch; requires Python >= 3.10.",
    ))
}

fn python_version_supported(command: &Path) -> bool {
    let output = Command::new(command)
        .arg("-c")
        .arg("import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')")
        .output();
    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let version = String::from_utf8_lossy(&output.stdout);
    let mut parts = version.trim().split('.');
    let major = parts.next().and_then(|value| value.parse::<u64>().ok());
    let minor = parts.next().and_then(|value| value.parse::<u64>().ok());
    matches!((major, minor), (Some(major), Some(minor)) if major > 3 || (major == 3 && minor >= 10))
}

fn materialize_scrapling_sidecar_script() -> NativeResult<PathBuf> {
    let script_path = state_dir()
        .join("runtimes")
        .join("scrapling-fetch")
        .join("scrapling_sidecar.py");
    if let Some(parent) = script_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&script_path, SCRAPLING_SIDECAR_SCRIPT)?;
    Ok(script_path)
}

fn scrapling_requirements() -> Vec<String> {
    SCRAPLING_REQUIREMENTS
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(ToString::to_string)
        .collect()
}

fn run_command(command: &Path, args: &[&str]) -> NativeResult<()> {
    let args = args
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    run_command_owned(command, &args)
}

fn run_command_owned(command: &Path, args: &[String]) -> NativeResult<()> {
    let status = Command::new(command)
        .args(args)
        .env("NO_COLOR", "1")
        .status()
        .map_err(|error| {
            runtime_error(format!("Failed to start {}: {error}", command.display()))
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(runtime_error(format!(
            "Command {} failed with status {status}.",
            command.display()
        )))
    }
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn value_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

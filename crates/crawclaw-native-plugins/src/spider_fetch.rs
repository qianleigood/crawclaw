use std::time::{Duration, Instant};

use serde_json::{json, Value};
use spider::configuration::{WaitForDelay, WaitForIdleNetwork, WaitForSelector};
use spider::website::Website;

use crate::error::{invalid_input, runtime_error, NativeResult};
use crate::web::{
    extract_html_title, now_iso_like, strip_html, truncate_chars, value_string,
    wrap_external_content, wrap_web_content, DESKTOP_USER_AGENT,
};

#[derive(Debug, Clone)]
pub struct SpiderFetchRequest {
    pub url: String,
    pub output: String,
    pub render: String,
    pub timeout_seconds: u64,
    pub max_chars: usize,
    pub wait_for: Option<String>,
    pub wait_until: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SpiderFetchSnapshot {
    pub url: String,
    pub final_url: String,
    pub status_code: u16,
    pub content_type: String,
    pub html: String,
    pub text: String,
    pub title: Option<String>,
}

pub async fn run_spider_dynamic_fetch(
    params: &Value,
    url: &str,
    output: &str,
    render: &str,
    started: Instant,
) -> NativeResult<Value> {
    let timeout_seconds = read_u64(params, "timeoutSeconds").unwrap_or(20);
    let request = SpiderFetchRequest {
        url: url.to_string(),
        output: output.to_string(),
        render: render.to_string(),
        timeout_seconds,
        max_chars: read_u64(params, "maxChars").unwrap_or(20_000) as usize,
        wait_for: read_string(params, "waitFor"),
        wait_until: read_string(params, "waitUntil"),
    };
    let snapshot = fetch_with_spider(&request).await?;
    Ok(shape_spider_dynamic_fetch_payload(
        snapshot, request, started,
    ))
}

async fn fetch_with_spider(request: &SpiderFetchRequest) -> NativeResult<SpiderFetchSnapshot> {
    let mut website = Website::new(&request.url);
    website
        .with_limit(1)
        .with_request_timeout(Some(Duration::from_secs(request.timeout_seconds)))
        .with_default_http_connect_timeout(Some(Duration::from_secs(request.timeout_seconds)))
        .with_user_agent(Some(DESKTOP_USER_AGENT))
        .with_stealth(request.render == "stealth");
    apply_wait_options(&mut website, request);
    let mut website = website
        .build()
        .map_err(|_| invalid_input("Spider fetch URL must be a valid http:// or https:// URL."))?;
    website.configure_setup().await;
    let mut receiver = website.subscribe(8);
    website.crawl_chrome_send(Some(&request.url)).await;
    let page = tokio::time::timeout(
        Duration::from_secs(request.timeout_seconds),
        receiver.recv(),
    )
    .await
    .map_err(|_| runtime_error("Spider dynamic fetch timed out waiting for browser output."))?
    .map_err(|error| {
        runtime_error(format!(
            "Spider dynamic fetch did not return a page: {error}"
        ))
    })?;
    website.unsubscribe();

    let html = page.get_html();
    let text = {
        let content = page.get_content();
        if content.trim().is_empty() {
            strip_html(&html)
        } else {
            content
        }
    };
    Ok(SpiderFetchSnapshot {
        url: request.url.clone(),
        final_url: page.get_url().to_string(),
        status_code: page.status_code.as_u16(),
        content_type: "text/html".to_string(),
        title: extract_html_title(&html),
        html,
        text,
    })
}

fn apply_wait_options(website: &mut Website, request: &SpiderFetchRequest) {
    let timeout = Some(Duration::from_secs(request.timeout_seconds));
    if let Some(selector) = request.wait_for.as_ref() {
        website.with_wait_for_selector(Some(WaitForSelector::new(timeout, selector.clone())));
    }
    match request.wait_until.as_deref() {
        Some("networkidle") | Some("network-idle") | Some("idle_network") => {
            website.with_wait_for_idle_network(Some(WaitForIdleNetwork::new(timeout)));
        }
        Some("domidle") | Some("dom-idle") | Some("idle_dom") => {
            if let Some(selector) = request.wait_for.as_ref() {
                website
                    .with_wait_for_idle_dom(Some(WaitForSelector::new(timeout, selector.clone())));
            }
        }
        Some("delay") => {
            website.with_wait_for_delay(Some(WaitForDelay::new(timeout)));
        }
        _ => {}
    }
}

pub fn shape_spider_dynamic_fetch_payload(
    snapshot: SpiderFetchSnapshot,
    request: SpiderFetchRequest,
    started: Instant,
) -> Value {
    let selected = match request.output.as_str() {
        "html" => snapshot.html.clone(),
        "text" | "markdown" | "structured" => snapshot.text.clone(),
        _ => snapshot.text.clone(),
    };
    let (content, truncated) = truncate_chars(&selected, request.max_chars);
    let content_preview = truncate_chars(&snapshot.text, 2_000).0;
    let wrapped_preview = wrap_web_content(&content_preview, "web_fetch");
    let wrapped_content = wrap_web_content(&content, "web_fetch");
    let wrapped_text = wrap_external_content(&content, "web_fetch", true);
    let wrapped_html = if request.output == "html" {
        Some(wrap_web_content(&content, "web_fetch"))
    } else {
        Some(wrap_web_content(
            &truncate_chars(&snapshot.html, request.max_chars).0,
            "web_fetch",
        ))
    };
    let fetcher = if request.render == "stealth" {
        "spider:stealth"
    } else {
        "spider:dynamic"
    };
    json!({
        "status": "ok",
        "provider": "spider",
        "fetcher": fetcher,
        "url": snapshot.url,
        "finalUrl": snapshot.final_url,
        "statusCode": snapshot.status_code,
        "contentType": snapshot.content_type,
        "title": snapshot.title,
        "summary": Value::Null,
        "keyPoints": Value::Null,
        "headings": Value::Null,
        "contentPreview": wrapped_preview,
        "html": wrapped_html,
        "content": wrapped_content,
        "text": wrapped_text,
        "metadata": {
            "runtime": "rust-native",
            "render": request.render,
            "spider": true,
            "waitFor": request.wait_for,
            "waitUntil": request.wait_until
        },
        "externalContent": {
            "untrusted": true,
            "source": "web_fetch",
            "provider": "spider",
            "wrapped": true
        },
        "rendered": true,
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
            "url": request.url,
            "output": request.output,
            "render": request.render,
            "timeoutSeconds": request.timeout_seconds,
            "maxChars": request.max_chars,
            "waitFor": request.wait_for,
            "waitUntil": request.wait_until
        }
    })
}

fn read_string(params: &Value, key: &str) -> Option<String> {
    value_string(params.get(key))
}

fn read_u64(params: &Value, key: &str) -> Option<u64> {
    params
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
}

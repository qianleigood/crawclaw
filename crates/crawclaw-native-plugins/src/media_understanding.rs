use std::net::IpAddr;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use reqwest::multipart;
use serde_json::{json, Value};
use tokio::fs;

use crate::error::{invalid_input, runtime_error, NativeResult};

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_IMAGE_MODEL: &str = "gpt-5.4-mini";
const DEFAULT_AUDIO_MODEL: &str = "gpt-4o-mini-transcribe";
const DEFAULT_PROMPT: &str = "Describe the media clearly and concisely.";
const DEFAULT_TIMEOUT_SECONDS: u64 = 60;

#[derive(Debug)]
struct MediaInput {
    index: usize,
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
}

pub async fn describe_openai_media(input: Value) -> NativeResult<Value> {
    let capability = read_string(&input, "capability")
        .or_else(|| read_string_path(&input, &["params", "capability"]))
        .unwrap_or_else(|| "image".to_string());
    match capability.as_str() {
        "image" => describe_openai_images(input).await,
        "audio" => transcribe_openai_audio(input).await,
        other => Err(invalid_input(format!(
            "Unsupported OpenAI media-understanding capability: {other}"
        ))),
    }
}

async fn describe_openai_images(input: Value) -> NativeResult<Value> {
    let api_key = resolve_api_key(&input, "OPENAI_API_KEY")?;
    let base_url = resolve_base_url(&input);
    let model = resolve_model(&input, DEFAULT_IMAGE_MODEL);
    let prompt = read_string(&input, "prompt")
        .or_else(|| read_string_path(&input, &["params", "prompt"]))
        .unwrap_or_else(|| DEFAULT_PROMPT.to_string());
    let timeout_seconds = resolve_timeout_seconds(&input);
    let media = resolve_media_inputs(&input, "image/jpeg").await?;
    if media.is_empty() {
        return Err(invalid_input("At least one image attachment is required."));
    }

    let content = std::iter::once(json!({
        "type": "input_text",
        "text": prompt
    }))
    .chain(media.iter().map(|entry| {
        json!({
            "type": "input_image",
            "image_url": format!(
                "data:{};base64,{}",
                entry.mime_type,
                base64::engine::general_purpose::STANDARD.encode(&entry.bytes)
            )
        })
    }))
    .collect::<Vec<_>>();

    let url = join_url(&base_url, "/responses")?;
    let body = json!({
        "model": model,
        "input": [{
            "role": "user",
            "content": content
        }]
    });
    let response = http_client(&url, timeout_seconds)?
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(runtime_error(format!(
            "OpenAI media understanding request failed with HTTP {status}: {}",
            truncate_error(&body)
        )));
    }
    let parsed = serde_json::from_str::<Value>(&body)?;
    let text = extract_openai_text(&parsed).ok_or_else(|| {
        runtime_error("OpenAI media understanding response did not include output text.")
    })?;

    Ok(json!({
        "provider": "openai",
        "model": model,
        "capability": "image",
        "outputs": [{
            "kind": "image.description",
            "attachmentIndex": media.first().map(|entry| entry.index).unwrap_or(0),
            "text": text,
            "provider": "openai",
            "model": model
        }]
    }))
}

async fn transcribe_openai_audio(input: Value) -> NativeResult<Value> {
    let api_key = resolve_api_key(&input, "OPENAI_API_KEY")?;
    let base_url = resolve_base_url(&input);
    let model = resolve_model(&input, DEFAULT_AUDIO_MODEL);
    let timeout_seconds = resolve_timeout_seconds(&input);
    let media = resolve_media_inputs(&input, "audio/mpeg").await?;
    let audio = media
        .first()
        .ok_or_else(|| invalid_input("One audio attachment is required."))?;

    let mut form = multipart::Form::new().text("model", model.clone()).part(
        "file",
        multipart::Part::bytes(audio.bytes.clone())
            .file_name(audio.file_name.clone())
            .mime_str(&audio.mime_type)
            .map_err(|error| invalid_input(format!("Invalid audio mime type: {error}")))?,
    );
    if let Some(language) = read_string(&input, "language")
        .or_else(|| read_string_path(&input, &["params", "language"]))
    {
        form = form.text("language", language);
    }
    if let Some(prompt) =
        read_string(&input, "prompt").or_else(|| read_string_path(&input, &["params", "prompt"]))
    {
        form = form.text("prompt", prompt);
    }

    let url = join_url(&base_url, "/audio/transcriptions")?;
    let response = http_client(&url, timeout_seconds)?
        .post(url)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(runtime_error(format!(
            "OpenAI audio transcription request failed with HTTP {status}: {}",
            truncate_error(&body)
        )));
    }
    let parsed = serde_json::from_str::<Value>(&body)?;
    let text = parsed
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| runtime_error("OpenAI transcription response did not include text."))?;

    Ok(json!({
        "provider": "openai",
        "model": model,
        "capability": "audio",
        "outputs": [{
            "kind": "audio.transcription",
            "attachmentIndex": audio.index,
            "text": text,
            "provider": "openai",
            "model": model
        }]
    }))
}

async fn resolve_media_inputs(input: &Value, default_mime: &str) -> NativeResult<Vec<MediaInput>> {
    let raw = input
        .get("attachments")
        .or_else(|| input.get("media"))
        .or_else(|| input.pointer("/params/attachments"))
        .or_else(|| input.pointer("/params/media"));
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let entries = raw
        .as_array()
        .ok_or_else(|| invalid_input("media attachments must be an array"))?;
    let mut media = Vec::new();
    for (position, entry) in entries.iter().enumerate() {
        let object = entry
            .as_object()
            .ok_or_else(|| invalid_input("media attachment entries must be objects"))?;
        let index = object
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(position);
        let mime_type = object
            .get("mimeType")
            .or_else(|| object.get("mime"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| default_mime.to_string());
        let file_name = object
            .get("fileName")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                object
                    .get("path")
                    .and_then(Value::as_str)
                    .and_then(|path| Path::new(path).file_name()?.to_str().map(str::to_string))
            })
            .unwrap_or_else(|| format!("media-{index}"));
        let bytes = if let Some(data) = object
            .get("dataBase64")
            .or_else(|| object.get("base64"))
            .and_then(Value::as_str)
        {
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|error| invalid_input(format!("Invalid media base64 data: {error}")))?
        } else if let Some(path) = object.get("path").and_then(Value::as_str) {
            fs::read(path).await?
        } else {
            return Err(invalid_input(
                "media attachment requires dataBase64, base64, or path",
            ));
        };
        media.push(MediaInput {
            index,
            file_name,
            mime_type,
            bytes,
        });
    }
    Ok(media)
}

fn resolve_api_key(input: &Value, env_key: &str) -> NativeResult<String> {
    read_string(input, "apiKey")
        .or_else(|| read_string_path(input, &["providerConfig", "apiKey"]))
        .or_else(|| read_string_path(input, &["params", "apiKey"]))
        .or_else(|| std::env::var(env_key).ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid_input(format!("Missing API key. Provide apiKey or {env_key}.")))
}

fn resolve_base_url(input: &Value) -> String {
    read_string(input, "baseUrl")
        .or_else(|| read_string_path(input, &["providerConfig", "baseUrl"]))
        .or_else(|| read_string_path(input, &["params", "baseUrl"]))
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

fn resolve_model(input: &Value, fallback: &str) -> String {
    read_string(input, "model")
        .or_else(|| read_string_path(input, &["params", "model"]))
        .unwrap_or_else(|| fallback.to_string())
}

fn resolve_timeout_seconds(input: &Value) -> u64 {
    read_u64(input, "timeoutSeconds")
        .or_else(|| read_u64_path(input, &["params", "timeoutSeconds"]))
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
        .clamp(1, 300)
}

fn read_string(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_string_path(input: &Value, path: &[&str]) -> Option<String> {
    let mut current = input;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_u64(input: &Value, key: &str) -> Option<u64> {
    input.get(key).and_then(Value::as_u64)
}

fn read_u64_path(input: &Value, path: &[&str]) -> Option<u64> {
    let mut current = input;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_u64()
}

fn join_url(base_url: &str, path: &str) -> NativeResult<String> {
    let base = base_url.trim().trim_end_matches('/');
    if !(base.starts_with("https://") || base.starts_with("http://127.0.0.1")) {
        return Err(invalid_input(
            "OpenAI media understanding baseUrl must be https:// or loopback http://.",
        ));
    }
    Ok(format!("{base}{path}"))
}

fn http_client(url: &str, timeout_seconds: u64) -> NativeResult<reqwest::Client> {
    let builder = reqwest::Client::builder().timeout(Duration::from_secs(timeout_seconds));
    let builder = if is_loopback_url(url) {
        builder.no_proxy()
    } else {
        builder
    };
    Ok(builder.build()?)
}

fn is_loopback_url(url: &str) -> bool {
    reqwest::Url::parse(url)
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

fn extract_openai_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let output = value.get("output")?.as_array()?;
    let mut chunks = Vec::new();
    for item in output {
        let Some(content) = item.get("content").and_then(Value::as_array) else {
            continue;
        };
        for block in content {
            if let Some(text) = block
                .get("text")
                .or_else(|| block.get("output_text"))
                .and_then(Value::as_str)
            {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    chunks.push(trimmed.to_string());
                }
            }
        }
    }
    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}

fn truncate_error(body: &str) -> String {
    let collapsed = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.len() <= 300 {
        collapsed
    } else {
        format!("{}...", &collapsed[..300])
    }
}

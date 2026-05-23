use std::fmt;
use std::net::IpAddr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiCompatibleConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProviderTransportError {
    Unavailable(String),
    InvalidResponse(String),
    Unsupported(String),
}

impl fmt::Display for ProviderTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(message)
            | Self::InvalidResponse(message)
            | Self::Unsupported(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ProviderTransportError {}

pub async fn send_openai_compatible_message(
    config: &OpenAiCompatibleConfig,
    user_text: &str,
) -> Result<String, ProviderTransportError> {
    send_native_provider_message(
        &NativeProviderConfig {
            provider: "openai-compatible".to_string(),
            base_url: Some(config.base_url.clone()),
            api_key: Some(config.api_key.clone()),
            model: Some(config.model.clone()),
            api: None,
            api_version: None,
        },
        user_text,
    )
    .await
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeProviderConfig {
    pub provider: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,
    pub api_version: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NativeProviderMessageRole {
    User,
    Assistant,
}

impl NativeProviderMessageRole {
    fn as_chat_role(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }

    fn as_google_role(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "model",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeProviderMessage {
    pub role: NativeProviderMessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<NativeProviderContentBlock>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NativeProviderContentBlock {
    Text { text: String },
    Image { mime_type: String, data: String },
}

impl NativeProviderContentBlock {
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text { text: text.into() }
    }

    pub fn image_base64(mime_type: impl Into<String>, data: impl Into<String>) -> Self {
        Self::Image {
            mime_type: mime_type.into(),
            data: data.into(),
        }
    }
}

impl NativeProviderMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: NativeProviderMessageRole::User,
            content: content.into(),
            blocks: Vec::new(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: NativeProviderMessageRole::Assistant,
            content: content.into(),
            blocks: Vec::new(),
        }
    }

    pub fn user_blocks(blocks: Vec<NativeProviderContentBlock>) -> Self {
        Self {
            role: NativeProviderMessageRole::User,
            content: native_content_blocks_text(&blocks),
            blocks,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeProviderRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
    pub response_format: NativeProviderResponseFormat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeProviderResponseFormat {
    OpenAiResponses,
    ChatCompletions,
    AnthropicMessages,
    GoogleGenerateContent,
    OllamaChat,
    BedrockConverse,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NativeProviderRequestOptions {
    pub stream: bool,
    pub tools: Vec<NativeProviderTool>,
    pub reasoning_level: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeProviderTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
}

pub async fn send_native_provider_message(
    config: &NativeProviderConfig,
    user_text: &str,
) -> Result<String, ProviderTransportError> {
    send_native_provider_conversation(config, &[NativeProviderMessage::user(user_text)]).await
}

pub async fn send_native_provider_conversation(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
) -> Result<String, ProviderTransportError> {
    send_native_provider_conversation_with_options(
        config,
        messages,
        &NativeProviderRequestOptions::default(),
    )
    .await
}

pub async fn send_native_provider_conversation_with_options(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<String, ProviderTransportError> {
    let request =
        build_native_provider_conversation_request_with_options(config, messages, options)?;
    let mut client_builder = reqwest::Client::builder().timeout(Duration::from_secs(30));
    if is_loopback_request_url(&request.url) {
        client_builder = client_builder.no_proxy();
    }
    let client = client_builder
        .build()
        .map_err(|error| ProviderTransportError::Unavailable(error.to_string()))?;
    let mut builder = client.post(&request.url);
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    let response = builder
        .json(&request.body)
        .send()
        .await
        .map_err(|error| ProviderTransportError::Unavailable(error.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(ProviderTransportError::Unavailable(format!(
            "provider returned HTTP {status}"
        )));
    }

    if options.stream {
        let body = response
            .text()
            .await
            .map_err(|error| ProviderTransportError::InvalidResponse(error.to_string()))?;
        return parse_native_provider_stream_response(request.response_format, &body);
    }

    let body = response
        .json::<Value>()
        .await
        .map_err(|error| ProviderTransportError::InvalidResponse(error.to_string()))?;
    parse_native_provider_response(request.response_format, body)
}

fn is_loopback_request_url(url: &str) -> bool {
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

pub fn build_native_provider_request(
    config: &NativeProviderConfig,
    user_text: &str,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    build_native_provider_conversation_request(config, &[NativeProviderMessage::user(user_text)])
}

pub fn build_native_provider_conversation_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
) -> Result<NativeProviderRequest, ProviderTransportError> {
    build_native_provider_conversation_request_with_options(
        config,
        messages,
        &NativeProviderRequestOptions::default(),
    )
}

pub fn build_native_provider_conversation_request_with_options(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let messages = normalize_native_provider_messages(messages)?;
    let transport = resolve_provider_transport(config)?;
    if !is_implemented_native_provider_transport(transport) {
        return Err(ProviderTransportError::Unsupported(format!(
            "Unsupported Rust provider transport: {transport}"
        )));
    }
    match transport {
        "openai-responses" | "openai-codex-responses" => openai_responses_request(
            config,
            if is_default_openai_provider(&config.provider) {
                "https://api.openai.com/v1"
            } else {
                ""
            },
            "Authorization",
            "Bearer ",
            &messages,
            options,
        ),
        "azure-openai-responses" => azure_openai_request(config, &messages, options),
        "anthropic-messages" => anthropic_messages_request(config, &messages, options),
        "google-generative-ai" => google_generate_content_request(config, &messages, options),
        "ollama" => ollama_chat_request(config, &messages, options),
        "bedrock-converse-stream" => bedrock_converse_request(config, &messages, options),
        "github-copilot" => chat_completions_request(
            config,
            "https://api.githubcopilot.com",
            "Authorization",
            "Bearer ",
            &messages,
            options,
        ),
        "openai-completions" => {
            chat_completions_request(config, "", "Authorization", "Bearer ", &messages, options)
        }
        _ => unreachable!("transport implementation checked before request build"),
    }
}

pub(crate) fn is_implemented_native_provider_transport(transport: &str) -> bool {
    matches!(
        transport,
        "openai-responses"
            | "openai-codex-responses"
            | "azure-openai-responses"
            | "anthropic-messages"
            | "google-generative-ai"
            | "ollama"
            | "bedrock-converse-stream"
            | "github-copilot"
            | "openai-completions"
    )
}

pub fn parse_native_provider_response(
    format: NativeProviderResponseFormat,
    body: Value,
) -> Result<String, ProviderTransportError> {
    let text = match format {
        NativeProviderResponseFormat::OpenAiResponses => body
            .get("output_text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| {
                first_text_at_path(&body, &["output", "content", "text"]).map(ToOwned::to_owned)
            }),
        NativeProviderResponseFormat::ChatCompletions => body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::AnthropicMessages => body
            .get("content")
            .and_then(Value::as_array)
            .and_then(|parts| text_from_parts(parts, "text")),
        NativeProviderResponseFormat::GoogleGenerateContent => body
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|candidates| candidates.first())
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .and_then(|parts| text_from_parts(parts, "text")),
        NativeProviderResponseFormat::OllamaChat => body
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::BedrockConverse => body
            .get("output")
            .and_then(|output| output.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
            .and_then(|parts| text_from_parts(parts, "text")),
    };
    text.filter(|content| !content.trim().is_empty())
        .ok_or_else(|| {
            ProviderTransportError::InvalidResponse(
                "provider response did not include assistant content".to_string(),
            )
        })
}

pub fn parse_native_provider_stream_delta(
    format: NativeProviderResponseFormat,
    chunk: &str,
) -> Result<Option<String>, ProviderTransportError> {
    let Some(body) = stream_chunk_json(chunk)? else {
        return Ok(None);
    };
    let text = match format {
        NativeProviderResponseFormat::OpenAiResponses => body
            .get("delta")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::ChatCompletions => body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("delta"))
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::AnthropicMessages => body
            .get("delta")
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::GoogleGenerateContent => body
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|candidates| candidates.first())
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .and_then(|parts| text_from_parts(parts, "text")),
        NativeProviderResponseFormat::OllamaChat => body
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        NativeProviderResponseFormat::BedrockConverse => body
            .get("contentBlockDelta")
            .and_then(|event| event.get("delta"))
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    };
    Ok(text.filter(|text| !text.trim().is_empty()))
}

pub fn parse_native_provider_stream_response(
    format: NativeProviderResponseFormat,
    body: &str,
) -> Result<String, ProviderTransportError> {
    let mut text = String::new();
    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.starts_with(':') || line.starts_with("event:") || line.starts_with("id:") {
            continue;
        }
        if let Some(delta) = parse_native_provider_stream_delta(format, line)? {
            text.push_str(&delta);
        }
    }
    if text.trim().is_empty() {
        return Err(ProviderTransportError::InvalidResponse(
            "provider stream did not include assistant content".to_string(),
        ));
    }
    Ok(text)
}

pub(crate) fn openai_compatible_chat_completions_url(base_url: &str) -> String {
    let base_url = base_url.trim_end_matches('/');
    if base_url.ends_with("/v1") {
        format!("{base_url}/chat/completions")
    } else {
        format!("{base_url}/v1/chat/completions")
    }
}

fn openai_responses_request(
    config: &NativeProviderConfig,
    default_base_url: &str,
    auth_header: &str,
    auth_prefix: &str,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = resolve_base_url(config, default_base_url)?;
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "input": openai_responses_input(messages),
    });
    apply_openai_responses_options(&mut body, options);
    apply_openai_responses_provider_policy(config, &mut body);
    Ok(NativeProviderRequest {
        url: join_url_path(&base_url, "responses"),
        headers: vec![auth_pair(
            auth_header,
            auth_prefix,
            required(&config.api_key, "apiKey")?,
        )],
        body,
        response_format: NativeProviderResponseFormat::OpenAiResponses,
    })
}

fn apply_openai_responses_provider_policy(config: &NativeProviderConfig, body: &mut Value) {
    if config.provider == "xai" {
        body["tool_stream"] = Value::Bool(true);
        if let Some(object) = body.as_object_mut() {
            object.remove("reasoning");
            object.remove("reasoningEffort");
            object.remove("reasoning_effort");
        }
    }
}

fn azure_openai_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = required(&config.base_url, "baseUrl")?;
    let api_version = config
        .api_version
        .as_deref()
        .unwrap_or("2025-04-01-preview");
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "input": openai_responses_input(messages),
    });
    apply_openai_responses_options(&mut body, options);
    Ok(NativeProviderRequest {
        url: format!(
            "{}?api-version={api_version}",
            join_url_path(base_url.trim_end_matches('/'), "responses")
        ),
        headers: vec![("api-key".to_string(), required(&config.api_key, "apiKey")?)],
        body,
        response_format: NativeProviderResponseFormat::OpenAiResponses,
    })
}

fn anthropic_messages_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = resolve_base_url(
        config,
        if config.provider == "anthropic" {
            "https://api.anthropic.com"
        } else {
            ""
        },
    )?;
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "max_tokens": 1024,
        "messages": native_messages_for_anthropic(messages),
    });
    apply_anthropic_options(&mut body, options);
    Ok(NativeProviderRequest {
        url: join_url_path(&base_url, "v1/messages"),
        headers: vec![
            (
                "x-api-key".to_string(),
                required(&config.api_key, "apiKey")?,
            ),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
        ],
        body,
        response_format: NativeProviderResponseFormat::AnthropicMessages,
    })
}

fn google_generate_content_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = resolve_base_url(
        config,
        if config.provider == "google" {
            "https://generativelanguage.googleapis.com/v1beta"
        } else {
            ""
        },
    )?;
    let model = required(&config.model, "model")?;
    let mut body = json!({
        "contents": native_messages_for_google(messages),
    });
    apply_google_options(&mut body, options);
    let method = if options.stream {
        "streamGenerateContent"
    } else {
        "generateContent"
    };
    Ok(NativeProviderRequest {
        url: format!(
            "{}/models/{model}:{method}?key={}",
            base_url,
            required(&config.api_key, "apiKey")?
        ),
        headers: Vec::new(),
        body,
        response_format: NativeProviderResponseFormat::GoogleGenerateContent,
    })
}

fn ollama_chat_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("http://127.0.0.1:11434")
        .trim_end_matches('/');
    let mut headers = Vec::new();
    if let Some(api_key) = non_empty(config.api_key.as_deref()) {
        headers.push(auth_pair("Authorization", "Bearer ", api_key.to_string()));
    }
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "messages": native_messages_for_ollama(messages),
        "stream": options.stream,
    });
    apply_ollama_options(&mut body, options);
    Ok(NativeProviderRequest {
        url: join_url_path(base_url, "api/chat"),
        headers,
        body,
        response_format: NativeProviderResponseFormat::OllamaChat,
    })
}

fn bedrock_converse_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = required(&config.base_url, "baseUrl")?;
    let model = required(&config.model, "model")?;
    let mut headers = Vec::new();
    if let Some(api_key) = non_empty(config.api_key.as_deref()) {
        headers.push(auth_pair("Authorization", "Bearer ", api_key.to_string()));
    }
    let mut body = json!({
        "messages": native_messages_for_bedrock(messages),
    });
    apply_bedrock_options(&mut body, options);
    let method = if options.stream {
        "converse-stream"
    } else {
        "converse"
    };
    Ok(NativeProviderRequest {
        url: join_url_path(
            base_url.trim_end_matches('/'),
            &format!("model/{model}/{method}"),
        ),
        headers,
        body,
        response_format: NativeProviderResponseFormat::BedrockConverse,
    })
}

fn chat_completions_request(
    config: &NativeProviderConfig,
    default_base_url: &str,
    auth_header: &str,
    auth_prefix: &str,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = config
        .base_url
        .as_deref()
        .filter(|base_url| !base_url.trim().is_empty())
        .or_else(|| non_empty(Some(default_base_url)))
        .ok_or_else(|| {
            ProviderTransportError::Unavailable("Provider config is missing baseUrl.".to_string())
        })?;
    let url = if config.provider == "openai-compatible" {
        openai_compatible_chat_completions_url(base_url)
    } else {
        join_url_path(base_url.trim_end_matches('/'), "chat/completions")
    };
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "messages": native_messages_for_chat(messages),
        "stream": options.stream,
    });
    apply_chat_completions_options(&mut body, options);
    let mut headers = vec![auth_pair(
        auth_header,
        auth_prefix,
        required(&config.api_key, "apiKey")?,
    )];
    apply_openai_compatible_provider_policy(config, &mut body, &mut headers, options);
    Ok(NativeProviderRequest {
        url,
        headers,
        body,
        response_format: NativeProviderResponseFormat::ChatCompletions,
    })
}

fn apply_openai_compatible_provider_policy(
    config: &NativeProviderConfig,
    body: &mut Value,
    headers: &mut Vec<(String, String)>,
    options: &NativeProviderRequestOptions,
) {
    match config.provider.as_str() {
        "kilocode" => {
            let feature =
                std::env::var("KILOCODE_FEATURE").unwrap_or_else(|_| "crawclaw".to_string());
            upsert_header(headers, "X-KILOCODE-FEATURE", feature);
            if config
                .model
                .as_deref()
                .map(|model| model != "kilo/auto" && !is_proxy_reasoning_unsupported(model))
                .unwrap_or(false)
            {
                if let Some(level) = options.reasoning_level.as_deref() {
                    body["reasoning"] = json!({ "effort": map_reasoning_level(level) });
                    if let Some(object) = body.as_object_mut() {
                        object.remove("reasoning_effort");
                    }
                }
            }
        }
        "openrouter" => {
            upsert_header(headers, "HTTP-Referer", "https://docs.crawclaw.ai");
            upsert_header(headers, "X-OpenRouter-Title", "CrawClaw");
            upsert_header(headers, "X-OpenRouter-Categories", "cli-agent");
            if config
                .model
                .as_deref()
                .map(|model| !is_proxy_reasoning_unsupported(model))
                .unwrap_or(false)
            {
                if let Some(level) = options.reasoning_level.as_deref() {
                    body["reasoning"] = json!({ "effort": map_reasoning_level(level) });
                    if let Some(object) = body.as_object_mut() {
                        object.remove("reasoning_effort");
                    }
                }
            }
        }
        "xiaomi" => {
            if let Some(api_key) = non_empty(config.api_key.as_deref()) {
                remove_header(headers, "Authorization");
                upsert_header(headers, "api-key", api_key.to_string());
            }
        }
        "zai" => {
            body["tool_stream"] = Value::Bool(true);
        }
        _ => {}
    }
}

fn remove_header(headers: &mut Vec<(String, String)>, name: &str) {
    headers.retain(|(existing, _)| !existing.eq_ignore_ascii_case(name));
}

fn upsert_header(headers: &mut Vec<(String, String)>, name: &str, value: impl Into<String>) {
    let value = value.into();
    if let Some((_, existing)) = headers
        .iter_mut()
        .find(|(existing, _)| existing.eq_ignore_ascii_case(name))
    {
        *existing = value;
    } else {
        headers.push((name.to_string(), value));
    }
}

fn is_proxy_reasoning_unsupported(model_id: &str) -> bool {
    model_id.to_lowercase().starts_with("x-ai/")
}

fn map_reasoning_level(level: &str) -> &str {
    match level {
        "off" => "none",
        "adaptive" => "medium",
        "minimal" | "low" | "medium" | "high" | "xhigh" => level,
        _ => "medium",
    }
}

fn resolve_base_url(
    config: &NativeProviderConfig,
    default_base_url: &str,
) -> Result<String, ProviderTransportError> {
    config
        .base_url
        .as_deref()
        .filter(|base_url| !base_url.trim().is_empty())
        .or_else(|| non_empty(Some(default_base_url)))
        .map(|base_url| base_url.trim_end_matches('/').to_string())
        .ok_or_else(|| {
            ProviderTransportError::Unavailable("Provider config is missing baseUrl.".to_string())
        })
}

fn normalize_native_provider_messages(
    messages: &[NativeProviderMessage],
) -> Result<Vec<NativeProviderMessage>, ProviderTransportError> {
    let normalized = messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            let blocks = normalize_native_content_blocks(&message.blocks);
            if content.is_empty() && blocks.is_empty() {
                None
            } else {
                Some(NativeProviderMessage {
                    role: message.role,
                    content: content.to_string(),
                    blocks,
                })
            }
        })
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return Err(ProviderTransportError::Unavailable(
            "Provider request is missing messages.".to_string(),
        ));
    }
    Ok(normalized)
}

fn normalize_native_content_blocks(
    blocks: &[NativeProviderContentBlock],
) -> Vec<NativeProviderContentBlock> {
    blocks
        .iter()
        .filter_map(|block| match block {
            NativeProviderContentBlock::Text { text } => non_empty(Some(text.as_str()))
                .map(|text| NativeProviderContentBlock::text(text.to_string())),
            NativeProviderContentBlock::Image { mime_type, data } => {
                let mime_type = non_empty(Some(mime_type.as_str()))?;
                let data = non_empty(Some(data.as_str()))?;
                Some(NativeProviderContentBlock::image_base64(
                    mime_type.to_string(),
                    data.to_string(),
                ))
            }
        })
        .collect()
}

fn native_content_blocks_text(blocks: &[NativeProviderContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            NativeProviderContentBlock::Text { text } => non_empty(Some(text.as_str())),
            NativeProviderContentBlock::Image { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn openai_responses_input(messages: &[NativeProviderMessage]) -> Value {
    if let [message] = messages {
        if message.role == NativeProviderMessageRole::User && message.blocks.is_empty() {
            return Value::String(message.content.clone());
        }
    }
    Value::Array(
        messages
            .iter()
            .map(|message| {
                json!({
                    "role": message.role.as_chat_role(),
                    "content": openai_responses_content(message),
                })
            })
            .collect(),
    )
}

fn openai_responses_content(message: &NativeProviderMessage) -> Value {
    let blocks = native_message_blocks(message);
    Value::Array(
        blocks
            .iter()
            .map(|block| match block {
                NativeProviderContentBlock::Text { text } => {
                    json!({ "type": "input_text", "text": text })
                }
                NativeProviderContentBlock::Image { mime_type, data } => json!({
                    "type": "input_image",
                    "image_url": data_url(mime_type, data)
                }),
            })
            .collect(),
    )
}

fn native_messages_for_chat(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_chat_role(),
                "content": chat_content(message),
            })
        })
        .collect()
}

fn native_messages_for_anthropic(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_chat_role(),
                "content": anthropic_content(message),
            })
        })
        .collect()
}

fn native_messages_for_google(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_google_role(),
                "parts": google_parts(message),
            })
        })
        .collect()
}

fn native_messages_for_bedrock(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_chat_role(),
                "content": bedrock_content(message),
            })
        })
        .collect()
}

fn native_messages_for_ollama(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            let mut value = json!({
                "role": message.role.as_chat_role(),
                "content": native_content_blocks_text(&native_message_blocks(message)),
            });
            let images = native_message_blocks(message)
                .iter()
                .filter_map(|block| match block {
                    NativeProviderContentBlock::Image { data, .. } => {
                        Some(Value::String(data.clone()))
                    }
                    NativeProviderContentBlock::Text { .. } => None,
                })
                .collect::<Vec<_>>();
            if !images.is_empty() {
                value["images"] = Value::Array(images);
            }
            value
        })
        .collect()
}

fn native_message_blocks(message: &NativeProviderMessage) -> Vec<NativeProviderContentBlock> {
    if !message.blocks.is_empty() {
        return message.blocks.clone();
    }
    vec![NativeProviderContentBlock::text(message.content.clone())]
}

fn chat_content(message: &NativeProviderMessage) -> Value {
    if message.blocks.is_empty() {
        return Value::String(message.content.clone());
    }
    Value::Array(
        native_message_blocks(message)
            .iter()
            .map(|block| match block {
                NativeProviderContentBlock::Text { text } => {
                    json!({ "type": "text", "text": text })
                }
                NativeProviderContentBlock::Image { mime_type, data } => json!({
                    "type": "image_url",
                    "image_url": { "url": data_url(mime_type, data) }
                }),
            })
            .collect(),
    )
}

fn anthropic_content(message: &NativeProviderMessage) -> Value {
    if message.blocks.is_empty() {
        return Value::String(message.content.clone());
    }
    Value::Array(
        native_message_blocks(message)
            .iter()
            .map(|block| match block {
                NativeProviderContentBlock::Text { text } => {
                    json!({ "type": "text", "text": text })
                }
                NativeProviderContentBlock::Image { mime_type, data } => json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": data
                    }
                }),
            })
            .collect(),
    )
}

fn google_parts(message: &NativeProviderMessage) -> Vec<Value> {
    native_message_blocks(message)
        .iter()
        .map(|block| match block {
            NativeProviderContentBlock::Text { text } => json!({ "text": text }),
            NativeProviderContentBlock::Image { mime_type, data } => json!({
                "inlineData": {
                    "mimeType": mime_type,
                    "data": data
                }
            }),
        })
        .collect()
}

fn bedrock_content(message: &NativeProviderMessage) -> Vec<Value> {
    native_message_blocks(message)
        .iter()
        .map(|block| match block {
            NativeProviderContentBlock::Text { text } => json!({ "text": text }),
            NativeProviderContentBlock::Image { mime_type, data } => json!({
                "image": {
                    "format": image_format_from_mime(mime_type),
                    "source": { "bytes": data }
                }
            }),
        })
        .collect()
}

fn data_url(mime_type: &str, data: &str) -> String {
    format!("data:{mime_type};base64,{data}")
}

fn image_format_from_mime(mime_type: &str) -> &str {
    mime_type
        .rsplit('/')
        .next()
        .filter(|format| !format.trim().is_empty())
        .unwrap_or("png")
}

fn apply_openai_responses_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if options.stream {
        body["stream"] = Value::Bool(true);
    }
    if let Some(level) = options.reasoning_level.as_deref() {
        if body
            .get("model")
            .and_then(Value::as_str)
            .map(is_openai_responses_reasoning_model)
            .unwrap_or(false)
        {
            body["reasoning"] = json!({ "effort": map_reasoning_level(level) });
        }
    }
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(openai_responses_tool).collect());
        body["tool_choice"] = Value::String("auto".to_string());
    }
}

fn is_openai_responses_reasoning_model(model_id: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    normalized.starts_with("gpt-5") || normalized.starts_with('o')
}

fn apply_chat_completions_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(openai_chat_tool).collect());
        body["tool_choice"] = Value::String("auto".to_string());
    }
}

fn apply_anthropic_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if options.stream {
        body["stream"] = Value::Bool(true);
    }
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(anthropic_tool).collect());
        body["tool_choice"] = json!({ "type": "auto" });
    }
}

fn apply_google_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if !options.tools.is_empty() {
        body["tools"] = json!([{
            "functionDeclarations": options.tools.iter().map(google_tool).collect::<Vec<_>>()
        }]);
    }
}

fn apply_ollama_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(openai_chat_tool).collect());
    }
}

fn apply_bedrock_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if !options.tools.is_empty() {
        body["toolConfig"] = json!({
            "tools": options.tools.iter().map(bedrock_tool).collect::<Vec<_>>()
        });
    }
}

fn openai_responses_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "type": "function",
        "name": tool.name,
        "description": tool.description.as_deref().unwrap_or(""),
        "parameters": tool.input_schema,
    })
}

fn openai_chat_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description.as_deref().unwrap_or(""),
            "parameters": tool.input_schema,
        }
    })
}

fn anthropic_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description.as_deref().unwrap_or(""),
        "input_schema": tool.input_schema,
    })
}

fn google_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description.as_deref().unwrap_or(""),
        "parameters": tool.input_schema,
    })
}

fn bedrock_tool(tool: &NativeProviderTool) -> Value {
    json!({
        "toolSpec": {
            "name": tool.name,
            "description": tool.description.as_deref().unwrap_or(""),
            "inputSchema": { "json": tool.input_schema }
        }
    })
}

fn required(value: &Option<String>, field: &str) -> Result<String, ProviderTransportError> {
    non_empty(value.as_deref())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            ProviderTransportError::Unavailable(format!("Provider config is missing {field}."))
        })
}

pub(crate) fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn auth_pair(name: &str, prefix: &str, value: String) -> (String, String) {
    (name.to_string(), format!("{prefix}{}", value.trim()))
}

fn join_url_path(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn text_from_parts(parts: &[Value], field: &str) -> Option<String> {
    parts
        .iter()
        .filter_map(|part| part.get(field).and_then(Value::as_str))
        .find(|text| !text.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn first_text_at_path<'a>(body: &'a Value, path: &[&str]) -> Option<&'a str> {
    if path.is_empty() {
        return body.as_str();
    }
    match body {
        Value::Array(values) => values
            .iter()
            .find_map(|value| first_text_at_path(value, path)),
        Value::Object(map) => map
            .get(path[0])
            .and_then(|value| first_text_at_path(value, &path[1..])),
        _ => None,
    }
}

fn stream_chunk_json(chunk: &str) -> Result<Option<Value>, ProviderTransportError> {
    let mut payload = chunk.trim();
    if let Some(stripped) = payload.strip_prefix("data:") {
        payload = stripped.trim();
    }
    if payload.is_empty() || payload == "[DONE]" {
        return Ok(None);
    }
    serde_json::from_str(payload)
        .map(Some)
        .map_err(|error| ProviderTransportError::InvalidResponse(error.to_string()))
}

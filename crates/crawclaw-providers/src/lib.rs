use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTransport {
    pub id: &'static str,
    pub transport: &'static str,
}

pub const NATIVE_PROVIDER_TRANSPORTS: &[ProviderTransport] = &[
    ProviderTransport {
        id: "anthropic",
        transport: "anthropic-messages",
    },
    ProviderTransport {
        id: "azure-openai",
        transport: "azure-openai-responses",
    },
    ProviderTransport {
        id: "bedrock",
        transport: "bedrock-converse-stream",
    },
    ProviderTransport {
        id: "github-copilot",
        transport: "github-copilot",
    },
    ProviderTransport {
        id: "google",
        transport: "google-generative-ai",
    },
    ProviderTransport {
        id: "ollama",
        transport: "ollama",
    },
    ProviderTransport {
        id: "openai",
        transport: "openai-responses",
    },
    ProviderTransport {
        id: "openai-codex",
        transport: "openai-codex-responses",
    },
    ProviderTransport {
        id: "openai-compatible",
        transport: "openai-completions",
    },
];

pub fn native_provider_ids() -> Vec<&'static str> {
    NATIVE_PROVIDER_TRANSPORTS
        .iter()
        .map(|provider| provider.id)
        .collect()
}

pub fn default_model_options() -> Vec<String> {
    vec![
        "gpt-5.5".to_string(),
        "gpt-5.4".to_string(),
        "sonnet-4.6".to_string(),
        "ollama/local".to_string(),
    ]
}

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
}

impl NativeProviderMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: NativeProviderMessageRole::User,
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: NativeProviderMessageRole::Assistant,
            content: content.into(),
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
    let request = build_native_provider_conversation_request(config, messages)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
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

    let body = response
        .json::<Value>()
        .await
        .map_err(|error| ProviderTransportError::InvalidResponse(error.to_string()))?;
    parse_native_provider_response(request.response_format, body)
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
    let messages = normalize_native_provider_messages(messages)?;
    match config.provider.as_str() {
        "openai" | "openai-codex" => openai_responses_request(
            config,
            "https://api.openai.com/v1",
            "Authorization",
            "Bearer ",
            &messages,
        ),
        "azure-openai" => azure_openai_request(config, &messages),
        "anthropic" => anthropic_messages_request(config, &messages),
        "google" => google_generate_content_request(config, &messages),
        "ollama" => ollama_chat_request(config, &messages),
        "bedrock" => bedrock_converse_request(config, &messages),
        "github-copilot" => chat_completions_request(
            config,
            "https://api.githubcopilot.com",
            "Authorization",
            "Bearer ",
            &messages,
        ),
        "openai-compatible" => {
            chat_completions_request(config, "", "Authorization", "Bearer ", &messages)
        }
        provider => Err(ProviderTransportError::Unsupported(format!(
            "Rust provider transport is not registered: {provider}"
        ))),
    }
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

fn openai_compatible_chat_completions_url(base_url: &str) -> String {
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
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or(default_base_url)
        .trim_end_matches('/');
    Ok(NativeProviderRequest {
        url: join_url_path(base_url, "responses"),
        headers: vec![auth_pair(
            auth_header,
            auth_prefix,
            required(&config.api_key, "apiKey")?,
        )],
        body: json!({
            "model": required(&config.model, "model")?,
            "input": openai_responses_input(messages),
        }),
        response_format: NativeProviderResponseFormat::OpenAiResponses,
    })
}

fn azure_openai_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = required(&config.base_url, "baseUrl")?;
    let api_version = config
        .api_version
        .as_deref()
        .unwrap_or("2025-04-01-preview");
    Ok(NativeProviderRequest {
        url: format!(
            "{}?api-version={api_version}",
            join_url_path(base_url.trim_end_matches('/'), "responses")
        ),
        headers: vec![("api-key".to_string(), required(&config.api_key, "apiKey")?)],
        body: json!({
            "model": required(&config.model, "model")?,
            "input": openai_responses_input(messages),
        }),
        response_format: NativeProviderResponseFormat::OpenAiResponses,
    })
}

fn anthropic_messages_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.anthropic.com")
        .trim_end_matches('/');
    Ok(NativeProviderRequest {
        url: join_url_path(base_url, "v1/messages"),
        headers: vec![
            (
                "x-api-key".to_string(),
                required(&config.api_key, "apiKey")?,
            ),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
        ],
        body: json!({
            "model": required(&config.model, "model")?,
            "max_tokens": 1024,
            "messages": native_messages_for_chat(messages),
        }),
        response_format: NativeProviderResponseFormat::AnthropicMessages,
    })
}

fn google_generate_content_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://generativelanguage.googleapis.com/v1beta")
        .trim_end_matches('/');
    let model = required(&config.model, "model")?;
    Ok(NativeProviderRequest {
        url: format!(
            "{}/models/{model}:generateContent?key={}",
            base_url,
            required(&config.api_key, "apiKey")?
        ),
        headers: Vec::new(),
        body: json!({
            "contents": native_messages_for_google(messages),
        }),
        response_format: NativeProviderResponseFormat::GoogleGenerateContent,
    })
}

fn ollama_chat_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
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
    Ok(NativeProviderRequest {
        url: join_url_path(base_url, "api/chat"),
        headers,
        body: json!({
            "model": required(&config.model, "model")?,
            "messages": native_messages_for_chat(messages),
            "stream": false,
        }),
        response_format: NativeProviderResponseFormat::OllamaChat,
    })
}

fn bedrock_converse_request(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = required(&config.base_url, "baseUrl")?;
    let model = required(&config.model, "model")?;
    let mut headers = Vec::new();
    if let Some(api_key) = non_empty(config.api_key.as_deref()) {
        headers.push(auth_pair("Authorization", "Bearer ", api_key.to_string()));
    }
    Ok(NativeProviderRequest {
        url: join_url_path(
            base_url.trim_end_matches('/'),
            &format!("model/{model}/converse"),
        ),
        headers,
        body: json!({
            "messages": native_messages_for_bedrock(messages),
        }),
        response_format: NativeProviderResponseFormat::BedrockConverse,
    })
}

fn chat_completions_request(
    config: &NativeProviderConfig,
    default_base_url: &str,
    auth_header: &str,
    auth_prefix: &str,
    messages: &[NativeProviderMessage],
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
    Ok(NativeProviderRequest {
        url,
        headers: vec![auth_pair(
            auth_header,
            auth_prefix,
            required(&config.api_key, "apiKey")?,
        )],
        body: json!({
            "model": required(&config.model, "model")?,
            "messages": native_messages_for_chat(messages),
            "stream": false,
        }),
        response_format: NativeProviderResponseFormat::ChatCompletions,
    })
}

fn normalize_native_provider_messages(
    messages: &[NativeProviderMessage],
) -> Result<Vec<NativeProviderMessage>, ProviderTransportError> {
    let normalized = messages
        .iter()
        .filter_map(|message| {
            let content = message.content.trim();
            if content.is_empty() {
                None
            } else {
                Some(NativeProviderMessage {
                    role: message.role,
                    content: content.to_string(),
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

fn openai_responses_input(messages: &[NativeProviderMessage]) -> Value {
    if let [message] = messages {
        if message.role == NativeProviderMessageRole::User {
            return Value::String(message.content.clone());
        }
    }
    Value::Array(native_messages_for_chat(messages))
}

fn native_messages_for_chat(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_chat_role(),
                "content": message.content,
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
                "parts": [{ "text": message.content }],
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
                "content": [{ "text": message.content }],
            })
        })
        .collect()
}

fn required(value: &Option<String>, field: &str) -> Result<String, ProviderTransportError> {
    non_empty(value.as_deref())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            ProviderTransportError::Unavailable(format!("Provider config is missing {field}."))
        })
}

fn non_empty(value: Option<&str>) -> Option<&str> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn covers_phase_three_provider_transport_families() {
        let ids = native_provider_ids();
        for required in [
            "openai",
            "openai-codex",
            "azure-openai",
            "anthropic",
            "google",
            "ollama",
            "bedrock",
            "github-copilot",
            "openai-compatible",
        ] {
            assert!(
                ids.contains(&required),
                "missing provider transport {required}"
            );
        }
    }

    #[test]
    fn openai_compatible_endpoint_honors_explicit_v1_base_url() {
        assert_eq!(
            openai_compatible_chat_completions_url("http://127.0.0.1:11434/v1"),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
    }

    #[test]
    fn builds_native_http_requests_for_all_phase_three_provider_families() {
        for provider in [
            "openai",
            "openai-codex",
            "azure-openai",
            "anthropic",
            "google",
            "ollama",
            "bedrock",
            "github-copilot",
            "openai-compatible",
        ] {
            let request = build_native_provider_request(
                &NativeProviderConfig {
                    provider: provider.to_string(),
                    base_url: Some(format!("https://example.test/{provider}")),
                    api_key: Some("secret".to_string()),
                    model: Some("model-a".to_string()),
                    api_version: Some("2025-04-01-preview".to_string()),
                },
                "hello",
            )
            .unwrap_or_else(|error| panic!("{provider} should build a native request: {error}"));

            assert!(
                request.url.starts_with("https://example.test/"),
                "{provider} should use a native HTTP endpoint"
            );
            assert!(
                serde_json::to_string(&request.body)
                    .expect("request body json")
                    .contains("hello"),
                "{provider} should include the user message"
            );
        }
    }

    #[test]
    fn builds_native_conversation_requests_with_assistant_history() {
        let request = build_native_provider_conversation_request(
            &NativeProviderConfig {
                provider: "openai-compatible".to_string(),
                base_url: Some("https://example.test/openai-compatible".to_string()),
                api_key: Some("secret".to_string()),
                model: Some("model-a".to_string()),
                api_version: None,
            },
            &[
                NativeProviderMessage::user("previous user"),
                NativeProviderMessage::assistant("previous assistant"),
                NativeProviderMessage::user("next user"),
            ],
        )
        .expect("conversation request");

        assert_eq!(
            request.body["messages"],
            json!([
                { "role": "user", "content": "previous user" },
                { "role": "assistant", "content": "previous assistant" },
                { "role": "user", "content": "next user" }
            ])
        );
    }

    #[test]
    fn parses_native_provider_response_shapes() {
        for (format, raw, expected) in [
            (
                NativeProviderResponseFormat::OpenAiResponses,
                r#"{"output_text":"openai reply"}"#,
                "openai reply",
            ),
            (
                NativeProviderResponseFormat::ChatCompletions,
                r#"{"choices":[{"message":{"content":"chat reply"}}]}"#,
                "chat reply",
            ),
            (
                NativeProviderResponseFormat::AnthropicMessages,
                r#"{"content":[{"type":"text","text":"anthropic reply"}]}"#,
                "anthropic reply",
            ),
            (
                NativeProviderResponseFormat::GoogleGenerateContent,
                r#"{"candidates":[{"content":{"parts":[{"text":"google reply"}]}}]}"#,
                "google reply",
            ),
            (
                NativeProviderResponseFormat::OllamaChat,
                r#"{"message":{"content":"ollama reply"}}"#,
                "ollama reply",
            ),
            (
                NativeProviderResponseFormat::BedrockConverse,
                r#"{"output":{"message":{"content":[{"text":"bedrock reply"}]}}}"#,
                "bedrock reply",
            ),
        ] {
            let body: serde_json::Value = serde_json::from_str(raw).expect("response json");
            assert_eq!(
                parse_native_provider_response(format, body).expect("assistant text"),
                expected
            );
        }
    }

    #[tokio::test]
    async fn sends_openai_compatible_request_to_mocked_provider() {
        let (base_url, request_rx) =
            serve_once(r#"{"choices":[{"message":{"content":"mocked provider reply"}}]}"#);

        let reply = send_native_provider_message(
            &NativeProviderConfig {
                provider: "openai-compatible".to_string(),
                base_url: Some(base_url),
                api_key: Some("test-key".to_string()),
                model: Some("model-a".to_string()),
                api_version: None,
            },
            "hello provider",
        )
        .await
        .expect("provider reply");

        assert_eq!(reply, "mocked provider reply");
        let request = request_rx.recv().expect("captured request");
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request.contains("authorization: Bearer test-key"));
        assert!(request.contains(r#""model":"model-a""#));
        assert!(request.contains("hello provider"));
    }

    #[test]
    fn parses_native_provider_stream_delta_shapes() {
        for (format, raw, expected) in [
            (
                NativeProviderResponseFormat::OpenAiResponses,
                r#"data: {"type":"response.output_text.delta","delta":"openai"}"#,
                Some("openai"),
            ),
            (
                NativeProviderResponseFormat::ChatCompletions,
                r#"data: {"choices":[{"delta":{"content":"chat"}}]}"#,
                Some("chat"),
            ),
            (
                NativeProviderResponseFormat::AnthropicMessages,
                r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"anthropic"}}"#,
                Some("anthropic"),
            ),
            (
                NativeProviderResponseFormat::GoogleGenerateContent,
                r#"{"candidates":[{"content":{"parts":[{"text":"google"}]}}]}"#,
                Some("google"),
            ),
            (
                NativeProviderResponseFormat::OllamaChat,
                r#"{"message":{"content":"ollama"},"done":false}"#,
                Some("ollama"),
            ),
            (
                NativeProviderResponseFormat::BedrockConverse,
                r#"{"contentBlockDelta":{"delta":{"text":"bedrock"}}}"#,
                Some("bedrock"),
            ),
            (
                NativeProviderResponseFormat::ChatCompletions,
                "data: [DONE]",
                None,
            ),
        ] {
            assert_eq!(
                parse_native_provider_stream_delta(format, raw).expect("stream delta"),
                expected.map(ToOwned::to_owned)
            );
        }
    }

    fn serve_once(response_body: &'static str) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock provider");
        let addr = listener.local_addr().expect("mock provider addr");
        let (request_tx, request_rx) = mpsc::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept provider request");
            let mut buffer = [0; 8192];
            let count = stream.read(&mut buffer).expect("read provider request");
            request_tx
                .send(String::from_utf8_lossy(&buffer[..count]).to_string())
                .expect("send captured request");
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write provider response");
        });
        (format!("http://{addr}"), request_rx)
    }
}

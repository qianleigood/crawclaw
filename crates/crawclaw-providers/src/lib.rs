use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTransport {
    pub id: &'static str,
    pub transport: &'static str,
    pub capabilities: ProviderTransportCapabilities,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTransportCapabilities {
    pub streaming: bool,
    pub tool_calling: bool,
    pub multimodal: bool,
    pub secret_ref: ProviderSecretRefCapabilities,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretRefCapabilities {
    pub env: bool,
    pub file: bool,
    pub exec: bool,
}

const RUST_PROVIDER_CAPABILITIES: ProviderTransportCapabilities = ProviderTransportCapabilities {
    streaming: true,
    tool_calling: true,
    multimodal: true,
    secret_ref: ProviderSecretRefCapabilities {
        env: true,
        file: true,
        exec: false,
    },
};

pub const NATIVE_PROVIDER_TRANSPORTS: &[ProviderTransport] = &[
    ProviderTransport {
        id: "anthropic",
        transport: "anthropic-messages",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "azure-openai",
        transport: "azure-openai-responses",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "bedrock",
        transport: "bedrock-converse-stream",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "github-copilot",
        transport: "github-copilot",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "google",
        transport: "google-generative-ai",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "ollama",
        transport: "ollama",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "openai",
        transport: "openai-responses",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "openai-codex",
        transport: "openai-codex-responses",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
    ProviderTransport {
        id: "openai-compatible",
        transport: "openai-completions",
        capabilities: RUST_PROVIDER_CAPABILITIES,
    },
];

pub fn native_provider_transports() -> Vec<ProviderTransport> {
    NATIVE_PROVIDER_TRANSPORTS.to_vec()
}

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
    match config.provider.as_str() {
        "openai" | "openai-codex" => openai_responses_request(
            config,
            "https://api.openai.com/v1",
            "Authorization",
            "Bearer ",
            &messages,
            options,
        ),
        "azure-openai" => azure_openai_request(config, &messages, options),
        "anthropic" => anthropic_messages_request(config, &messages, options),
        "google" => google_generate_content_request(config, &messages, options),
        "ollama" => ollama_chat_request(config, &messages, options),
        "bedrock" => bedrock_converse_request(config, &messages, options),
        "github-copilot" => chat_completions_request(
            config,
            "https://api.githubcopilot.com",
            "Authorization",
            "Bearer ",
            &messages,
            options,
        ),
        "openai-compatible" => {
            chat_completions_request(config, "", "Authorization", "Bearer ", &messages, options)
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
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or(default_base_url)
        .trim_end_matches('/');
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "input": openai_responses_input(messages),
    });
    apply_openai_responses_options(&mut body, options);
    Ok(NativeProviderRequest {
        url: join_url_path(base_url, "responses"),
        headers: vec![auth_pair(
            auth_header,
            auth_prefix,
            required(&config.api_key, "apiKey")?,
        )],
        body,
        response_format: NativeProviderResponseFormat::OpenAiResponses,
    })
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
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.anthropic.com")
        .trim_end_matches('/');
    let mut body = json!({
        "model": required(&config.model, "model")?,
        "max_tokens": 1024,
        "messages": native_messages_for_anthropic(messages),
    });
    apply_anthropic_options(&mut body, options);
    Ok(NativeProviderRequest {
        url: join_url_path(base_url, "v1/messages"),
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
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://generativelanguage.googleapis.com/v1beta")
        .trim_end_matches('/');
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
    Ok(NativeProviderRequest {
        url,
        headers: vec![auth_pair(
            auth_header,
            auth_prefix,
            required(&config.api_key, "apiKey")?,
        )],
        body,
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
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(openai_responses_tool).collect());
        body["tool_choice"] = Value::String("auto".to_string());
    }
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
    fn native_provider_capability_matrix_covers_runtime_transport_features() {
        let transports = native_provider_transports();
        assert_eq!(transports.len(), native_provider_ids().len());

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
            let transport = transports
                .iter()
                .find(|transport| transport.id == provider)
                .unwrap_or_else(|| panic!("missing provider transport {provider}"));
            assert!(
                transport.capabilities.streaming,
                "{provider} should advertise streaming"
            );
            assert!(
                transport.capabilities.tool_calling,
                "{provider} should advertise tool calling"
            );
            assert!(
                transport.capabilities.multimodal,
                "{provider} should advertise multimodal input"
            );
            assert!(
                transport.capabilities.secret_ref.env && transport.capabilities.secret_ref.file,
                "{provider} should advertise env/file SecretRef support"
            );
            assert!(
                !transport.capabilities.secret_ref.exec,
                "{provider} should not advertise exec SecretRef support"
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
    fn builds_streaming_tool_and_multimodal_requests_for_native_transports() {
        let tool = NativeProviderTool {
            name: "lookup_weather".to_string(),
            description: Some("Look up weather".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "city": { "type": "string" }
                },
                "required": ["city"]
            }),
        };
        let messages = vec![NativeProviderMessage::user_blocks(vec![
            NativeProviderContentBlock::text("describe this image"),
            NativeProviderContentBlock::image_base64("image/png", "iVBORw0KGgo="),
        ])];

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
            let request = build_native_provider_conversation_request_with_options(
                &NativeProviderConfig {
                    provider: provider.to_string(),
                    base_url: Some(format!("https://example.test/{provider}")),
                    api_key: Some("secret".to_string()),
                    model: Some("model-a".to_string()),
                    api_version: Some("2025-04-01-preview".to_string()),
                },
                &messages,
                &NativeProviderRequestOptions {
                    stream: true,
                    tools: vec![tool.clone()],
                },
            )
            .unwrap_or_else(|error| panic!("{provider} request should build: {error}"));
            let body = serde_json::to_string(&request.body).expect("request body json");

            assert!(
                body.contains("lookup_weather"),
                "{provider} should include tool declarations"
            );
            assert!(
                body.contains("describe this image") && body.contains("iVBORw0KGgo="),
                "{provider} should include text and image content"
            );
            assert!(
                body.contains("stream") || request.url.contains("stream"),
                "{provider} should opt into streaming at the transport layer"
            );
        }
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

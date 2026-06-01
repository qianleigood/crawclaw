use std::collections::BTreeMap;
use std::fmt;
use std::net::IpAddr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::*;

mod adapters;

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
    Tool,
}

impl NativeProviderMessageRole {
    fn as_chat_role(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
        }
    }

    fn as_google_role(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "model",
            Self::Tool => "user",
        }
    }

    fn as_anthropic_role(self) -> &'static str {
        match self {
            Self::User | Self::Tool => "user",
            Self::Assistant => "assistant",
        }
    }

    fn as_bedrock_role(self) -> &'static str {
        match self {
            Self::User | Self::Tool => "user",
            Self::Assistant => "assistant",
        }
    }

    fn as_openai_responses_message_role(self) -> &'static str {
        match self {
            Self::User | Self::Tool => "user",
            Self::Assistant => "assistant",
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
    Text {
        text: String,
    },
    Image {
        mime_type: String,
        data: String,
    },
    ToolCall {
        id: String,
        name: String,
        arguments: Value,
    },
    ToolResult {
        tool_call_id: String,
        name: Option<String>,
        content: String,
        is_error: bool,
    },
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

    pub fn tool_call(id: impl Into<String>, name: impl Into<String>, arguments: Value) -> Self {
        Self::ToolCall {
            id: id.into(),
            name: name.into(),
            arguments,
        }
    }

    pub fn tool_result(
        tool_call_id: impl Into<String>,
        name: Option<String>,
        content: impl Into<String>,
        is_error: bool,
    ) -> Self {
        Self::ToolResult {
            tool_call_id: tool_call_id.into(),
            name,
            content: content.into(),
            is_error,
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

    pub fn tool_result(
        tool_call_id: impl Into<String>,
        name: Option<String>,
        content: impl Into<String>,
        is_error: bool,
    ) -> Self {
        let content = content.into();
        Self {
            role: NativeProviderMessageRole::Tool,
            content: content.clone(),
            blocks: vec![NativeProviderContentBlock::tool_result(
                tool_call_id,
                name,
                content,
                is_error,
            )],
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
    pub system_prompt: Option<String>,
    pub max_output_tokens: Option<usize>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeProviderTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NativeProviderAssistantResponse {
    pub text: String,
    pub tool_calls: Vec<NativeProviderToolCall>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct NativeProviderToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
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
    let response =
        send_native_provider_conversation_response_with_options(config, messages, options).await?;
    if response.text.trim().is_empty() {
        return Err(ProviderTransportError::InvalidResponse(
            "provider response did not include assistant content".to_string(),
        ));
    }
    Ok(response.text)
}

pub async fn send_native_provider_conversation_response_with_options(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderAssistantResponse, ProviderTransportError> {
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
        return parse_native_provider_stream_assistant_response(request.response_format, &body);
    }

    let body = response
        .json::<Value>()
        .await
        .map_err(|error| ProviderTransportError::InvalidResponse(error.to_string()))?;
    parse_native_provider_assistant_response(request.response_format, body)
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
    adapters::build_request(transport, config, &messages, options)
}

pub(crate) fn is_implemented_native_provider_transport(transport: ProviderTransportKind) -> bool {
    adapters::is_implemented(transport)
}

pub fn parse_native_provider_response(
    format: NativeProviderResponseFormat,
    body: Value,
) -> Result<String, ProviderTransportError> {
    let response = parse_native_provider_assistant_response(format, body)?;
    if response.text.trim().is_empty() {
        return Err(ProviderTransportError::InvalidResponse(
            "provider response did not include assistant content".to_string(),
        ));
    }
    Ok(response.text)
}

pub fn parse_native_provider_assistant_response(
    format: NativeProviderResponseFormat,
    body: Value,
) -> Result<NativeProviderAssistantResponse, ProviderTransportError> {
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
    let text = text.unwrap_or_default();
    let tool_calls = native_provider_tool_calls(format, &body);
    if text.trim().is_empty() && tool_calls.is_empty() {
        return Err(ProviderTransportError::InvalidResponse(
            "provider response did not include assistant content".to_string(),
        ));
    }
    Ok(NativeProviderAssistantResponse { text, tool_calls })
}

pub fn parse_native_provider_stream_delta(
    format: NativeProviderResponseFormat,
    chunk: &str,
) -> Result<Option<String>, ProviderTransportError> {
    let Some(body) = stream_chunk_json(chunk)? else {
        return Ok(None);
    };
    Ok(parse_native_provider_stream_delta_from_json(format, &body))
}

fn parse_native_provider_stream_delta_from_json(
    format: NativeProviderResponseFormat,
    body: &Value,
) -> Option<String> {
    let text = match format {
        NativeProviderResponseFormat::OpenAiResponses => body
            .get("type")
            .and_then(Value::as_str)
            .filter(|event_type| *event_type == "response.output_text.delta")
            .and_then(|_| body.get("delta"))
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
    text.filter(|text| !text.trim().is_empty())
}

pub fn parse_native_provider_stream_response(
    format: NativeProviderResponseFormat,
    body: &str,
) -> Result<String, ProviderTransportError> {
    let response = parse_native_provider_stream_assistant_response(format, body)?;
    if response.text.trim().is_empty() {
        return Err(ProviderTransportError::InvalidResponse(
            "provider stream did not include assistant content".to_string(),
        ));
    }
    Ok(response.text)
}

pub fn parse_native_provider_stream_assistant_response(
    format: NativeProviderResponseFormat,
    body: &str,
) -> Result<NativeProviderAssistantResponse, ProviderTransportError> {
    let mut text = String::new();
    let mut tool_call_builder = NativeProviderToolCallBuilder::default();
    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.starts_with(':') || line.starts_with("event:") || line.starts_with("id:") {
            continue;
        }
        let Some(chunk) = stream_chunk_json(line)? else {
            continue;
        };
        if let Some(delta) = parse_native_provider_stream_delta_from_json(format, &chunk) {
            text.push_str(&delta);
        }
        tool_call_builder.apply_stream_chunk(format, &chunk);
    }
    let tool_calls = tool_call_builder.finish();
    if text.trim().is_empty() && tool_calls.is_empty() {
        return Err(ProviderTransportError::InvalidResponse(
            "provider stream did not include assistant content".to_string(),
        ));
    }
    Ok(NativeProviderAssistantResponse { text, tool_calls })
}

fn native_provider_tool_calls(
    format: NativeProviderResponseFormat,
    body: &Value,
) -> Vec<NativeProviderToolCall> {
    match format {
        NativeProviderResponseFormat::OpenAiResponses => openai_responses_tool_calls(body),
        NativeProviderResponseFormat::ChatCompletions => openai_chat_tool_calls(body),
        NativeProviderResponseFormat::AnthropicMessages => anthropic_tool_calls(body),
        NativeProviderResponseFormat::GoogleGenerateContent => google_tool_calls(body),
        NativeProviderResponseFormat::OllamaChat => ollama_tool_calls(body),
        NativeProviderResponseFormat::BedrockConverse => bedrock_tool_calls(body),
    }
}

#[derive(Default)]
struct NativeProviderToolCallBuilder {
    calls: BTreeMap<usize, PartialNativeProviderToolCall>,
}

#[derive(Default)]
struct PartialNativeProviderToolCall {
    item_id: Option<String>,
    id: Option<String>,
    name: Option<String>,
    arguments: String,
}

impl NativeProviderToolCallBuilder {
    fn apply_stream_chunk(&mut self, format: NativeProviderResponseFormat, body: &Value) {
        match format {
            NativeProviderResponseFormat::OpenAiResponses => {
                self.apply_openai_responses_stream_chunk(body);
            }
            NativeProviderResponseFormat::ChatCompletions => {
                self.apply_openai_chat_stream_chunk(body);
            }
            NativeProviderResponseFormat::AnthropicMessages => {
                self.apply_anthropic_stream_chunk(body);
            }
            NativeProviderResponseFormat::GoogleGenerateContent
            | NativeProviderResponseFormat::OllamaChat
            | NativeProviderResponseFormat::BedrockConverse => {
                for (index, tool_call) in native_provider_tool_calls(format, body)
                    .into_iter()
                    .enumerate()
                {
                    let entry = self.calls.entry(index).or_default();
                    entry.id = Some(tool_call.id);
                    entry.name = Some(tool_call.name);
                    entry.arguments = tool_call.arguments.to_string();
                }
            }
        }
    }

    fn apply_openai_responses_stream_chunk(&mut self, body: &Value) {
        match body.get("type").and_then(Value::as_str) {
            Some("response.output_item.added") => {
                let Some(item) = body.get("item") else {
                    return;
                };
                if item.get("type").and_then(Value::as_str) != Some("function_call") {
                    return;
                }
                let index = self.openai_responses_stream_index(body);
                let entry = self.calls.entry(index).or_default();
                if let Some(item_id) = non_empty(item.get("id").and_then(Value::as_str)) {
                    entry.item_id = Some(item_id.to_string());
                }
                if let Some(call_id) = non_empty(item.get("call_id").and_then(Value::as_str)) {
                    entry.id = Some(call_id.to_string());
                } else if let Some(item_id) = entry.item_id.clone() {
                    entry.id.get_or_insert(item_id);
                }
                if let Some(name) = non_empty(item.get("name").and_then(Value::as_str)) {
                    entry.name = Some(name.to_string());
                }
                if let Some(arguments) = item.get("arguments").and_then(Value::as_str) {
                    entry.arguments.push_str(arguments);
                }
            }
            Some("response.function_call_arguments.delta") => {
                let index = self.openai_responses_stream_index(body);
                if let Some(delta) = body.get("delta").and_then(Value::as_str) {
                    self.calls
                        .entry(index)
                        .or_default()
                        .arguments
                        .push_str(delta);
                }
            }
            Some("response.function_call_arguments.done") => {
                let index = self.openai_responses_stream_index(body);
                let entry = self.calls.entry(index).or_default();
                if let Some(item_id) = non_empty(body.get("item_id").and_then(Value::as_str)) {
                    entry.item_id.get_or_insert_with(|| item_id.to_string());
                }
                if let Some(call_id) = non_empty(body.get("call_id").and_then(Value::as_str)) {
                    entry.id = Some(call_id.to_string());
                } else if let Some(item_id) = entry.item_id.clone() {
                    entry.id.get_or_insert(item_id);
                }
                if let Some(name) = non_empty(body.get("name").and_then(Value::as_str)) {
                    entry.name = Some(name.to_string());
                }
                if let Some(arguments) = body.get("arguments").and_then(Value::as_str) {
                    entry.arguments = arguments.to_string();
                }
            }
            _ => {
                for (index, tool_call) in openai_responses_tool_calls(body).into_iter().enumerate()
                {
                    let entry = self.calls.entry(index).or_default();
                    entry.id = Some(tool_call.id);
                    entry.name = Some(tool_call.name);
                    entry.arguments = tool_call.arguments.to_string();
                }
            }
        }
    }

    fn openai_responses_stream_index(&self, body: &Value) -> usize {
        if let Some(index) = body
            .get("output_index")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
        {
            return index;
        }
        if let Some(item_id) = body.get("item_id").and_then(Value::as_str) {
            if let Some((index, _)) = self
                .calls
                .iter()
                .find(|(_, partial)| partial.item_id.as_deref() == Some(item_id))
            {
                return *index;
            }
        }
        self.calls.len()
    }

    fn apply_openai_chat_stream_chunk(&mut self, body: &Value) {
        let Some(choices) = body.get("choices").and_then(Value::as_array) else {
            return;
        };
        for choice in choices {
            let Some(tool_calls) = choice
                .get("delta")
                .and_then(|delta| delta.get("tool_calls"))
                .and_then(Value::as_array)
            else {
                continue;
            };
            for tool_call in tool_calls {
                let index = tool_call
                    .get("index")
                    .and_then(Value::as_u64)
                    .and_then(|value| usize::try_from(value).ok())
                    .unwrap_or(self.calls.len());
                let entry = self.calls.entry(index).or_default();
                if let Some(id) = non_empty(tool_call.get("id").and_then(Value::as_str)) {
                    entry.id = Some(id.to_string());
                }
                if let Some(name) = tool_call
                    .get("function")
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                    .and_then(|name| non_empty(Some(name)))
                {
                    entry.name = Some(name.to_string());
                }
                if let Some(arguments) = tool_call
                    .get("function")
                    .and_then(|function| function.get("arguments"))
                    .and_then(Value::as_str)
                {
                    entry.arguments.push_str(arguments);
                }
            }
        }
    }

    fn apply_anthropic_stream_chunk(&mut self, body: &Value) {
        let index = body
            .get("index")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .unwrap_or(self.calls.len());
        match body.get("type").and_then(Value::as_str) {
            Some("content_block_start") => {
                let Some(block) = body.get("content_block") else {
                    return;
                };
                if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                    return;
                }
                let entry = self.calls.entry(index).or_default();
                if let Some(id) = non_empty(block.get("id").and_then(Value::as_str)) {
                    entry.id = Some(id.to_string());
                }
                if let Some(name) = non_empty(block.get("name").and_then(Value::as_str)) {
                    entry.name = Some(name.to_string());
                }
            }
            Some("content_block_delta") => {
                let Some(delta) = body.get("delta") else {
                    return;
                };
                if delta.get("type").and_then(Value::as_str) != Some("input_json_delta") {
                    return;
                }
                if let Some(partial) = delta.get("partial_json").and_then(Value::as_str) {
                    self.calls
                        .entry(index)
                        .or_default()
                        .arguments
                        .push_str(partial);
                }
            }
            _ => {}
        }
    }

    fn finish(self) -> Vec<NativeProviderToolCall> {
        self.calls
            .into_iter()
            .filter_map(|(index, partial)| {
                let name = partial.name?;
                Some(NativeProviderToolCall {
                    id: partial.id.unwrap_or_else(|| format!("call_{index}")),
                    name,
                    arguments: parse_tool_arguments(&partial.arguments),
                })
            })
            .collect()
    }
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
    if let Some(system_prompt) = normalized_system_prompt(options) {
        body["instructions"] = Value::String(system_prompt.to_string());
    }
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
    if let Some(system_prompt) = normalized_system_prompt(options) {
        body["instructions"] = Value::String(system_prompt.to_string());
    }
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
        "max_tokens": options.max_output_tokens.unwrap_or(1024),
        "messages": native_messages_for_anthropic(messages),
    });
    if let Some(system_prompt) = normalized_system_prompt(options) {
        body["system"] = Value::String(system_prompt.to_string());
    }
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
    if let Some(system_prompt) = normalized_system_prompt(options) {
        body["systemInstruction"] = json!({
            "parts": [{ "text": system_prompt }]
        });
    }
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
        "messages": native_messages_for_ollama_with_system(messages, options),
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
    if let Some(system_prompt) = normalized_system_prompt(options) {
        body["system"] = json!([{ "text": system_prompt }]);
    }
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
        "messages": native_messages_for_chat_with_system(messages, options),
        "stream": options.stream,
    });
    apply_chat_completions_options(&mut body, options);
    let mut headers = Vec::new();
    if let Some(api_key) = non_empty(config.api_key.as_deref()) {
        headers.push(auth_pair(auth_header, auth_prefix, api_key.to_string()));
    } else if config.provider != "openai-compatible" {
        required(&config.api_key, "apiKey")?;
    }
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
            NativeProviderContentBlock::ToolCall {
                id,
                name,
                arguments,
            } => {
                let id = non_empty(Some(id.as_str()))?;
                let name = non_empty(Some(name.as_str()))?;
                Some(NativeProviderContentBlock::tool_call(
                    id.to_string(),
                    name.to_string(),
                    arguments.clone(),
                ))
            }
            NativeProviderContentBlock::ToolResult {
                tool_call_id,
                name,
                content,
                is_error,
            } => {
                let tool_call_id = non_empty(Some(tool_call_id.as_str()))?;
                let content = non_empty(Some(content.as_str()))?;
                Some(NativeProviderContentBlock::tool_result(
                    tool_call_id.to_string(),
                    name.clone(),
                    content.to_string(),
                    *is_error,
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
            NativeProviderContentBlock::ToolCall { .. } => None,
            NativeProviderContentBlock::ToolResult { content, .. } => {
                non_empty(Some(content.as_str()))
            }
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
            .flat_map(openai_responses_input_items)
            .collect(),
    )
}

fn openai_responses_input_items(message: &NativeProviderMessage) -> Vec<Value> {
    let mut items = Vec::new();
    let mut message_blocks = Vec::new();
    for block in native_message_blocks(message) {
        match block {
            NativeProviderContentBlock::ToolCall {
                id,
                name,
                arguments,
            } => {
                push_openai_responses_message_item(message, &mut message_blocks, &mut items);
                items.push(json!({
                    "type": "function_call",
                    "call_id": id,
                    "name": name,
                    "arguments": arguments.to_string()
                }));
            }
            NativeProviderContentBlock::ToolResult {
                tool_call_id,
                content,
                ..
            } => {
                push_openai_responses_message_item(message, &mut message_blocks, &mut items);
                items.push(json!({
                    "type": "function_call_output",
                    "call_id": tool_call_id,
                    "output": content
                }));
            }
            NativeProviderContentBlock::Text { .. } | NativeProviderContentBlock::Image { .. } => {
                message_blocks.push(block);
            }
        }
    }
    push_openai_responses_message_item(message, &mut message_blocks, &mut items);
    items
}

fn push_openai_responses_message_item(
    message: &NativeProviderMessage,
    blocks: &mut Vec<NativeProviderContentBlock>,
    items: &mut Vec<Value>,
) {
    if blocks.is_empty() {
        return;
    }
    let content = openai_responses_content(&std::mem::take(blocks));
    items.push(json!({
        "role": message.role.as_openai_responses_message_role(),
        "content": content,
    }));
}

fn openai_responses_content(blocks: &[NativeProviderContentBlock]) -> Value {
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
                NativeProviderContentBlock::ToolCall { .. }
                | NativeProviderContentBlock::ToolResult { .. } => {
                    json!({
                        "type": "input_text",
                        "text": native_content_blocks_text(std::slice::from_ref(block))
                    })
                }
            })
            .collect(),
    )
}

fn native_messages_for_chat(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages.iter().map(chat_message).collect()
}

fn native_messages_for_chat_with_system(
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Vec<Value> {
    let mut values = Vec::new();
    if let Some(system_prompt) = normalized_system_prompt(options) {
        values.push(json!({
            "role": "system",
            "content": system_prompt,
        }));
    }
    values.extend(native_messages_for_chat(messages));
    values
}

fn native_messages_for_anthropic(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_anthropic_role(),
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
                "role": message.role.as_bedrock_role(),
                "content": bedrock_content(message),
            })
        })
        .collect()
}

fn native_messages_for_ollama(messages: &[NativeProviderMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| {
            if has_tool_calls(message) || message.role == NativeProviderMessageRole::Tool {
                return chat_message(message);
            }
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
                    NativeProviderContentBlock::Text { .. }
                    | NativeProviderContentBlock::ToolCall { .. }
                    | NativeProviderContentBlock::ToolResult { .. } => None,
                })
                .collect::<Vec<_>>();
            if !images.is_empty() {
                value["images"] = Value::Array(images);
            }
            value
        })
        .collect()
}

fn native_messages_for_ollama_with_system(
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Vec<Value> {
    let mut values = Vec::new();
    if let Some(system_prompt) = normalized_system_prompt(options) {
        values.push(json!({
            "role": "system",
            "content": system_prompt,
        }));
    }
    values.extend(native_messages_for_ollama(messages));
    values
}

fn normalized_system_prompt(options: &NativeProviderRequestOptions) -> Option<&str> {
    options
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn native_message_blocks(message: &NativeProviderMessage) -> Vec<NativeProviderContentBlock> {
    if !message.blocks.is_empty() {
        return message.blocks.clone();
    }
    vec![NativeProviderContentBlock::text(message.content.clone())]
}

struct NativeProviderToolResultRef {
    tool_call_id: String,
    name: Option<String>,
    content: String,
}

fn first_tool_result(message: &NativeProviderMessage) -> Option<NativeProviderToolResultRef> {
    native_message_blocks(message)
        .into_iter()
        .find_map(|block| {
            if let NativeProviderContentBlock::ToolResult {
                tool_call_id,
                name,
                content,
                ..
            } = block
            {
                Some(NativeProviderToolResultRef {
                    tool_call_id,
                    name,
                    content,
                })
            } else {
                None
            }
        })
}

fn tool_call_blocks(message: &NativeProviderMessage) -> Vec<NativeProviderToolCall> {
    native_message_blocks(message)
        .into_iter()
        .filter_map(|block| {
            if let NativeProviderContentBlock::ToolCall {
                id,
                name,
                arguments,
            } = block
            {
                Some(NativeProviderToolCall {
                    id,
                    name,
                    arguments,
                })
            } else {
                None
            }
        })
        .collect()
}

fn has_tool_calls(message: &NativeProviderMessage) -> bool {
    native_message_blocks(message)
        .into_iter()
        .any(|block| matches!(block, NativeProviderContentBlock::ToolCall { .. }))
}

fn text_and_image_blocks(message: &NativeProviderMessage) -> Vec<NativeProviderContentBlock> {
    native_message_blocks(message)
        .into_iter()
        .filter(|block| {
            matches!(
                block,
                NativeProviderContentBlock::Text { .. } | NativeProviderContentBlock::Image { .. }
            )
        })
        .collect()
}

fn chat_message(message: &NativeProviderMessage) -> Value {
    if let Some(tool_result) = first_tool_result(message) {
        let mut value = json!({
            "role": "tool",
            "tool_call_id": tool_result.tool_call_id,
            "content": tool_result.content,
        });
        if let Some(name) = tool_result.name {
            value["name"] = Value::String(name);
        }
        return value;
    }

    let tool_calls = tool_call_blocks(message)
        .into_iter()
        .map(|tool_call| {
            json!({
                "id": tool_call.id,
                "type": "function",
                "function": {
                    "name": tool_call.name,
                    "arguments": tool_call.arguments.to_string()
                }
            })
        })
        .collect::<Vec<_>>();
    if !tool_calls.is_empty() {
        let mut value = json!({
            "role": "assistant",
            "tool_calls": tool_calls,
        });
        let text = native_content_blocks_text(&text_and_image_blocks(message));
        value["content"] = if text.trim().is_empty() {
            Value::Null
        } else {
            Value::String(text)
        };
        return value;
    }

    json!({
        "role": message.role.as_chat_role(),
        "content": chat_content(message),
    })
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
                NativeProviderContentBlock::ToolCall { .. }
                | NativeProviderContentBlock::ToolResult { .. } => json!({
                    "type": "text",
                    "text": native_content_blocks_text(&[block.clone()])
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
                NativeProviderContentBlock::ToolCall {
                    id,
                    name,
                    arguments,
                } => json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": arguments
                }),
                NativeProviderContentBlock::ToolResult {
                    tool_call_id,
                    content,
                    is_error,
                    ..
                } => json!({
                    "type": "tool_result",
                    "tool_use_id": tool_call_id,
                    "content": content,
                    "is_error": is_error
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
            NativeProviderContentBlock::ToolCall {
                name, arguments, ..
            } => json!({
                "functionCall": {
                    "name": name,
                    "args": arguments
                }
            }),
            NativeProviderContentBlock::ToolResult { name, content, .. } => json!({
                "functionResponse": {
                    "name": name.as_deref().unwrap_or("tool"),
                    "response": {
                        "content": content
                    }
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
            NativeProviderContentBlock::ToolCall {
                id,
                name,
                arguments,
            } => json!({
                "toolUse": {
                    "toolUseId": id,
                    "name": name,
                    "input": arguments
                }
            }),
            NativeProviderContentBlock::ToolResult {
                tool_call_id,
                content,
                is_error,
                ..
            } => json!({
                "toolResult": {
                    "toolUseId": tool_call_id,
                    "status": if *is_error { "error" } else { "success" },
                    "content": [{ "text": content }]
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
    if let Some(max_output_tokens) = positive_max_output_tokens(options) {
        body["max_output_tokens"] = json!(max_output_tokens);
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
    if let Some(max_output_tokens) = positive_max_output_tokens(options) {
        body["max_tokens"] = json!(max_output_tokens);
    }
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
    if let Some(max_output_tokens) = positive_max_output_tokens(options) {
        let generation_config = body
            .as_object_mut()
            .expect("google request body object")
            .entry("generationConfig")
            .or_insert_with(|| json!({}));
        generation_config["maxOutputTokens"] = json!(max_output_tokens);
    }
    if !options.tools.is_empty() {
        body["tools"] = json!([{
            "functionDeclarations": options.tools.iter().map(google_tool).collect::<Vec<_>>()
        }]);
    }
}

fn apply_ollama_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if let Some(max_output_tokens) = positive_max_output_tokens(options) {
        let ollama_options = body
            .as_object_mut()
            .expect("ollama request body object")
            .entry("options")
            .or_insert_with(|| json!({}));
        ollama_options["num_predict"] = json!(max_output_tokens);
    }
    if !options.tools.is_empty() {
        body["tools"] = Value::Array(options.tools.iter().map(openai_chat_tool).collect());
    }
}

fn apply_bedrock_options(body: &mut Value, options: &NativeProviderRequestOptions) {
    if let Some(max_output_tokens) = positive_max_output_tokens(options) {
        let inference_config = body
            .as_object_mut()
            .expect("bedrock request body object")
            .entry("inferenceConfig")
            .or_insert_with(|| json!({}));
        inference_config["maxTokens"] = json!(max_output_tokens);
    }
    if !options.tools.is_empty() {
        body["toolConfig"] = json!({
            "tools": options.tools.iter().map(bedrock_tool).collect::<Vec<_>>()
        });
    }
}

fn positive_max_output_tokens(options: &NativeProviderRequestOptions) -> Option<usize> {
    options.max_output_tokens.filter(|value| *value > 0)
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

fn openai_responses_tool_calls(body: &Value) -> Vec<NativeProviderToolCall> {
    body.get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let item_type = item.get("type").and_then(Value::as_str)?;
            if item_type != "function_call" {
                return None;
            }
            let name = non_empty(item.get("name").and_then(Value::as_str))?.to_string();
            Some(NativeProviderToolCall {
                id: item
                    .get("call_id")
                    .or_else(|| item.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("call_0")
                    .to_string(),
                name,
                arguments: parse_tool_arguments(
                    item.get("arguments")
                        .and_then(Value::as_str)
                        .unwrap_or("{}"),
                ),
            })
        })
        .collect()
}

fn openai_chat_tool_calls(body: &Value) -> Vec<NativeProviderToolCall> {
    body.get("choices")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|choice| choice.get("message"))
        .flat_map(|message| {
            message
                .get("tool_calls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|tool_call| {
            let function = tool_call.get("function")?;
            let name = non_empty(function.get("name").and_then(Value::as_str))?.to_string();
            Some(NativeProviderToolCall {
                id: tool_call
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("call_0")
                    .to_string(),
                name,
                arguments: parse_tool_arguments(
                    function
                        .get("arguments")
                        .and_then(Value::as_str)
                        .unwrap_or("{}"),
                ),
            })
        })
        .collect()
}

fn anthropic_tool_calls(body: &Value) -> Vec<NativeProviderToolCall> {
    body.get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| {
            if part.get("type").and_then(Value::as_str) != Some("tool_use") {
                return None;
            }
            let name = non_empty(part.get("name").and_then(Value::as_str))?.to_string();
            Some(NativeProviderToolCall {
                id: part
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("toolu_0")
                    .to_string(),
                name,
                arguments: part.get("input").cloned().unwrap_or_else(|| json!({})),
            })
        })
        .collect()
}

fn google_tool_calls(body: &Value) -> Vec<NativeProviderToolCall> {
    body.get("candidates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|candidate| candidate.get("content"))
        .flat_map(|content| {
            content
                .get("parts")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|part| {
            let function_call = part.get("functionCall")?;
            let name = non_empty(function_call.get("name").and_then(Value::as_str))?.to_string();
            Some(NativeProviderToolCall {
                id: function_call
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("call_0")
                    .to_string(),
                name,
                arguments: function_call
                    .get("args")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            })
        })
        .collect()
}

fn ollama_tool_calls(body: &Value) -> Vec<NativeProviderToolCall> {
    body.get("message")
        .and_then(|message| message.get("tool_calls"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, tool_call)| {
            let function = tool_call.get("function")?;
            let name = non_empty(function.get("name").and_then(Value::as_str))?.to_string();
            Some(NativeProviderToolCall {
                id: tool_call
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("call_{index}")),
                name,
                arguments: function
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            })
        })
        .collect()
}

fn bedrock_tool_calls(body: &Value) -> Vec<NativeProviderToolCall> {
    body.get("output")
        .and_then(|output| output.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| {
            let tool_use = part.get("toolUse")?;
            let name = non_empty(tool_use.get("name").and_then(Value::as_str))?.to_string();
            Some(NativeProviderToolCall {
                id: tool_use
                    .get("toolUseId")
                    .and_then(Value::as_str)
                    .unwrap_or("tooluse_0")
                    .to_string(),
                name,
                arguments: tool_use.get("input").cloned().unwrap_or_else(|| json!({})),
            })
        })
        .collect()
}

fn parse_tool_arguments(raw: &str) -> Value {
    let raw = raw.trim();
    if raw.is_empty() {
        return json!({});
    }
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
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

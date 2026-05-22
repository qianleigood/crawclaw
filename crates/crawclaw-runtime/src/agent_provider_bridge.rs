use super::*;

pub(super) fn build_filtered_pi_agent_rust_tool_registry(
    runtime_root: &Path,
    enabled_tools: &[String],
) -> pi::sdk::ToolRegistry {
    let registry = build_pi_agent_rust_tool_registry(runtime_root);
    if enabled_tools.is_empty() {
        return registry;
    }
    let allowlist = enabled_tools
        .iter()
        .map(|tool| tool.trim())
        .filter(|tool| !tool.is_empty())
        .collect::<BTreeSet<_>>();
    if allowlist.is_empty() {
        return pi::sdk::ToolRegistry::from_tools(Vec::new());
    }
    pi::sdk::ToolRegistry::from_tools(
        registry
            .into_tools()
            .into_iter()
            .filter(|tool| allowlist.contains(tool.name()))
        .collect(),
    )
}

pub(super) fn build_pi_agent_rust_tool_registry_for_selection(
    runtime_root: &Path,
    selection: &AgentRuntimeToolSelection,
) -> pi::sdk::ToolRegistry {
    match selection {
        AgentRuntimeToolSelection::Default => build_pi_agent_rust_tool_registry(runtime_root),
        AgentRuntimeToolSelection::Disabled => pi::sdk::ToolRegistry::from_tools(Vec::new()),
        AgentRuntimeToolSelection::AllowList(enabled_tools) => {
            build_filtered_pi_agent_rust_tool_registry(runtime_root, enabled_tools)
        }
    }
}

#[derive(Clone)]
pub(super) struct CrawClawPiProvider {
    pub(super) config: NativeProviderConfig,
    pub(super) reasoning_level: Option<String>,
}

#[async_trait::async_trait]
impl pi::sdk::Provider for CrawClawPiProvider {
    fn name(&self) -> &str {
        &self.config.provider
    }

    fn api(&self) -> &str {
        &self.config.provider
    }

    fn model_id(&self) -> &str {
        self.config.model.as_deref().unwrap_or("")
    }

    async fn stream(
        &self,
        context: &pi::sdk::ProviderContext<'_>,
        _options: &pi::sdk::StreamOptions,
    ) -> pi::sdk::Result<
        Pin<Box<dyn futures::Stream<Item = pi::sdk::Result<pi::sdk::StreamEvent>> + Send>>,
    > {
        let messages = pi_messages_to_native_provider_messages(context.messages.as_ref());
        if messages.is_empty() {
            return Err(pi::sdk::Error::provider(
                self.name(),
                "missing provider conversation messages",
            ));
        }
        let options = NativeProviderRequestOptions {
            stream: true,
            reasoning_level: self.reasoning_level.clone(),
            tools: context
                .tools
                .iter()
                .map(|tool| NativeProviderTool {
                    name: tool.name.clone(),
                    description: Some(tool.description.clone()),
                    input_schema: tool.parameters.clone(),
                })
                .collect(),
        };
        let text =
            send_native_provider_conversation_with_options(&self.config, &messages, &options)
                .await
                .map_err(|error| pi::sdk::Error::provider(self.name(), error.to_string()))?;
        let message = pi_assistant_message(&self.config, text.clone());
        let mut partial = message.clone();
        partial.content.clear();
        let events = vec![
            Ok(pi::sdk::StreamEvent::Start { partial }),
            Ok(pi::sdk::StreamEvent::TextStart { content_index: 0 }),
            Ok(pi::sdk::StreamEvent::TextDelta {
                content_index: 0,
                delta: text.clone(),
            }),
            Ok(pi::sdk::StreamEvent::TextEnd {
                content_index: 0,
                content: text,
            }),
            Ok(pi::sdk::StreamEvent::Done {
                reason: pi::sdk::StopReason::Stop,
                message,
            }),
        ];
        Ok(Box::pin(futures::stream::iter(events)))
    }
}

pub(super) fn pi_user_content_text(content: &pi::sdk::UserContent) -> String {
    match content {
        pi::sdk::UserContent::Text(text) => text.clone(),
        pi::sdk::UserContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

pub(super) fn pi_user_content_blocks(
    content: &pi::sdk::UserContent,
) -> Vec<NativeProviderContentBlock> {
    match content {
        pi::sdk::UserContent::Text(text) => vec![NativeProviderContentBlock::text(text.clone())],
        pi::sdk::UserContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                pi::sdk::ContentBlock::Text(text) => {
                    Some(NativeProviderContentBlock::text(text.text.clone()))
                }
                pi::sdk::ContentBlock::Image(image) => {
                    Some(NativeProviderContentBlock::image_base64(
                        image.mime_type.clone(),
                        image.data.clone(),
                    ))
                }
                _ => None,
            })
            .collect(),
    }
}

pub(super) fn pi_assistant_content_text(content: &[pi::sdk::ContentBlock]) -> String {
    content
        .iter()
        .filter_map(|block| match block {
            pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn pi_messages_to_native_provider_messages(
    messages: &[pi::sdk::Message],
) -> Vec<NativeProviderMessage> {
    messages
        .iter()
        .filter_map(|message| match message {
            pi::sdk::Message::User(user) => Some(NativeProviderMessage {
                role: NativeProviderMessageRole::User,
                content: pi_user_content_text(&user.content),
                blocks: pi_user_content_blocks(&user.content),
            }),
            pi::sdk::Message::Assistant(assistant) => Some(NativeProviderMessage {
                role: NativeProviderMessageRole::Assistant,
                content: pi_assistant_content_text(&assistant.content),
                blocks: Vec::new(),
            }),
            _ => None,
        })
        .filter(|message| !message.content.trim().is_empty() || !message.blocks.is_empty())
        .collect()
}

pub(super) fn agent_history_with_user(
    history: &[AgentRuntimeMessage],
    user_text: &str,
) -> Vec<NativeProviderMessage> {
    let mut messages = history
        .iter()
        .filter_map(agent_message_to_native_provider_message)
        .collect::<Vec<_>>();
    messages.push(NativeProviderMessage::user(user_text));
    messages
}

pub(super) fn agent_message_to_native_provider_message(
    message: &AgentRuntimeMessage,
) -> Option<NativeProviderMessage> {
    let content = message.content.trim();
    if content.is_empty() {
        return None;
    }
    Some(NativeProviderMessage {
        role: match message.role {
            AgentRuntimeMessageRole::User => NativeProviderMessageRole::User,
            AgentRuntimeMessageRole::Assistant => NativeProviderMessageRole::Assistant,
        },
        content: content.to_string(),
        blocks: Vec::new(),
    })
}

pub(super) fn pi_session_from_history(history: &[AgentRuntimeMessage]) -> pi::sdk::Session {
    let mut session = pi::sdk::Session::in_memory();
    for message in history {
        match message.role {
            AgentRuntimeMessageRole::User => {
                session.append_model_message(pi::sdk::Message::User(pi::sdk::UserMessage {
                    content: pi::sdk::UserContent::Text(message.content.clone()),
                    timestamp: current_unix_millis(),
                }));
            }
            AgentRuntimeMessageRole::Assistant => {
                session.append_model_message(pi::sdk::Message::assistant(
                    pi::sdk::AssistantMessage {
                        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                            message.content.clone(),
                        ))],
                        api: String::new(),
                        provider: String::new(),
                        model: String::new(),
                        usage: pi::sdk::Usage::default(),
                        stop_reason: pi::sdk::StopReason::Stop,
                        error_message: None,
                        timestamp: current_unix_millis(),
                    },
                ));
            }
        }
    }
    session
}

pub(super) fn pi_assistant_message(
    config: &NativeProviderConfig,
    text: String,
) -> pi::sdk::AssistantMessage {
    pi::sdk::AssistantMessage {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(text))],
        api: config.provider.clone(),
        provider: config.provider.clone(),
        model: config.model.clone().unwrap_or_default(),
        usage: pi::sdk::Usage::default(),
        stop_reason: pi::sdk::StopReason::Stop,
        error_message: None,
        timestamp: current_unix_millis(),
    }
}

pub(super) fn current_unix_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

pub(super) fn map_pi_agent_error(error: pi::sdk::Error) -> AgentRuntimeError {
    AgentRuntimeError::ProviderFailed(format!("pi_agent_rust direct runtime failed: {error}"))
}

pub(super) fn pi_agent_assistant_text(
    assistant: &pi::sdk::AssistantMessage,
) -> Result<String, AgentRuntimeError> {
    let text = assistant
        .content
        .iter()
        .filter_map(|content| match content {
            pi::sdk::ContentBlock::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<String>();
    if text.trim().is_empty() {
        return Err(AgentRuntimeError::ProviderFailed(
            "pi_agent_rust direct runtime did not produce assistant text.".to_string(),
        ));
    }
    Ok(text)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopAgentProviderConfig {
    #[serde(default)]
    pub(super) runtime: DesktopAgentRuntimeMode,
    pub(super) provider: String,
    pub(super) base_url: Option<String>,
    pub(super) api_key: Option<Value>,
    pub(super) model: Option<String>,
    pub(super) api: Option<String>,
    pub(super) api_version: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(super) enum DesktopAgentRuntimeMode {
    PiAgentRust,
    NativeProvider,
}

impl Default for DesktopAgentRuntimeMode {
    fn default() -> Self {
        Self::PiAgentRust
    }
}

impl DesktopAgentProviderConfig {
    pub(super) fn runtime_mode(&self) -> DesktopAgentRuntimeMode {
        self.runtime
    }
}

impl ProviderResolver {
    pub(super) fn resolve_desktop_config(
        config: &DesktopAgentProviderConfig,
        runtime_root: &Path,
    ) -> Result<NativeProviderConfig, AgentRuntimeError> {
        if config.provider.trim().is_empty() {
            return Err(AgentRuntimeError::ProviderUnavailable(
                "Desktop agent provider config is missing provider.".to_string(),
            ));
        }
        let provider = config.provider.trim().to_string();
        ensure_native_chat_provider(&provider)?;
        let default_model = crawclaw_providers::bundled_provider_default_model_for(&provider)
            .map(|entry| entry.model.to_string());
        Ok(NativeProviderConfig {
            provider,
            base_url: optional_config_value(config.base_url.as_deref()),
            api_key: resolve_secret_input_string(runtime_root, config.api_key.as_ref(), "apiKey")?,
            model: optional_config_value(config.model.as_deref()).or(default_model),
            api: optional_config_value(config.api.as_deref()),
            api_version: optional_config_value(config.api_version.as_deref()),
        })
    }
}

pub(super) fn resolve_secret_input_string(
    runtime_root: &Path,
    value: Option<&Value>,
    field: &str,
) -> Result<Option<String>, AgentRuntimeError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if let Some(raw) = value.as_str() {
        return Ok(optional_config_value(Some(raw)));
    }
    let Some(object) = value.as_object() else {
        return Err(AgentRuntimeError::ProviderUnavailable(format!(
            "Desktop agent provider config {field} must be a string or SecretRef."
        )));
    };
    let source = object
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = object.get("id").and_then(Value::as_str).unwrap_or_default();
    match source {
        "env" => std::env::var(id)
            .map(|secret| optional_config_value(Some(&secret)))
            .map_err(|_| {
                AgentRuntimeError::ProviderUnavailable(format!(
                    "Environment variable {id} for desktop provider {field} is not set."
                ))
            }),
        "file" => {
            let path = PathBuf::from(id);
            let path = if path.is_absolute() {
                path
            } else {
                runtime_root.join(path)
            };
            fs::read_to_string(&path)
                .map(|secret| optional_config_value(Some(secret.trim_end())))
                .map_err(|error| {
                    AgentRuntimeError::ProviderUnavailable(format!(
                        "Failed to read file SecretRef {} for desktop provider {field}: {error}",
                        path.display()
                    ))
                })
        }
        "exec" => Err(AgentRuntimeError::ProviderUnavailable(format!(
            "Exec SecretRef resolution for desktop provider {field} is not enabled in the Rust runtime."
        ))),
        _ => Err(AgentRuntimeError::ProviderUnavailable(format!(
            "Unsupported SecretRef source {source} for desktop provider {field}."
        ))),
    }
}

pub(super) fn optional_config_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

use super::*;

const PROVIDER_RETRY_DELAYS_MS: &[u64] = &[500, 1_000, 2_000];

pub(super) async fn send_native_provider_conversation_response_with_retry(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderAssistantResponse, ProviderTransportError> {
    let mut attempt = 0usize;
    loop {
        match send_native_provider_conversation_response_with_options(config, messages, options)
            .await
        {
            Ok(response) => return Ok(response),
            Err(error)
                if attempt < PROVIDER_RETRY_DELAYS_MS.len()
                    && is_retryable_provider_error(&error) =>
            {
                let delay_ms = PROVIDER_RETRY_DELAYS_MS[attempt];
                attempt += 1;
                tracing::debug!(
                    provider = config.provider,
                    attempt,
                    delay_ms,
                    error = %error,
                    "native_provider_retry_scheduled"
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
            Err(error) => return Err(error),
        }
    }
}

fn is_retryable_provider_error(error: &ProviderTransportError) -> bool {
    match error {
        ProviderTransportError::Unsupported(_) => false,
        ProviderTransportError::InvalidResponse(message) => {
            is_retryable_provider_error_message(message)
        }
        ProviderTransportError::Unavailable(message) => {
            is_retryable_provider_error_message(message)
        }
    }
}

fn is_retryable_provider_error_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    [
        "http 429",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
        "http 529",
        "timeout",
        "timed out",
        "connection",
        "connect",
        "econnreset",
        "epipe",
        "network",
        "overload",
        "temporarily unavailable",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

pub(super) fn build_filtered_native_runtime_tool_registry(
    runtime_root: &Path,
    enabled_tools: &[String],
) -> pi::sdk::ToolRegistry {
    let registry = build_native_runtime_tool_registry(runtime_root);
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
            .filter(|tool| {
                allowlist
                    .iter()
                    .any(|rule| crate::core_tools::tool_name_matches_rule(tool.name(), rule))
            })
            .collect(),
    )
}

fn build_default_profile_tool_registry(runtime_root: &Path) -> pi::sdk::ToolRegistry {
    pi::sdk::ToolRegistry::from_tools(
        build_native_runtime_tool_registry(runtime_root)
            .into_tools()
            .into_iter()
            .filter(|tool| !is_special_agent_only_tool(tool.name()))
            .collect(),
    )
}

pub(super) fn build_native_runtime_tool_registry_for_selection(
    runtime_root: &Path,
    selection: &AgentRuntimeToolSelection,
    permission_policy: Option<AgentRuntimePermissionPolicy>,
    tool_hook_policy: Option<AgentRuntimeToolHookPolicy>,
) -> pi::sdk::ToolRegistry {
    let registry = match selection {
        AgentRuntimeToolSelection::Default => build_default_profile_tool_registry(runtime_root),
        AgentRuntimeToolSelection::Disabled => pi::sdk::ToolRegistry::from_tools(Vec::new()),
        AgentRuntimeToolSelection::AllowList(enabled_tools) => {
            build_filtered_native_runtime_tool_registry(runtime_root, enabled_tools)
        }
    };
    let registry = apply_permission_policy_to_registry(registry, permission_policy);
    apply_tool_hook_policy_to_registry(registry, tool_hook_policy)
}

pub(super) fn agent_messages_to_native_provider_messages(
    messages: &[AgentRuntimeMessage],
) -> Vec<NativeProviderMessage> {
    messages
        .iter()
        .filter_map(agent_message_to_native_provider_message)
        .collect()
}

pub(super) fn agent_message_to_native_provider_message(
    message: &AgentRuntimeMessage,
) -> Option<NativeProviderMessage> {
    let content = message.content.trim();
    let blocks = runtime_message_blocks_to_native_provider_blocks(message);
    if content.is_empty() && blocks.is_empty() {
        return None;
    }
    Some(NativeProviderMessage {
        role: match message.role {
            AgentRuntimeMessageRole::User => NativeProviderMessageRole::User,
            AgentRuntimeMessageRole::Assistant => NativeProviderMessageRole::Assistant,
        },
        content: content.to_string(),
        blocks,
    })
}

fn runtime_message_blocks_to_native_provider_blocks(
    message: &AgentRuntimeMessage,
) -> Vec<NativeProviderContentBlock> {
    message
        .blocks
        .iter()
        .filter_map(|block| match block {
            AgentRuntimeMessageBlock::Text { text } => {
                Some(NativeProviderContentBlock::text(text.clone()))
            }
            AgentRuntimeMessageBlock::Image { mime_type, data } => Some(
                NativeProviderContentBlock::image_base64(mime_type.clone(), data.clone()),
            ),
            AgentRuntimeMessageBlock::ToolUse { id, name, input } => Some(
                NativeProviderContentBlock::tool_call(id.clone(), name.clone(), input.clone()),
            ),
            AgentRuntimeMessageBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => Some(NativeProviderContentBlock::tool_result(
                tool_use_id.clone(),
                None,
                content.clone(),
                *is_error,
            )),
            AgentRuntimeMessageBlock::Meta { .. } => None,
        })
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DesktopAgentProviderConfig {
    #[serde(default, rename = "runtime")]
    pub(super) _runtime: DesktopAgentRuntimeMode,
    pub(super) provider: String,
    pub(super) base_url: Option<String>,
    pub(super) api_key: Option<Value>,
    pub(super) model: Option<String>,
    pub(super) api: Option<String>,
    pub(super) api_version: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(super) enum DesktopAgentRuntimeMode {
    #[default]
    NativeProvider,
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

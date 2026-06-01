use super::super::*;

mod anthropic_messages;
mod bedrock;
mod chat_completions;
mod google_generate_content;
mod ollama;
mod openai_responses;

pub(super) fn build_request(
    transport: ProviderTransportKind,
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    match transport {
        ProviderTransportKind::OpenAiResponses | ProviderTransportKind::OpenAiCodexResponses => {
            openai_responses::build(config, messages, options)
        }
        ProviderTransportKind::AzureOpenAiResponses => {
            openai_responses::build_azure(config, messages, options)
        }
        ProviderTransportKind::AnthropicMessages => {
            anthropic_messages::build(config, messages, options)
        }
        ProviderTransportKind::GoogleGenerativeAi => {
            google_generate_content::build(config, messages, options)
        }
        ProviderTransportKind::Ollama => ollama::build(config, messages, options),
        ProviderTransportKind::BedrockConverseStream => bedrock::build(config, messages, options),
        ProviderTransportKind::GithubCopilot => {
            chat_completions::build_github_copilot(config, messages, options)
        }
        ProviderTransportKind::OpenAiCompletions => {
            chat_completions::build_openai_compatible(config, messages, options)
        }
    }
}

pub(super) const fn is_implemented(_transport: ProviderTransportKind) -> bool {
    true
}

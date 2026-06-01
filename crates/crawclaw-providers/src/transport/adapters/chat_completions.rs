use super::super::*;

pub(super) fn build_github_copilot(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    chat_completions_request(
        config,
        "https://api.githubcopilot.com",
        "Authorization",
        "Bearer ",
        messages,
        options,
    )
}

pub(super) fn build_openai_compatible(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    chat_completions_request(config, "", "Authorization", "Bearer ", messages, options)
}

use super::super::*;

pub(super) fn build(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    openai_responses_request(
        config,
        if is_default_openai_provider(&config.provider) {
            "https://api.openai.com/v1"
        } else {
            ""
        },
        "Authorization",
        "Bearer ",
        messages,
        options,
    )
}

pub(super) fn build_azure(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    azure_openai_request(config, messages, options)
}

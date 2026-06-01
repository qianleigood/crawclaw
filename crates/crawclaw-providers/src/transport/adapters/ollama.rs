use super::super::*;

pub(super) fn build(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    ollama_chat_request(config, messages, options)
}

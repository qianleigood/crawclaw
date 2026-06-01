use super::super::*;

pub(super) fn build(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    anthropic_messages_request(config, messages, options)
}

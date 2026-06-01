use super::super::*;

pub(super) fn build(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    bedrock_converse_request(config, messages, options)
}

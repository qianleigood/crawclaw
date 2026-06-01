use super::super::*;

pub(super) fn build(
    config: &NativeProviderConfig,
    messages: &[NativeProviderMessage],
    options: &NativeProviderRequestOptions,
) -> Result<NativeProviderRequest, ProviderTransportError> {
    google_generate_content_request(config, messages, options)
}

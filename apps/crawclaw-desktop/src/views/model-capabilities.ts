import type { DesktopModelProfileSummary } from '../desktop-api'

type ModelProfileCapabilitySource = Pick<DesktopModelProfileSummary, 'modelRef' | 'provider' | 'model'>

export function modelSupportsConfigurableThinking(
  modelRef: string,
  modelProfiles: ModelProfileCapabilitySource[] = [],
) {
  const profile = modelProfiles.find((entry) => entry.modelRef === modelRef)
  const provider = profile?.provider ?? modelRefProvider(modelRef)
  const model = profile?.model ?? modelRefModel(modelRef)
  return providerModelSupportsConfigurableThinking(provider, model)
}

function modelRefProvider(modelRef: string) {
  const trimmed = modelRef.trim()
  const [provider, model] = trimmed.split('/', 2)
  if (provider && model) {
    return provider.trim()
  }
  return openAiResponsesReasoningModel(trimmed) ? 'openai' : ''
}

function modelRefModel(modelRef: string) {
  const trimmed = modelRef.trim()
  const [, model] = trimmed.split('/', 2)
  return model?.trim() || trimmed
}

function providerModelSupportsConfigurableThinking(provider: string, model: string) {
  const normalizedProvider = provider.trim().toLowerCase()
  const normalizedModel = model.trim()
  if (!normalizedModel) {
    return false
  }
  if (
    ['openai', 'openai-codex', 'microsoft-foundry'].includes(normalizedProvider)
    && openAiResponsesReasoningModel(normalizedModel)
  ) {
    return true
  }
  if (normalizedProvider === 'kilocode') {
    return normalizedModel !== 'kilo/auto' && !proxyReasoningUnsupported(normalizedModel)
  }
  if (normalizedProvider === 'openrouter') {
    return !proxyReasoningUnsupported(normalizedModel)
  }
  return false
}

function openAiResponsesReasoningModel(model: string) {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('gpt-5') || normalized.startsWith('o')
}

function proxyReasoningUnsupported(model: string) {
  return model.trim().toLowerCase().startsWith('x-ai/')
}

import type {
  AddAgentSkillInput,
  AddAttachmentMessageInput,
  AddMediaMessageInput,
  AddPluginSkillInput,
  AddSkillCallMessageInput,
  AddVoiceMessageInput,
  AddWorkflowMessageInput,
  ArchiveMemoryItemInput,
  AutomationRuntimeInstallInput,
  BootstrapResponse,
  CreateAgentInput,
  CreateMemoryItemInput,
  DesktopPreferences,
  DesktopSessionHistoryResponse,
  DesktopSessionMutationResponse,
  DesktopSessionsResponse,
  DesktopState,
  DesktopSubagentsResponse,
  MemoryFilter,
  ModelProfileSetupInput,
  PermissionStatus,
  PluginInstallInput,
  RuntimeStatus,
  SearchSuggestion,
  SendMessageInput,
  StartAgentGroupRunInput,
  UpdateAgentInput,
  UpdateMemoryItemPatch,
} from '../generated/desktop-api-contract.generated'
import {
  ensureDesktopApiContext,
  getCurrentDesktopApiContext,
  requestDesktop,
  requestDesktopState,
  resolveDesktopApiBaseUrl,
  setDesktopApiContext,
} from './desktop-transport'

export type DesktopPreferencesPatch = Omit<
  Partial<DesktopPreferences>,
  | 'advancedDefaults'
  | 'confirmationDefaults'
  | 'memoryDefaults'
  | 'notificationDefaults'
  | 'privacyDefaults'
  | 'taskDefaults'
  | 'uiDefaults'
  | 'modelProfiles'
> & {
  advancedDefaults?: Partial<DesktopPreferences['advancedDefaults']>
  confirmationDefaults?: Partial<DesktopPreferences['confirmationDefaults']>
  memoryDefaults?: Partial<DesktopPreferences['memoryDefaults']>
  notificationDefaults?: Partial<DesktopPreferences['notificationDefaults']>
  privacyDefaults?: Partial<DesktopPreferences['privacyDefaults']>
  taskDefaults?: Partial<DesktopPreferences['taskDefaults']>
  uiDefaults?: Partial<DesktopPreferences['uiDefaults']>
}

export async function loadBootstrap(): Promise<BootstrapResponse> {
  const baseUrl = await resolveDesktopApiBaseUrl()
  if (!baseUrl) {
    throw new Error('CrawClaw Desktop Gateway URL is not available.')
  }

  const response = await fetch(`${baseUrl}/api/desktop/bootstrap`)
  if (!response.ok) {
    throw new Error(`Unable to load /api/desktop/bootstrap: HTTP ${response.status}`)
  }

  const bootstrap = (await response.json()) as BootstrapResponse
  setDesktopApiContext({
    api: bootstrap.api,
    baseUrl,
  })
  return bootstrap
}

export async function loadDesktopState(): Promise<DesktopState> {
  const context = await ensureContext()
  return requestDesktopState(context, '/api/desktop/state')
}

export async function loadRuntimeStatus(): Promise<RuntimeStatus> {
  const context = await ensureContext()
  return requestDesktop<RuntimeStatus>(context, '/api/desktop/runtime')
}

export async function searchDesktop(query: string): Promise<SearchSuggestion[]> {
  const context = await ensureContext()
  const response = await requestDesktop<SearchSuggestion[]>(
    context,
    `/api/desktop/search?q=${encodeURIComponent(query)}`,
  )
  return response
}

export async function selectNav(navId: string): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/navigation/select', {
    body: { navId },
    method: 'POST',
  })
}

export async function selectThread(threadId: string): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/threads/select', {
    body: { threadId },
    method: 'POST',
  })
}

export async function pinThread(threadId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/threads/${encodeURIComponent(threadId)}/pin`, {
    method: 'POST',
  })
}

export async function unpinThread(threadId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/threads/${encodeURIComponent(threadId)}/unpin`, {
    method: 'POST',
  })
}

export async function renameThread(threadId: string, title: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/threads/${encodeURIComponent(threadId)}/rename`, {
    body: { title },
    method: 'PATCH',
  })
}

export async function archiveThread(threadId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/threads/${encodeURIComponent(threadId)}/archive`, {
    method: 'POST',
  })
}

export async function listSessions(): Promise<DesktopSessionsResponse> {
  const context = await ensureContext()
  return requestDesktop<DesktopSessionsResponse>(context, '/api/desktop/sessions')
}

export async function loadSessionHistory(threadId: string): Promise<DesktopSessionHistoryResponse> {
  const context = await ensureContext()
  return requestDesktop<DesktopSessionHistoryResponse>(
    context,
    `/api/desktop/sessions/${encodeURIComponent(threadId)}/history`,
  )
}

export async function spawnSession(input: {
  task: string
  label?: string
  parentSessionKey?: string
}): Promise<DesktopSessionMutationResponse> {
  const context = await ensureContext()
  return requestDesktop<DesktopSessionMutationResponse>(context, '/api/desktop/sessions/spawn', {
    body: JSON.stringify(input),
    method: 'POST',
  })
}

export async function sendSession(sessionKey: string, message: string): Promise<DesktopSessionMutationResponse> {
  const context = await ensureContext()
  return requestDesktop<DesktopSessionMutationResponse>(context, '/api/desktop/sessions/send', {
    body: JSON.stringify({ message, sessionKey }),
    method: 'POST',
  })
}

export async function yieldSession(sessionKey: string): Promise<DesktopSessionMutationResponse> {
  const context = await ensureContext()
  return requestDesktop<DesktopSessionMutationResponse>(context, '/api/desktop/sessions/yield', {
    body: JSON.stringify({ sessionKey }),
    method: 'POST',
  })
}

export async function listSubagents(parentSessionKey?: string): Promise<DesktopSubagentsResponse> {
  const context = await ensureContext()
  const query = parentSessionKey ? `?parentSessionKey=${encodeURIComponent(parentSessionKey)}` : ''
  return requestDesktop<DesktopSubagentsResponse>(context, `/api/desktop/subagents${query}`)
}

export async function sendMessage(text: string, options: { agentId?: string } = {}): Promise<DesktopState> {
  const body: SendMessageInput = {
    ...(options.agentId ? { agentId: options.agentId } : {}),
    text,
  }
  return mutateDesktopState('/api/desktop/messages', {
    body,
    method: 'POST',
  })
}

export async function startAgentGroupRun(input: StartAgentGroupRunInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/agent-groups/runs', {
    body: input,
    method: 'POST',
  })
}

export async function addAttachmentMessage(input: AddAttachmentMessageInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/attachments', {
    body: input,
    method: 'POST',
  })
}

export async function addMediaMessage(input: AddMediaMessageInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/media', {
    body: input,
    method: 'POST',
  })
}

export async function addVoiceMessage(input: AddVoiceMessageInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/voice', {
    body: input,
    method: 'POST',
  })
}

export async function addWorkflowMessage(input: AddWorkflowMessageInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/workflows', {
    body: input,
    method: 'POST',
  })
}

export async function refreshAutomationRuntime(runtimeId: string): Promise<DesktopState> {
  const context = await ensureContext()
  return requestDesktopState(
    context,
    `/api/desktop/automation/runtimes/${encodeURIComponent(runtimeId)}/status`,
  )
}

export async function installAutomationRuntime(
  runtimeId: string,
  input: AutomationRuntimeInstallInput = {},
): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/automation/runtimes/${encodeURIComponent(runtimeId)}/install`, {
    body: input,
    method: 'POST',
  })
}

export async function startAutomationRuntime(runtimeId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/automation/runtimes/${encodeURIComponent(runtimeId)}/start`, {
    method: 'POST',
  })
}

export async function stopAutomationRuntime(runtimeId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/automation/runtimes/${encodeURIComponent(runtimeId)}/stop`, {
    method: 'POST',
  })
}

export async function addSkillCallMessage(input: AddSkillCallMessageInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/skills', {
    body: input,
    method: 'POST',
  })
}

export async function abortMessage(): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/abort', {
    method: 'POST',
  })
}

export async function steerMessage(text: string, mode: 'restart' | 'followUp'): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/steer', {
    body: { mode, text },
    method: 'POST',
  })
}

export async function openDesktopAsset(assetId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/assets/${encodeURIComponent(assetId)}/open`, {
    method: 'POST',
  })
}

export async function revealDesktopAsset(assetId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/assets/${encodeURIComponent(assetId)}/reveal`, {
    method: 'POST',
  })
}

export function desktopAssetContentUrl(assetId: string): string | null {
  const context = getCurrentDesktopApiContext()
  if (!context) {
    return null
  }
  return `${context.baseUrl}/api/desktop/assets/${encodeURIComponent(assetId)}/content?sessionToken=${encodeURIComponent(context.api.sessionToken)}`
}

export async function decidePermission(requestId: string, decision: Exclude<PermissionStatus, 'pending'>): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/permissions/${encodeURIComponent(requestId)}/decision`, {
    body: { decision },
    method: 'POST',
  })
}

export async function updatePreferences(patch: DesktopPreferencesPatch): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/preferences', {
    body: patch,
    method: 'PATCH',
  })
}

export async function testAndSaveModelProfile(input: ModelProfileSetupInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/model-profiles/test-and-save', {
    body: input,
    method: 'POST',
  })
}

export async function generateDesktopDiagnostics(): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/settings/diagnostics', {
    method: 'POST',
  })
}

export async function exportDesktopData(): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/settings/export-data', {
    method: 'POST',
  })
}

export async function clearDesktopCache(): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/settings/clear-cache', {
    method: 'POST',
  })
}

export async function deleteDesktopLocalData(confirm: 'DELETE'): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/settings/delete-local-data', {
    body: { confirm },
    method: 'POST',
  })
}

export async function resetDesktopState(confirm: 'RESET'): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/settings/reset-state', {
    body: { confirm },
    method: 'POST',
  })
}

export async function togglePluginTool(toolId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/tools/${encodeURIComponent(toolId)}/toggle`, {
    method: 'POST',
  })
}

export async function setPluginToolEnabled(toolId: string, enabled: boolean): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/tools/${encodeURIComponent(toolId)}/enabled`, {
    body: { enabled },
    method: 'PATCH',
  })
}

export async function togglePluginSkill(skillId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/skills/${encodeURIComponent(skillId)}/toggle`, {
    method: 'POST',
  })
}

export async function setPluginSkillEnabled(skillId: string, enabled: boolean): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/skills/${encodeURIComponent(skillId)}/enabled`, {
    body: { enabled },
    method: 'PATCH',
  })
}

export async function invokePluginTool(pluginId: string, toolId: string, input: unknown = {}): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/${encodeURIComponent(pluginId)}/tools/${encodeURIComponent(toolId)}/invoke`, {
    body: { confirmed: true, input },
    method: 'POST',
  })
}

export async function installPlugin(input: PluginInstallInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/plugins/install', {
    body: input,
    method: 'POST',
  })
}

export async function uninstallPlugin(pluginId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/${encodeURIComponent(pluginId)}/uninstall`, {
    method: 'POST',
  })
}

export async function setInstalledPluginEnabled(pluginId: string, enabled: boolean): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/${encodeURIComponent(pluginId)}/enabled`, {
    body: { enabled },
    method: 'PATCH',
  })
}

export async function addPluginSkill(skill: AddPluginSkillInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/plugins/skills', {
    body: skill,
    method: 'POST',
  })
}

export async function removePluginSkill(skillId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/skills/${encodeURIComponent(skillId)}`, {
    body: {},
    method: 'DELETE',
  })
}

export async function selectAgent(agentId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/agents/${encodeURIComponent(agentId)}/select`, {
    method: 'POST',
  })
}

export async function createAgent(agent: CreateAgentInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/agents', {
    body: agent,
    method: 'POST',
  })
}

export async function updateAgent(agentId: string, patch: UpdateAgentInput): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/agents/${encodeURIComponent(agentId)}`, {
    body: patch,
    method: 'PATCH',
  })
}

export async function toggleAgentTool(agentId: string, toolId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolId)}/toggle`, {
    method: 'POST',
  })
}

export async function toggleAgentSkill(agentId: string, skillId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillId)}/toggle`, {
    method: 'POST',
  })
}

export async function addAgentSkill(agentId: string, skill: AddAgentSkillInput): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/agents/${encodeURIComponent(agentId)}/skills`, {
    body: skill,
    method: 'POST',
  })
}

export async function selectMemoryItem(itemId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/memory/items/${encodeURIComponent(itemId)}/select`, {
    method: 'POST',
  })
}

export async function selectMemoryAgent(agentId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/memory/agents/${encodeURIComponent(agentId)}/select`, {
    method: 'POST',
  })
}

export async function setMemoryQuery(query: string): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/memory/query', {
    body: { query },
    method: 'PATCH',
  })
}

export async function setMemoryFilter(filter: MemoryFilter): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/memory/filter', {
    body: { filter },
    method: 'PATCH',
  })
}

export async function createMemoryItem(input: CreateMemoryItemInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/memory/items', {
    body: input,
    method: 'POST',
  })
}

export async function updateMemoryItem(itemId: string, patch: UpdateMemoryItemPatch): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/memory/items/${encodeURIComponent(itemId)}`, {
    body: patch,
    method: 'PATCH',
  })
}

export async function archiveMemoryItem(itemId: string, confirmed = false): Promise<DesktopState> {
  const body: ArchiveMemoryItemInput = { confirmed }
  return mutateDesktopState(`/api/desktop/memory/items/${encodeURIComponent(itemId)}/archive`, {
    body,
    method: 'POST',
  })
}

export async function runMemoryDream(agentId?: string): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/memory/dream/run', {
    body: agentId ? { agentId } : {},
    method: 'POST',
  })
}

export async function refreshMemoryEnvironment(): Promise<DesktopState> {
  const context = await ensureContext()
  return requestDesktopState(context, '/api/desktop/memory/environment/status')
}

export async function repairMemoryEnvironment(): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/memory/environment/repair', {
    method: 'POST',
  })
}

export async function reinstallMemoryEnvironment(confirm: 'REINSTALL'): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/memory/environment/reinstall', {
    body: { confirm },
    method: 'POST',
  })
}

async function mutateDesktopState(
  path: string,
  request: {
    body?: unknown
    method: 'DELETE' | 'PATCH' | 'POST'
  },
): Promise<DesktopState> {
  const context = await ensureContext()
  return requestDesktopState(context, path, {
    body: request.body ? JSON.stringify(request.body) : undefined,
    method: request.method,
  })
}

async function ensureContext() {
  return ensureDesktopApiContext(async () => {
    await loadBootstrap()
  })
}

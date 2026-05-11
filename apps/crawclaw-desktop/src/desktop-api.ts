import { invoke } from '@tauri-apps/api/core'

export type RuntimeStatusValue = 'missing' | 'checking' | 'ready' | 'error'
export type PermissionStatus = 'pending' | 'approved' | 'denied'
export type BadgeTone = 'danger' | 'idle' | 'neutral' | 'ok'
export type DesktopIconKey =
  | 'blocks'
  | 'bot'
  | 'brain'
  | 'clock3'
  | 'fileText'
  | 'image'
  | 'messageCircle'
  | 'search'
  | 'sparkles'
  | 'squarePen'
  | 'wrench'

export interface RuntimeStatus {
  status: RuntimeStatusValue
  detail: string
  runtimeRoot: string
  binaryPath?: string
  compat?: {
    mode: 'none' | 'pi-quickjs'
    detail: string
  }
  nodePath: string
  entrypointPath: string
}

export interface DesktopAppInfo {
  name: string
  version: string
}

export interface DesktopApiInfo {
  baseUrl: string
  eventsUrl: string
  sessionToken: string
}

export interface DesktopState {
  activeNavId: string
  sidebar: SidebarState
  conversation: ConversationState
  agentWorkspace: AgentWorkspaceState
  memoryWorkspace: MemoryWorkspaceState
  pluginsWorkspace: PluginsWorkspaceState
  preferences: DesktopPreferences
  permissionRequest: PermissionRequest
  searchSuggestions: SearchSuggestion[]
}

export interface SidebarState {
  navItems: NavItemData[]
  pinnedThreads: SidebarThreadData[]
  threads: SidebarThreadData[]
  discussionThreads: SidebarThreadData[]
}

export interface NavItemData {
  id: string
  label: string
  icon: DesktopIconKey
}

export interface SidebarThreadData {
  id: string
  title: string
  time: string
  active: boolean
  agentAvatar: boolean
}

export interface ConversationState {
  resultItems: string[]
  runtimeChecks: RuntimeCheck[]
  slashCommands: CommandSuggestion[]
  skillCommands: SkillSuggestion[]
  draftMessages: DraftMessage[]
}

export interface RuntimeCheck {
  label: string
  value: string
  tone: BadgeTone
}

export interface CommandSuggestion {
  id: string
  label: string
  command: string
  detail: string
  icon: DesktopIconKey
}

export interface SkillSuggestion {
  id: string
  label: string
  mention: string
  detail: string
  icon: DesktopIconKey
}

export interface DraftMessage {
  id: string
  text: string
}

export interface AgentWorkspaceState {
  selectedAgentId: string
  agents: AgentProfile[]
}

export interface AgentProfile {
  id: string
  name: string
  role: string
  description: string
  status: string
  model: string
  thinking: string
  permissionMode: string
  emotion: AgentEmotionProfile
  voice: AgentVoiceConfig
  channels: AgentChannelBinding[]
  avatar: AgentAvatarProfile
  tools: AgentTool[]
  skills: AgentSkill[]
}

export interface AgentEmotionProfile {
  style: string
  tone: string
  boundaries: string[]
  promptMd: string
}

export interface AgentVoiceConfig {
  enabled: boolean
  inputEnabled: boolean
  outputEnabled: boolean
  wakeEnabled: boolean
  source: string
  presetVoice: string
  designPrompt: string
  cloneVoiceName: string
  cloneSampleName: string
  style: string
  pace: string
}

export interface AgentChannelBinding {
  id: string
  label: string
  enabled: boolean
  config?: AgentChannelConfig
}

export interface AgentChannelConfig {
  accountId: string
  dmPolicy: string
  fields: AgentChannelConfigField[]
  groupPolicy: string
  target: string
}

export interface AgentChannelConfigField {
  id: string
  label: string
  secret: boolean
  value: string
}

export interface AgentAvatarProfile {
  initials: string
  gradient: string
  imageDataUrl?: string
  source?: string
}

export interface AgentTool {
  id: string
  name: string
  description: string
  status: string
  permission: string
  icon: DesktopIconKey
  open: boolean
  enabled: boolean
}

export interface AgentSkill {
  id: string
  name: string
  trigger: string
  description: string
  status: string
  source: string
  icon: DesktopIconKey
  open: boolean
  enabled: boolean
}

export type MemoryCategory = '偏好' | '项目' | '经验' | '其他'
export type MemoryFilter = '全部' | MemoryCategory

export interface MemoryWorkspaceState {
  selectedAgentId: string
  selectedItemId: string
  filter: MemoryFilter
  query: string
  dream: MemoryDreamState
  items: MemoryItem[]
}

export interface MemoryDreamState {
  status: 'idle' | 'running'
  agentId: string
  message: string
  lastRunAt: string
}

export interface MemoryItem {
  id: string
  agentId: string
  title: string
  summary: string
  content: string
  category: MemoryCategory
  tags: string[]
  source: string
  updatedAt: string
  archived: boolean
}

export interface CreateMemoryItemInput {
  title: string
  summary: string
  content: string
  category: MemoryCategory
  tags: string[]
  agentId?: string
  source?: string
}

export interface UpdateMemoryItemPatch {
  title?: string
  summary?: string
  content?: string
  category?: MemoryCategory
  tags?: string[]
  source?: string
}

export interface CreateAgentInput {
  name: string
  role: string
  description?: string
  model?: string
  thinking?: string
  permissionMode?: string
  emotion?: AgentEmotionProfile
  voice?: AgentVoiceConfig
  channels?: AgentChannelBinding[]
  avatar?: AgentAvatarProfile
  toolIds?: string[]
  skillIds?: string[]
}

export interface UpdateAgentInput {
  name?: string
  role?: string
  status?: string
  model?: string
  thinking?: string
  permissionMode?: string
}

export interface AddAgentSkillInput {
  name: string
  trigger: string
  description: string
}

export interface PluginsWorkspaceState {
  tools: PluginTool[]
  skills: PluginSkill[]
}

export interface PluginTool {
  id: string
  name: string
  description: string
  status: string
  permission: string
  icon: DesktopIconKey
  open: boolean
}

export interface PluginSkill {
  id: string
  name: string
  trigger: string
  description: string
  status: string
  source: string
  icon: DesktopIconKey
  open: boolean
}

export interface AddPluginSkillInput {
  name: string
  trigger: string
  description: string
}

export interface DesktopPreferences {
  selectedModel: string
  selectedThinking: string
  permissionMode: string
  modelOptions: string[]
  thinkingOptions: string[]
  permissionModeOptions: string[]
}

export interface PermissionRequest {
  id: string
  status: PermissionStatus
}

export interface SearchSuggestion {
  id: string
  label: string
  meta: string
  icon: DesktopIconKey
  targetNavId: string
  targetItemId?: string
}

export type DesktopEvent =
  | { type: 'runtime'; status: RuntimeStatusValue; detail: string }
  | { type: 'runtimeChanged'; runtime: RuntimeStatus }
  | { type: 'sessionStarted'; threadId: string }
  | { type: 'messageDelta'; threadId: string; text: string }
  | { type: 'toolCall'; threadId: string; toolId: string }
  | { type: 'toolResult'; threadId: string; toolId: string; ok: boolean }
  | { type: 'messageFinal'; threadId: string; text: string }
  | { type: 'permissionRequested'; permissionRequest: PermissionRequest }
  | { type: 'operationFailed'; code: string; message: string }
  | { type: 'stateChanged'; desktopState: DesktopState }
  | { type: 'permissionChanged'; permissionRequest: PermissionRequest }

export interface DesktopSessionSummary {
  key: string
  title: string
  pinned: boolean
  status: string
  messageCount: number
  spawnedBy?: string
  yielded: boolean
}

export interface DesktopSessionMessage {
  role: string
  content: string
  source?: string
}

export interface DesktopSessionsResponse {
  sessions: DesktopSessionSummary[]
}

export interface DesktopSessionHistoryResponse {
  sessionKey: string
  messages: DesktopSessionMessage[]
}

export interface DesktopSessionMutationResponse {
  status: string
  session: DesktopSessionSummary
}

export interface DesktopSubagentsResponse {
  subagents: DesktopSessionSummary[]
}

export interface BootstrapResponse {
  app: DesktopAppInfo
  api: DesktopApiInfo
  runtime: RuntimeStatus
  desktopState: DesktopState
}

type DesktopApiContext =
  | {
      api: DesktopApiInfo
      baseUrl: string
      mode: 'http'
    }
  | {
      api: DesktopApiInfo
      mode: 'fixture'
    }

let apiContext: DesktopApiContext | null = null
let fixtureState = createDesktopFixtureState()

export class DesktopApiRequestError extends Error {
  code?: string
  method: string
  path: string
  status: number

  constructor(params: { code?: string; message: string; method: string; path: string; status: number }) {
    super(params.message)
    this.name = 'DesktopApiRequestError'
    this.code = params.code
    this.method = params.method
    this.path = params.path
    this.status = params.status
  }
}

export async function loadBootstrap(): Promise<BootstrapResponse> {
  const baseUrl = await resolveDesktopApiBaseUrl()
  if (!baseUrl) {
    if (!isDesktopFixtureModeEnabled()) {
      throw new Error('CrawClaw Desktop Gateway URL is not available.')
    }

    fixtureState = createDesktopFixtureState()
    apiContext = {
      api: {
        baseUrl: '',
        eventsUrl: '',
        sessionToken: 'fixture-session',
      },
      mode: 'fixture',
    }
    return {
      app: {
        name: 'CrawClaw Desktop',
        version: 'preview',
      },
      api: apiContext.api,
      runtime: createMissingRuntimeStatus(),
      desktopState: cloneDesktopState(fixtureState),
    }
  }

  const response = await fetch(`${baseUrl}/api/desktop/bootstrap`)
  if (!response.ok) {
    throw new Error(`Unable to load /api/desktop/bootstrap: HTTP ${response.status}`)
  }

  const bootstrap = (await response.json()) as BootstrapResponse
  apiContext = {
    api: bootstrap.api,
    baseUrl,
    mode: 'http',
  }
  return bootstrap
}

export async function loadDesktopState(): Promise<DesktopState> {
  const context = await ensureContext()
  if (context.mode === 'fixture') {
    return cloneDesktopState(fixtureState)
  }

  return requestDesktopState(context, '/api/desktop/state')
}

export async function searchDesktop(query: string): Promise<SearchSuggestion[]> {
  const context = await ensureContext()
  if (context.mode === 'fixture') {
    return searchFixture(query)
  }

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
  if (context.mode === 'fixture') {
    return { sessions: fixtureSessions() }
  }
  return requestDesktop<DesktopSessionsResponse>(context, '/api/desktop/sessions')
}

export async function loadSessionHistory(threadId: string): Promise<DesktopSessionHistoryResponse> {
  const context = await ensureContext()
  if (context.mode === 'fixture') {
    return { sessionKey: threadId, messages: [] }
  }
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
  if (context.mode === 'fixture') {
    const key = `fixture-subagent-${Date.now()}`
    const session = {
      key,
      messageCount: 1,
      pinned: false,
      spawnedBy: input.parentSessionKey,
      status: 'spawned',
      title: input.label || input.task.slice(0, 32) || key,
      yielded: false,
    }
    fixtureState.sidebar.discussionThreads.unshift({
      active: false,
      agentAvatar: true,
      id: key,
      time: '子 agent',
      title: session.title,
    })
    return { status: 'spawned', session }
  }
  return requestDesktop<DesktopSessionMutationResponse>(context, '/api/desktop/sessions/spawn', {
    body: JSON.stringify(input),
    method: 'POST',
  })
}

export async function sendSession(sessionKey: string, message: string): Promise<DesktopSessionMutationResponse> {
  const context = await ensureContext()
  if (context.mode === 'fixture') {
    return {
      session: {
        key: sessionKey,
        messageCount: 1,
        pinned: false,
        status: 'pending',
        title: sessionKey,
        yielded: false,
      },
      status: 'sent',
    }
  }
  return requestDesktop<DesktopSessionMutationResponse>(context, '/api/desktop/sessions/send', {
    body: JSON.stringify({ message, sessionKey }),
    method: 'POST',
  })
}

export async function yieldSession(sessionKey: string): Promise<DesktopSessionMutationResponse> {
  const context = await ensureContext()
  if (context.mode === 'fixture') {
    return {
      session: {
        key: sessionKey,
        messageCount: 0,
        pinned: false,
        status: 'yielded',
        title: sessionKey,
        yielded: true,
      },
      status: 'yielded',
    }
  }
  return requestDesktop<DesktopSessionMutationResponse>(context, '/api/desktop/sessions/yield', {
    body: JSON.stringify({ sessionKey }),
    method: 'POST',
  })
}

export async function listSubagents(parentSessionKey?: string): Promise<DesktopSubagentsResponse> {
  const context = await ensureContext()
  if (context.mode === 'fixture') {
    return {
      subagents: fixtureSessions().filter((session) =>
        parentSessionKey ? session.spawnedBy === parentSessionKey : Boolean(session.spawnedBy),
      ),
    }
  }
  const query = parentSessionKey ? `?parentSessionKey=${encodeURIComponent(parentSessionKey)}` : ''
  return requestDesktop<DesktopSubagentsResponse>(context, `/api/desktop/subagents${query}`)
}

export async function sendMessage(text: string): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages', {
    body: { text },
    method: 'POST',
  })
}

export async function abortMessage(): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/abort', {
    method: 'POST',
  })
}

export async function steerMessage(text: string): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/messages/steer', {
    body: { text },
    method: 'POST',
  })
}

export async function decidePermission(requestId: string, decision: Exclude<PermissionStatus, 'pending'>): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/permissions/${encodeURIComponent(requestId)}/decision`, {
    body: { decision },
    method: 'POST',
  })
}

export async function updatePreferences(patch: Partial<Pick<DesktopPreferences, 'permissionMode' | 'selectedModel' | 'selectedThinking'>>): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/preferences', {
    body: patch,
    method: 'PATCH',
  })
}

export async function togglePluginTool(toolId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/tools/${encodeURIComponent(toolId)}/toggle`, {
    method: 'POST',
  })
}

export async function togglePluginSkill(skillId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/skills/${encodeURIComponent(skillId)}/toggle`, {
    method: 'POST',
  })
}

export async function invokePluginTool(pluginId: string, toolId: string, input: unknown = {}): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/plugins/${encodeURIComponent(pluginId)}/tools/${encodeURIComponent(toolId)}/invoke`, {
    body: { input },
    method: 'POST',
  })
}

export async function addPluginSkill(skill: AddPluginSkillInput): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/plugins/skills', {
    body: skill,
    method: 'POST',
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

export async function archiveMemoryItem(itemId: string): Promise<DesktopState> {
  return mutateDesktopState(`/api/desktop/memory/items/${encodeURIComponent(itemId)}/archive`, {
    method: 'POST',
  })
}

export async function runMemoryDream(agentId?: string): Promise<DesktopState> {
  return mutateDesktopState('/api/desktop/memory/dream/run', {
    body: agentId ? { agentId } : {},
    method: 'POST',
  })
}

export function subscribeDesktopEvents(onEvent: (event: DesktopEvent) => void): () => void {
  if (!apiContext || apiContext.mode === 'fixture' || !apiContext.api.eventsUrl) {
    return () => {}
  }

  const url = `${apiContext.api.eventsUrl}?sessionToken=${encodeURIComponent(apiContext.api.sessionToken)}`
  const source = new EventSource(url)
  const handleMessage = (event: MessageEvent) => {
    try {
      onEvent(JSON.parse(event.data) as DesktopEvent)
    } catch {
      // Ignore malformed local events; the next valid event will resync state.
    }
  }

  source.addEventListener('runtime', handleMessage)
  source.addEventListener('stateChanged', handleMessage)
  source.addEventListener('permissionChanged', handleMessage)
  return () => source.close()
}

export function createDesktopInitialState(): DesktopState {
  return isDesktopFixtureModeEnabled()
    ? createDesktopFixtureState()
    : createDesktopUnavailableState()
}

export function createDesktopUnavailableState(detail = '正在连接本机 Gateway。'): DesktopState {
  return {
    activeNavId: 'new-chat',
    sidebar: {
      navItems: [
        { id: 'new-chat', label: '新对话', icon: 'squarePen' },
        { id: 'search', label: '搜索', icon: 'search' },
        { id: 'agent', label: '智能体', icon: 'bot' },
        { id: 'plugins', label: '插件', icon: 'blocks' },
        { id: 'automation', label: '自动化', icon: 'clock3' },
        { id: 'memory', label: '记忆', icon: 'brain' },
      ],
      pinnedThreads: [],
      threads: [],
      discussionThreads: [],
    },
    conversation: {
      resultItems: [detail],
      runtimeChecks: [
        { label: 'Desktop Shell', value: '已加载', tone: 'ok' },
        { label: 'Desktop API', value: 'error', tone: 'danger' },
        { label: 'Runtime', value: 'missing', tone: 'danger' },
      ],
      slashCommands: [],
      skillCommands: [],
      draftMessages: [],
    },
    agentWorkspace: {
      selectedAgentId: '',
      agents: [],
    },
    memoryWorkspace: {
      selectedAgentId: '',
      selectedItemId: '',
      filter: '全部',
      query: '',
      dream: {
        agentId: '',
        lastRunAt: '',
        message: '',
        status: 'idle',
      },
      items: [],
    },
    pluginsWorkspace: {
      tools: [],
      skills: [],
    },
    preferences: {
      selectedModel: 'GPT-5.5',
      selectedThinking: '高',
      permissionMode: '工作区模式',
      modelOptions: ['GPT-5.5', 'GPT-5.4', 'Sonnet 4.6'],
      thinkingOptions: ['高', '中', '低'],
      permissionModeOptions: ['工作区模式', '只读模式', '完全访问'],
    },
    permissionRequest: {
      id: '',
      status: 'denied',
    },
    searchSuggestions: [],
  }
}

export function createDesktopFixtureState(): DesktopState {
  return {
    activeNavId: 'new-chat',
    sidebar: {
      navItems: [
        { id: 'new-chat', label: '新对话', icon: 'squarePen' },
        { id: 'search', label: '搜索', icon: 'search' },
        { id: 'agent', label: '智能体', icon: 'bot' },
        { id: 'plugins', label: '插件', icon: 'blocks' },
        { id: 'automation', label: '自动化', icon: 'clock3' },
        { id: 'memory', label: '记忆', icon: 'brain' },
      ],
      pinnedThreads: [
        { id: 'thread-doc-drift', title: '检查代码文档漂移', time: '2 天', active: false, agentAvatar: false },
      ],
      threads: [
        { id: 'thread-desktop-ui', title: '重构桌面应用参考 Codex UI', time: '刚刚', active: true, agentAvatar: true },
        { id: 'thread-desktop-plan', title: '规划 CrawClaw Desktop 改造', time: '8 小时', active: false, agentAvatar: true },
        { id: 'thread-gateway-reload', title: '优化 Gateway 设置重载', time: '1 天', active: false, agentAvatar: true },
        { id: 'thread-cleanup', title: '清理文档代码和数据库', time: '1 天', active: false, agentAvatar: true },
      ],
      discussionThreads: [
        { id: 'discussion-ui', title: '桌面 UI 评审群', time: '3 人', active: false, agentAvatar: false },
        { id: 'discussion-runtime', title: 'Runtime 迁移讨论', time: '5 人', active: false, agentAvatar: false },
      ],
    },
    conversation: {
      resultItems: [
        'Base UI 作为后续复杂控件行为层',
        'lucide 图标替换 Unicode 占位符',
        '自建 tokens 控制 macOS 简约视觉',
      ],
      runtimeChecks: [
        { label: 'Desktop Shell', value: '已加载', tone: 'ok' },
        { label: 'Desktop API', value: '已接入', tone: 'ok' },
        { label: 'Runtime', value: 'missing', tone: 'danger' },
      ],
      slashCommands: [
        { id: 'slash-workflow', label: '运行工作流', command: '/workflow ', detail: '启动 n8n / ComfyUI 工作流', icon: 'blocks' },
        { id: 'slash-tool', label: '调用工具', command: '/tool ', detail: '选择本机工具并查看执行结果', icon: 'wrench' },
        { id: 'slash-schedule', label: '创建定时任务', command: '/schedule ', detail: '配置一次或重复执行的任务', icon: 'clock3' },
        { id: 'slash-attach', label: '添加附件', command: '/attach ', detail: '选择图片、视频或本地文件', icon: 'fileText' },
        { id: 'slash-summary', label: '总结当前对话', command: '/summary ', detail: '把当前上下文整理成简短摘要', icon: 'sparkles' },
      ],
      skillCommands: [
        { id: 'skill-ui-polish', label: 'macOS UI polish', mention: '@macOS UI polish ', detail: '打磨桌面端气泡、动效和输入体验', icon: 'sparkles' },
        { id: 'skill-inspect-ui', label: 'desktop.inspect_ui', mention: '@desktop.inspect_ui ', detail: '读取当前窗口结构与可见控件', icon: 'wrench' },
        { id: 'skill-comfyui', label: 'comfyui.workflow', mention: '@comfyui.workflow ', detail: '生成和检查 ComfyUI 工作流预览', icon: 'image' },
        { id: 'skill-n8n', label: 'n8n.workflow', mention: '@n8n.workflow ', detail: '运行自动化流程并查看节点状态', icon: 'blocks' },
      ],
      draftMessages: [],
    },
    agentWorkspace: {
      selectedAgentId: 'agent-main',
      agents: [
        createFixtureAgent('agent-main', 'CrawClaw Agent', '默认', '运行中', 'GPT-5.5', '高', '工作区模式'),
        createFixtureAgent('agent-workflow', 'Workflow Runner', '自动化', '空闲', 'GPT-5.4', '中', '只读模式'),
        createFixtureAgent('agent-ui', 'UI Polish', '界面', '草稿', 'GPT-5.5', '高', '工作区模式'),
      ],
    },
    memoryWorkspace: {
      selectedAgentId: 'agent-main',
      selectedItemId: 'memory-preference-simple-ui',
      filter: '全部',
      query: '',
      dream: {
        agentId: '',
        lastRunAt: '',
        message: '',
        status: 'idle',
      },
      items: [
        {
          agentId: 'agent-main',
          archived: false,
          category: '偏好',
          content: '普通用户优先看到对话和少量入口；复杂运行状态、内部层级和诊断信息先不要放在第一屏。',
          id: 'memory-preference-simple-ui',
          source: '来自对话',
          summary: '桌面端默认采用简洁、普通用户能理解的界面。',
          tags: ['桌面端', '简化'],
          title: '默认使用简洁桌面界面',
          updatedAt: '今天 10:20',
        },
        {
          agentId: 'agent-main',
          archived: false,
          category: '项目',
          content: 'CrawClaw Desktop 第一阶段只接 Desktop BFF 的本机内存态，用于验证 UI 和交互，不接真实 runtime。',
          id: 'memory-project-desktop-bff',
          source: '手动添加',
          summary: '桌面端预览先使用本机内存态。',
          tags: ['Desktop', 'BFF'],
          title: 'CrawClaw Desktop 本机项目',
          updatedAt: '昨天 18:05',
        },
        {
          agentId: 'agent-workflow',
          archived: false,
          category: '经验',
          content: '涉及 Gateway 配置时，优先判断是否可以 reconfigure；只有确实需要重启时才提示用户。',
          id: 'memory-lesson-gateway-reconfigure',
          source: '来自对话',
          summary: 'Gateway 配置体验要减少重启打断。',
          tags: ['Gateway', '体验'],
          title: 'Gateway 设置重载经验',
          updatedAt: '2 天前',
        },
        {
          agentId: 'agent-ui',
          archived: false,
          category: '其他',
          content: '视觉调试阶段可以保留少量临时观察，但不要把它们放成复杂工作台。',
          id: 'memory-other-visual-note',
          source: '手动添加',
          summary: '临时 UI 观察放在低优先级分类。',
          tags: ['UI'],
          title: '界面观察记录',
          updatedAt: '3 天前',
        },
      ],
    },
    pluginsWorkspace: {
      tools: [
        {
          description: '读取、创建和整理本机文件，后续会接入权限审核。',
          icon: 'fileText',
          id: 'tool-filesystem',
          name: '文件系统',
          open: false,
          permission: '工作区模式',
          status: '可用',
        },
        {
          description: '读取当前网页结构、截图和可见元素，用于 UI 评审。',
          icon: 'search',
          id: 'tool-browser',
          name: '浏览器检查',
          open: false,
          permission: '只读',
          status: '可用',
        },
        {
          description: '触发 n8n、ComfyUI 和本机自动化流程的统一入口。',
          icon: 'blocks',
          id: 'tool-workflow',
          name: '工作流连接器',
          open: false,
          permission: '需要确认',
          status: '预览',
        },
      ],
      skills: [
        {
          description: '打磨桌面端气泡、动效和输入体验',
          icon: 'sparkles',
          id: 'skill-ui-polish',
          name: 'macOS UI polish',
          open: false,
          source: '内置',
          status: '已启用',
          trigger: '@macOS UI polish',
        },
        {
          description: '读取当前窗口结构与可见控件',
          icon: 'wrench',
          id: 'skill-inspect-ui',
          name: 'desktop.inspect_ui',
          open: false,
          source: '内置',
          status: '已启用',
          trigger: '@desktop.inspect_ui',
        },
        {
          description: '运行自动化流程并查看节点状态',
          icon: 'blocks',
          id: 'skill-n8n',
          name: 'n8n.workflow',
          open: false,
          source: '内置',
          status: '草稿',
          trigger: '@n8n.workflow',
        },
      ],
    },
    preferences: {
      selectedModel: 'GPT-5.5',
      selectedThinking: '高',
      permissionMode: '工作区模式',
      modelOptions: ['GPT-5.5', 'GPT-5.4', 'Sonnet 4.6'],
      thinkingOptions: ['高', '中', '低'],
      permissionModeOptions: ['工作区模式', '只读模式', '完全访问'],
    },
    permissionRequest: {
      id: 'permission-current-window',
      status: 'pending',
    },
    searchSuggestions: [
      { id: 'search-thread-desktop-ui', label: '重构桌面应用参考 Codex UI', meta: '对话 · 刚刚', icon: 'messageCircle', targetNavId: 'new-chat' },
      { id: 'search-agent', label: 'CrawClaw Agent', meta: '智能体 · 本机 UI', icon: 'bot', targetNavId: 'agent' },
      { id: 'search-plugin-tools', label: '插件工具', meta: 'Tools · 文件系统和浏览器检查', icon: 'blocks', targetNavId: 'plugins' },
      { id: 'search-skill-ui-polish', label: 'macOS UI polish', meta: 'Skill · 已启用', icon: 'sparkles', targetNavId: 'plugins' },
      { id: 'search-n8n', label: 'n8n 工作流', meta: '工作流 · 运行中', icon: 'blocks', targetNavId: 'automation' },
      { id: 'search-schedule', label: '每日环境巡检', meta: '定时任务 · 已启用', icon: 'clock3', targetNavId: 'automation' },
      { id: 'search-memory-simple-ui', label: '默认使用简洁桌面界面', meta: '记忆 · 偏好', icon: 'brain', targetNavId: 'memory', targetItemId: 'memory-preference-simple-ui' },
    ],
  }
}

function createFixtureAgent(
  id: string,
  name: string,
  role: string,
  status: string,
  model: string,
  thinking: string,
  permissionMode: string,
  overrides: Partial<AgentProfile> = {},
): AgentProfile {
  return {
    avatar: overrides.avatar ?? defaultAgentAvatar(id, name),
    channels: overrides.channels ?? defaultAgentChannels(),
    description: overrides.description ?? defaultAgentDescription(role),
    emotion: overrides.emotion ?? defaultAgentEmotion(),
    id,
    name,
    role,
    status,
    model,
    thinking,
    permissionMode,
    skills: overrides.skills ?? defaultAgentSkills(),
    tools: overrides.tools ?? defaultAgentTools(),
    voice: overrides.voice ?? defaultAgentVoice(),
  }
}

function defaultAgentDescription(role: string) {
  return role ? `${role}智能体` : '本机智能体'
}

function defaultAgentEmotion(): AgentEmotionProfile {
  return {
    boundaries: ['先确认关键风险'],
    promptMd: defaultAgentEmotionPrompt('专业克制', '清晰、直接', ['先确认关键风险']),
    style: '专业克制',
    tone: '清晰、直接',
  }
}

function defaultAgentEmotionPrompt(style: string, tone: string, boundaries: string[]) {
  return [
    '# 情感提示词',
    `- 情感风格：${style}`,
    `- 表达语气：${tone}`,
    `- 交互边界：${boundaries.join('、')}`,
  ].join('\n')
}

function defaultAgentVoice(): AgentVoiceConfig {
  return {
    cloneSampleName: '',
    cloneVoiceName: '',
    designPrompt: '',
    enabled: false,
    inputEnabled: true,
    outputEnabled: false,
    pace: '正常',
    presetVoice: 'Cherry',
    source: 'qwen-preset',
    style: '清晰',
    wakeEnabled: false,
  }
}

function defaultAgentChannels(): AgentChannelBinding[] {
  return [
    { config: defaultAgentChannelConfig('desktop'), enabled: true, id: 'desktop', label: '桌面' },
    { config: defaultAgentChannelConfig('ddingtalk'), enabled: false, id: 'ddingtalk', label: '钉钉' },
    { config: defaultAgentChannelConfig('feishu'), enabled: false, id: 'feishu', label: '飞书' },
    { config: defaultAgentChannelConfig('esp32'), enabled: false, id: 'esp32', label: 'ESP32' },
    { config: defaultAgentChannelConfig('qqbot'), enabled: false, id: 'qqbot', label: 'QQ Bot' },
    { config: defaultAgentChannelConfig('weixin'), enabled: false, id: 'weixin', label: '微信' },
  ]
}

function defaultAgentChannelConfig(id: string): AgentChannelConfig {
  switch (id) {
    case 'desktop':
      return {
        accountId: 'local',
        dmPolicy: 'open',
        fields: [],
        groupPolicy: 'open',
        target: 'desktop',
      }
    case 'feishu':
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [
          { id: 'appId', label: 'App ID', secret: false, value: '' },
          { id: 'appSecret', label: 'App Secret', secret: true, value: '' },
          { id: 'verificationToken', label: 'Verification Token', secret: true, value: '' },
          { id: 'encryptKey', label: 'Encrypt Key', secret: true, value: '' },
        ],
        groupPolicy: 'allowlist',
        target: '',
      }
    case 'ddingtalk':
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [
          { id: 'clientId', label: 'Client ID', secret: false, value: '' },
          { id: 'clientSecret', label: 'Client Secret', secret: true, value: '' },
        ],
        groupPolicy: 'allowlist',
        target: '',
      }
    case 'esp32':
      return {
        accountId: 'local',
        dmPolicy: 'open',
        fields: [
          { id: 'brokerMode', label: 'Broker Mode', secret: false, value: 'managed' },
          { id: 'bindHost', label: 'Bind Host', secret: false, value: '127.0.0.1' },
          { id: 'port', label: 'Port', secret: false, value: '1883' },
        ],
        groupPolicy: 'open',
        target: '',
      }
    case 'qqbot':
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [
          { id: 'appId', label: 'App ID', secret: false, value: '' },
          { id: 'clientSecret', label: 'Client Secret', secret: true, value: '' },
          { id: 'markdownSupport', label: 'Markdown 支持', secret: false, value: 'true' },
        ],
        groupPolicy: 'allowlist',
        target: '',
      }
    case 'weixin':
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [],
        groupPolicy: 'allowlist',
        target: '',
      }
    default:
      return {
        accountId: 'default',
        dmPolicy: 'pairing',
        fields: [],
        groupPolicy: 'allowlist',
        target: '',
      }
  }
}

function defaultAgentAvatar(id: string, name: string): AgentAvatarProfile {
  const [from, to] = agentAvatarPaletteForSeed(`${id}:${name}`)
  return {
    gradient: `linear-gradient(135deg, ${from}, ${to})`,
    initials: getFixtureAgentInitials(name),
    source: 'generated',
  }
}

function agentAvatarPaletteForSeed(seedValue: string) {
  const palettes = [
    ['#2563eb', '#14b8a6'],
    ['#7c3aed', '#ec4899'],
    ['#0f766e', '#84cc16'],
    ['#be123c', '#f97316'],
    ['#4338ca', '#06b6d4'],
  ]
  const seed = Array.from(seedValue).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return palettes[seed % palettes.length]
}

function getFixtureAgentInitials(name: string) {
  const compactName = name.trim().replace(/\s+/g, ' ')
  if (!compactName) {
    return 'A'
  }

  if (isAsciiText(compactName)) {
    return compactName
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }

  return Array.from(compactName.replace(/\s/g, '')).slice(0, 1).join('').toUpperCase()
}

function isAsciiText(value: string) {
  return Array.from(value).every((char) => char.charCodeAt(0) <= 0x7f)
}

function defaultAgentTools(): AgentTool[] {
  return [
    {
      description: '读取、创建和整理本机文件。',
      enabled: false,
      icon: 'fileText',
      id: 'agent-tool-filesystem',
      name: '文件系统',
      open: false,
      permission: '工作区模式',
      status: '可用',
    },
    {
      description: '读取当前网页结构、截图和可见元素。',
      enabled: false,
      icon: 'search',
      id: 'agent-tool-browser',
      name: '浏览器检查',
      open: false,
      permission: '只读',
      status: '可用',
    },
    {
      description: '触发 n8n、ComfyUI 和本机自动化流程。',
      enabled: false,
      icon: 'blocks',
      id: 'agent-tool-workflow',
      name: '工作流连接器',
      open: false,
      permission: '需要确认',
      status: '预览',
    },
  ]
}

function defaultAgentSkills(): AgentSkill[] {
  return [
    {
      description: '打磨桌面端气泡、动效和输入体验',
      enabled: false,
      icon: 'sparkles',
      id: 'agent-skill-ui-polish',
      name: 'macOS UI polish',
      open: false,
      source: '内置',
      status: '已启用',
      trigger: '@macOS UI polish',
    },
    {
      description: '读取当前窗口结构与可见控件',
      enabled: false,
      icon: 'wrench',
      id: 'agent-skill-inspect-ui',
      name: 'desktop.inspect_ui',
      open: false,
      source: '内置',
      status: '已启用',
      trigger: '@desktop.inspect_ui',
    },
  ]
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function recordStringValue(record: Record<string, unknown>, key: string, fallback = '') {
  const value = record[key]
  return typeof value === 'string' ? value : fallback
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function agentEmotionValue(value: unknown): AgentEmotionProfile {
  const fallback = defaultAgentEmotion()
  if (!isRecord(value)) {
    return fallback
  }

  return {
    boundaries: stringArrayValue(value.boundaries).map((item) => item.trim()).filter(Boolean),
    promptMd: stringValue(value.promptMd, fallback.promptMd),
    style: stringValue(value.style, '专业克制'),
    tone: stringValue(value.tone, '清晰、直接'),
  }
}

function agentVoiceValue(value: unknown): AgentVoiceConfig {
  if (!isRecord(value)) {
    return defaultAgentVoice()
  }

  return {
    cloneSampleName: stringValue(value.cloneSampleName, ''),
    cloneVoiceName: stringValue(value.cloneVoiceName, ''),
    designPrompt: stringValue(value.designPrompt, ''),
    enabled: value.enabled === true,
    inputEnabled: value.inputEnabled !== false,
    outputEnabled: value.outputEnabled === true,
    pace: stringValue(value.pace, '正常'),
    presetVoice: stringValue(value.presetVoice, 'Cherry'),
    source: stringValue(value.source, 'qwen-preset'),
    style: stringValue(value.style, '清晰'),
    wakeEnabled: value.wakeEnabled === true,
  }
}

function agentChannelsValue(value: unknown): AgentChannelBinding[] {
  const channels = defaultAgentChannels()
  const provided = Array.isArray(value)
    ? value.filter(isRecord)
    : []
  for (const channel of provided) {
    const id = stringValue(channel.id, '')
    if (!id) {
      continue
    }
    const existing = channels.find((item) => item.id === id)
    if (existing) {
      existing.enabled = channel.enabled === true
      existing.label = stringValue(channel.label, existing.label)
      existing.config = agentChannelConfigValue(channel.config, existing.config ?? defaultAgentChannelConfig(id))
    } else {
      const fallback = defaultAgentChannelConfig(id)
      channels.push({
        config: agentChannelConfigValue(channel.config, fallback),
        enabled: channel.enabled === true,
        id,
        label: stringValue(channel.label, id),
      })
    }
  }
  if (!channels.some((channel) => channel.enabled)) {
    channels[0].enabled = true
  }
  return channels
}

function agentChannelConfigValue(value: unknown, fallback: AgentChannelConfig): AgentChannelConfig {
  if (!isRecord(value)) {
    return fallback
  }

  const fallbackFields = fallback?.fields ?? []
  const fields = agentChannelConfigFieldsValue(value.fields, fallbackFields)

  return {
    accountId: stringValue(value.accountId, fallback.accountId),
    dmPolicy: stringValue(value.dmPolicy, fallback.dmPolicy),
    fields,
    groupPolicy: stringValue(value.groupPolicy, fallback.groupPolicy),
    target: stringValue(value.target, fallback.target),
  }
}

function agentChannelConfigFieldsValue(value: unknown, fallbackFields: AgentChannelConfigField[]) {
  const fields = fallbackFields.map((field) => ({ ...field }))
  const provided = Array.isArray(value)
    ? value.filter(isRecord)
    : []

  for (const field of provided) {
    const id = stringValue(field.id, '')
    if (!id) {
      continue
    }
    const existing = fields.find((item) => item.id === id)
    const nextField = {
      id,
      label: stringValue(field.label, existing?.label ?? id),
      secret: field.secret === true || existing?.secret === true,
      value: typeof field.value === 'string' ? field.value.trim() : existing?.value ?? '',
    }
    if (existing) {
      existing.label = nextField.label
      existing.secret = nextField.secret
      existing.value = nextField.value
    } else {
      fields.push(nextField)
    }
  }

  return fields
}

function agentAvatarValue(value: unknown, id: string, name: string): AgentAvatarProfile {
  const fallback = defaultAgentAvatar(id, name)
  if (!isRecord(value)) {
    return fallback
  }

  return {
    gradient: stringValue(value.gradient, fallback.gradient),
    ...(typeof value.imageDataUrl === 'string' && value.imageDataUrl.trim()
      ? { imageDataUrl: value.imageDataUrl.trim() }
      : {}),
    initials: stringValue(value.initials, fallback.initials).slice(0, 2),
    source: stringValue(value.source, fallback.source ?? 'generated'),
  }
}

function applyAgentCapabilitySelection(agent: AgentProfile, body: Record<string, unknown>) {
  const toolIds = new Set(stringArrayValue(body.toolIds))
  const skillIds = new Set(stringArrayValue(body.skillIds))
  for (const tool of agent.tools) {
    tool.enabled = toolIds.has(tool.id)
  }
  for (const skill of agent.skills) {
    skill.enabled = skillIds.has(skill.id)
  }
}

function fixtureSessions(): DesktopSessionSummary[] {
  return [
    ...fixtureState.sidebar.pinnedThreads,
    ...fixtureState.sidebar.threads,
    ...fixtureState.sidebar.discussionThreads,
  ].map((thread) => ({
    key: thread.id,
    messageCount: 0,
    pinned: fixtureState.sidebar.pinnedThreads.some((pinned) => pinned.id === thread.id),
    status: thread.active ? 'active' : 'idle',
    title: thread.title,
    yielded: false,
  }))
}

async function mutateDesktopState(
  path: string,
  request: {
    body?: unknown
    method: 'PATCH' | 'POST'
  },
): Promise<DesktopState> {
  const context = await ensureContext()
  if (context.mode === 'fixture') {
    return mutateFixture(path, request.body)
  }

  return requestDesktopState(context, path, {
    body: request.body ? JSON.stringify(request.body) : undefined,
    method: request.method,
  })
}

async function requestDesktopState(
  context: Extract<DesktopApiContext, { mode: 'http' }>,
  path: string,
  init: RequestInit = {},
): Promise<DesktopState> {
  return requestDesktop<DesktopState>(context, path, init)
}

async function requestDesktop<T>(
  context: Extract<DesktopApiContext, { mode: 'http' }>,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${context.baseUrl}${path}`, {
    ...init,
    headers: requestHeaders(init, context.api.sessionToken),
  })
  if (!response.ok) {
    const method = init.method ?? 'GET'
    const errorBody = await readErrorBody(response)
    const message = typeof errorBody?.message === 'string' && errorBody.message.trim()
      ? errorBody.message.trim()
      : `Desktop API request failed: ${method} ${path} HTTP ${response.status}`
    throw new DesktopApiRequestError({
      code: typeof errorBody?.code === 'string' ? errorBody.code : undefined,
      message,
      method,
      path,
      status: response.status,
    })
  }

  return response.json() as Promise<T>
}

function requestHeaders(init: RequestInit, sessionToken: string): Record<string, string> {
  return {
    ...headersToRecord(init.headers),
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    'x-crawclaw-desktop-session': sessionToken,
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {}
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return headers
}

async function readErrorBody(response: Response): Promise<{ code?: unknown; message?: unknown } | null> {
  try {
    const body = await response.clone().json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

async function ensureContext(): Promise<DesktopApiContext> {
  if (!apiContext) {
    await loadBootstrap()
  }

  return apiContext!
}

async function resolveDesktopApiBaseUrl(): Promise<string> {
  const configured = import.meta.env.VITE_CRAWCLAW_DESKTOP_API_BASE_URL?.trim()
  if (configured) {
    return configured
  }

  try {
    return await invoke<string>('desktop_api_base_url')
  } catch {
    return ''
  }
}

function isDesktopFixtureModeEnabled(): boolean {
  return import.meta.env.VITE_CRAWCLAW_DESKTOP_FIXTURE === '1'
}

function mutateFixture(path: string, body: unknown): DesktopState {
  if (path === '/api/desktop/navigation/select' && isRecord(body)) {
    const navId = recordStringValue(body, 'navId')
    if (navId && navId !== 'search') {
      fixtureState.activeNavId = navId
    }
  } else if (path === '/api/desktop/threads/select' && isRecord(body)) {
    const threadId = recordStringValue(body, 'threadId')
    setActiveThread(fixtureState, threadId)
    fixtureState.activeNavId = 'new-chat'
  } else if (path.endsWith('/pin')) {
    moveThread(path, fixtureState.sidebar.threads, fixtureState.sidebar.pinnedThreads)
  } else if (path.endsWith('/unpin')) {
    moveThread(path, fixtureState.sidebar.pinnedThreads, fixtureState.sidebar.threads)
  } else if (path.endsWith('/rename') && isRecord(body)) {
    const threadId = threadIdFromPath(path)
    const title = recordStringValue(body, 'title').trim()
    if (threadId && title) {
      renameThreadInList(fixtureState.sidebar.pinnedThreads, threadId, title)
      renameThreadInList(fixtureState.sidebar.threads, threadId, title)
    }
  } else if (path.includes('/api/desktop/threads/') && path.endsWith('/archive')) {
    const threadId = threadIdFromPath(path)
    fixtureState.sidebar.pinnedThreads = fixtureState.sidebar.pinnedThreads.filter((thread) => thread.id !== threadId)
    fixtureState.sidebar.threads = fixtureState.sidebar.threads.filter((thread) => thread.id !== threadId)
  } else if (path === '/api/desktop/messages' && isRecord(body)) {
    const text = recordStringValue(body, 'text').trim()
    if (text) {
      fixtureState.conversation.draftMessages.push({
        id: `draft-${fixtureState.conversation.draftMessages.length + 1}`,
        text,
      })
    }
  } else if (path.includes('/permissions/') && isRecord(body)) {
    const decision = body.decision
    if (decision === 'approved' || decision === 'denied') {
      fixtureState.permissionRequest.status = decision
    }
  } else if (path === '/api/desktop/preferences' && isRecord(body)) {
    if (typeof body.selectedModel === 'string') {
      fixtureState.preferences.selectedModel = body.selectedModel
    }
    if (typeof body.selectedThinking === 'string') {
      fixtureState.preferences.selectedThinking = body.selectedThinking
    }
    if (typeof body.permissionMode === 'string') {
      fixtureState.preferences.permissionMode = body.permissionMode
    }
  } else if (path.includes('/api/desktop/agents/') && path.endsWith('/select')) {
    const agentId = agentEntityIdFromPath(path)
    if (fixtureState.agentWorkspace.agents.some((agent) => agent.id === agentId)) {
      fixtureState.agentWorkspace.selectedAgentId = agentId
      fixtureState.activeNavId = 'agent'
    }
  } else if (path === '/api/desktop/agents' && isRecord(body)) {
    const name = recordStringValue(body, 'name').trim()
    const role = recordStringValue(body, 'role').trim()
    if (name && role) {
      const id = nextCustomAgentId()
      const agent = createFixtureAgent(
        id,
        name,
        role,
        '草稿',
        stringValue(body.model, 'GPT-5.5'),
        stringValue(body.thinking, '高'),
        stringValue(body.permissionMode, '工作区模式'),
        {
          avatar: agentAvatarValue(body.avatar, id, name),
          channels: agentChannelsValue(body.channels),
          description: stringValue(body.description, defaultAgentDescription(role)),
          emotion: agentEmotionValue(body.emotion),
          voice: agentVoiceValue(body.voice),
        },
      )
      applyAgentCapabilitySelection(agent, body)
      fixtureState.agentWorkspace.agents.push(agent)
      fixtureState.agentWorkspace.selectedAgentId = agent.id
      fixtureState.activeNavId = 'agent'
    }
  } else if (path.includes('/api/desktop/agents/') && !path.includes('/tools/') && !path.includes('/skills/') && !path.endsWith('/skills') && isRecord(body)) {
    const agent = findAgent(agentEntityIdFromPath(path))
    if (agent) {
      if (typeof body.name === 'string' && body.name.trim()) {
        agent.name = body.name.trim()
      }
      if (typeof body.role === 'string' && body.role.trim()) {
        agent.role = body.role.trim()
      }
      if (typeof body.status === 'string' && body.status.trim()) {
        agent.status = body.status.trim()
      }
      if (typeof body.model === 'string' && body.model.trim()) {
        agent.model = body.model.trim()
      }
      if (typeof body.thinking === 'string' && body.thinking.trim()) {
        agent.thinking = body.thinking.trim()
      }
      if (typeof body.permissionMode === 'string' && body.permissionMode.trim()) {
        agent.permissionMode = body.permissionMode.trim()
      }
    }
  } else if (path.includes('/api/desktop/agents/') && path.includes('/tools/') && path.endsWith('/toggle')) {
    const agent = findAgent(agentEntityIdFromPath(path))
    const toolId = agentCapabilityIdFromPath(path, 'tools')
    const tool = agent?.tools.find((item) => item.id === toolId)
    if (tool) {
      tool.enabled = !tool.enabled
      tool.open = true
    }
  } else if (path.includes('/api/desktop/agents/') && path.includes('/skills/') && path.endsWith('/toggle')) {
    const agent = findAgent(agentEntityIdFromPath(path))
    const skillId = agentCapabilityIdFromPath(path, 'skills')
    const skill = agent?.skills.find((item) => item.id === skillId)
    if (skill) {
      skill.enabled = !skill.enabled
      skill.open = true
    }
  } else if (path.includes('/api/desktop/agents/') && path.endsWith('/skills') && isRecord(body)) {
    const agent = findAgent(agentEntityIdFromPath(path))
    const name = recordStringValue(body, 'name').trim()
    const trigger = normalizeSkillTrigger(recordStringValue(body, 'trigger').trim())
    const description = recordStringValue(body, 'description').trim()
    if (agent && name && trigger !== '@' && description && !agent.skills.some((item) => item.trigger === trigger)) {
      agent.skills.push({
        description,
        enabled: false,
        icon: 'sparkles',
        id: customAgentSkillId(trigger),
        name,
        open: false,
        source: '自定义',
        status: '本地',
        trigger,
      })
    }
  } else if (path.includes('/api/desktop/memory/items/') && path.endsWith('/select')) {
    const itemId = memoryItemIdFromPath(path)
    const item = fixtureState.memoryWorkspace.items.find((memoryItem) => memoryItem.id === itemId && !memoryItem.archived)
    if (item) {
      fixtureState.memoryWorkspace.selectedItemId = itemId
      fixtureState.memoryWorkspace.selectedAgentId = item.agentId
      fixtureState.memoryWorkspace.query = ''
      fixtureState.activeNavId = 'memory'
    }
  } else if (path.includes('/api/desktop/memory/agents/') && path.endsWith('/select')) {
    const agentId = memoryAgentIdFromPath(path)
    if (fixtureState.agentWorkspace.agents.some((agent) => agent.id === agentId)) {
      fixtureState.memoryWorkspace.selectedAgentId = agentId
      fixtureState.memoryWorkspace.selectedItemId = firstVisibleMemoryItemId(agentId)
      fixtureState.memoryWorkspace.query = ''
      fixtureState.memoryWorkspace.filter = '全部'
      fixtureState.activeNavId = 'memory'
    }
  } else if (path === '/api/desktop/memory/query' && isRecord(body)) {
    fixtureState.memoryWorkspace.query = recordStringValue(body, 'query')
  } else if (path === '/api/desktop/memory/filter' && isRecord(body)) {
    const filter = recordStringValue(body, 'filter')
    if (isMemoryFilter(filter)) {
      fixtureState.memoryWorkspace.filter = filter
    }
  } else if (path === '/api/desktop/memory/dream/run') {
    const requestedAgentId = isRecord(body) && typeof body.agentId === 'string'
      ? body.agentId
      : fixtureState.memoryWorkspace.selectedAgentId
    const agent = findAgent(requestedAgentId) ?? findAgent(fixtureState.memoryWorkspace.selectedAgentId)
    if (agent) {
      fixtureState.memoryWorkspace.selectedAgentId = agent.id
      fixtureState.memoryWorkspace.selectedItemId = firstVisibleMemoryItemId(agent.id)
      fixtureState.memoryWorkspace.query = ''
      fixtureState.memoryWorkspace.filter = '全部'
      fixtureState.memoryWorkspace.dream = {
        agentId: agent.id,
        lastRunAt: '刚刚',
        message: `${agent.name} 正在把最近对话整理成可长期记住的内容。`,
        status: 'running',
      }
      fixtureState.activeNavId = 'memory'
    }
  } else if (path === '/api/desktop/memory/items' && isRecord(body)) {
    const title = recordStringValue(body, 'title').trim()
    const summary = recordStringValue(body, 'summary').trim()
    const content = recordStringValue(body, 'content').trim()
    const category = recordStringValue(body, 'category', '其他')
    if (title && summary && content && isMemoryCategory(category)) {
      const tags = Array.isArray(body.tags)
        ? body.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : []
      let item: MemoryItem = {
        agentId: typeof body.agentId === 'string' && fixtureState.agentWorkspace.agents.some((agent) => agent.id === body.agentId)
          ? body.agentId
          : fixtureState.memoryWorkspace.selectedAgentId,
        archived: false,
        category,
        content,
        id: customMemoryId(title),
        source: typeof body.source === 'string' && body.source.trim() ? body.source.trim() : '手动添加',
        summary,
        tags,
        title,
        updatedAt: '刚刚',
      }
      if (fixtureState.memoryWorkspace.items.some((existing) => existing.id === item.id)) {
        item = {
          ...item,
          id: `${item.id}-${fixtureState.memoryWorkspace.items.length + 1}`,
        }
      }
      fixtureState.memoryWorkspace.items.unshift(item)
      fixtureState.memoryWorkspace.selectedAgentId = item.agentId
      fixtureState.memoryWorkspace.selectedItemId = item.id
      fixtureState.memoryWorkspace.query = ''
      fixtureState.memoryWorkspace.filter = '全部'
      fixtureState.activeNavId = 'memory'
      fixtureState.searchSuggestions.push({
        icon: 'brain',
        id: `search-${item.id}`,
        label: item.title,
        meta: `记忆 · ${item.category}`,
        targetItemId: item.id,
        targetNavId: 'memory',
      })
    }
  } else if (path.includes('/api/desktop/memory/items/') && path.endsWith('/archive')) {
    const item = findMemoryItem(memoryItemIdFromPath(path))
    if (item) {
      item.archived = true
      item.updatedAt = '刚刚'
      if (fixtureState.memoryWorkspace.selectedItemId === item.id) {
        fixtureState.memoryWorkspace.selectedItemId = firstVisibleMemoryItemId(fixtureState.memoryWorkspace.selectedAgentId)
      }
    }
  } else if (path.includes('/api/desktop/memory/items/') && isRecord(body)) {
    const item = findMemoryItem(memoryItemIdFromPath(path))
    if (item) {
      if (typeof body.title === 'string' && body.title.trim()) {
        item.title = body.title.trim()
      }
      if (typeof body.summary === 'string') {
        item.summary = body.summary.trim()
      }
      if (typeof body.content === 'string') {
        item.content = body.content.trim()
      }
      if (typeof body.category === 'string' && isMemoryCategory(body.category)) {
        item.category = body.category
      }
      if (Array.isArray(body.tags)) {
        item.tags = body.tags.map((tag) => String(tag).trim()).filter(Boolean)
      }
      if (typeof body.source === 'string' && body.source.trim()) {
        item.source = body.source.trim()
      }
      item.updatedAt = '刚刚'
    }
  } else if (path.includes('/api/desktop/plugins/tools/') && path.endsWith('/toggle')) {
    const toolId = pluginEntityIdFromPath(path, 'tools')
    const tool = fixtureState.pluginsWorkspace.tools.find((item) => item.id === toolId)
    if (tool) {
      tool.open = !tool.open
    }
  } else if (path.includes('/api/desktop/plugins/skills/') && path.endsWith('/toggle')) {
    const skillId = pluginEntityIdFromPath(path, 'skills')
    const skill = fixtureState.pluginsWorkspace.skills.find((item) => item.id === skillId)
    if (skill) {
      skill.open = !skill.open
    }
  } else if (path.includes('/api/desktop/plugins/') && path.includes('/tools/') && path.endsWith('/invoke')) {
    const [pluginId = 'plugin', rest = 'tool'] = path.split('/api/desktop/plugins/')[1]?.split('/tools/') ?? []
    const toolId = rest.replace('/invoke', '')
    fixtureState.activeNavId = 'plugins'
    fixtureState.conversation.resultItems.push(`${decodeURIComponent(pluginId)}/${decodeURIComponent(toolId)}: ${JSON.stringify(body)}`)
  } else if (path === '/api/desktop/plugins/skills' && isRecord(body)) {
    const name = recordStringValue(body, 'name').trim()
    const trigger = normalizeSkillTrigger(recordStringValue(body, 'trigger').trim())
    const description = recordStringValue(body, 'description').trim()
    if (name && trigger !== '@' && description) {
      const skill: PluginSkill = {
        description,
        icon: 'sparkles',
        id: customSkillId(trigger),
        name,
        open: false,
        source: '自定义',
        status: '本地',
        trigger,
      }
      if (!fixtureState.pluginsWorkspace.skills.some((item) => item.trigger === trigger)) {
        fixtureState.pluginsWorkspace.skills.push(skill)
      }
      if (!fixtureState.conversation.skillCommands.some((item) => item.mention.trim() === trigger)) {
        fixtureState.conversation.skillCommands.push({
          detail: description,
          icon: skill.icon,
          id: skill.id,
          label: name,
          mention: `${trigger} `,
        })
      }
      if (!fixtureState.searchSuggestions.some((item) => item.id === `search-${skill.id}`)) {
        fixtureState.searchSuggestions.push({
          icon: 'sparkles',
          id: `search-${skill.id}`,
          label: name,
          meta: 'Skill · 自定义',
          targetNavId: 'plugins',
        })
      }
    }
  }

  return cloneDesktopState(fixtureState)
}

function searchFixture(query: string): SearchSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase()
  return fixtureState.searchSuggestions
    .filter((item) => {
      if (!normalizedQuery) {
        return true
      }

      return `${item.label} ${item.meta}`.toLowerCase().includes(normalizedQuery)
    })
    .map((item) => ({ ...item }))
}

function moveThread(path: string, from: SidebarThreadData[], to: SidebarThreadData[]) {
  const threadId = threadIdFromPath(path)
  const index = from.findIndex((thread) => thread.id === threadId)
  if (index === -1) {
    return
  }

  const [thread] = from.splice(index, 1)
  if (thread && !to.some((item) => item.id === thread.id)) {
    to.push(thread)
  }
}

function threadIdFromPath(path: string) {
  const parts = path.split('/')
  const threadIndex = parts.findIndex((part) => part === 'threads')
  return threadIndex === -1 ? '' : decodeURIComponent(parts[threadIndex + 1] ?? '')
}

function pluginEntityIdFromPath(path: string, segment: 'skills' | 'tools') {
  const parts = path.split('/')
  const entityIndex = parts.findIndex((part) => part === segment)
  return entityIndex === -1 ? '' : decodeURIComponent(parts[entityIndex + 1] ?? '')
}

function agentEntityIdFromPath(path: string) {
  const parts = path.split('/')
  const agentIndex = parts.findIndex((part) => part === 'agents')
  return agentIndex === -1 ? '' : decodeURIComponent(parts[agentIndex + 1] ?? '')
}

function agentCapabilityIdFromPath(path: string, segment: 'skills' | 'tools') {
  const parts = path.split('/')
  const capabilityIndex = parts.findIndex((part) => part === segment)
  return capabilityIndex === -1 ? '' : decodeURIComponent(parts[capabilityIndex + 1] ?? '')
}

function memoryItemIdFromPath(path: string) {
  const parts = path.split('/')
  const itemIndex = parts.findIndex((part) => part === 'items')
  return itemIndex === -1 ? '' : decodeURIComponent(parts[itemIndex + 1] ?? '')
}

function memoryAgentIdFromPath(path: string) {
  const parts = path.split('/')
  const agentIndex = parts.findIndex((part) => part === 'agents')
  return agentIndex === -1 ? '' : decodeURIComponent(parts[agentIndex + 1] ?? '')
}

function findAgent(agentId: string) {
  return fixtureState.agentWorkspace.agents.find((agent) => agent.id === agentId)
}

function findMemoryItem(itemId: string) {
  return fixtureState.memoryWorkspace.items.find((item) => item.id === itemId)
}

function firstVisibleMemoryItemId(agentId: string) {
  return fixtureState.memoryWorkspace.items.find((item) => item.agentId === agentId && !item.archived)?.id ?? ''
}

function renameThreadInList(threads: SidebarThreadData[], threadId: string, title: string) {
  for (const thread of threads) {
    if (thread.id === threadId) {
      thread.title = title
    }
  }
}

function setActiveThread(state: DesktopState, threadId: string) {
  for (const thread of [...state.sidebar.pinnedThreads, ...state.sidebar.threads]) {
    thread.active = thread.id === threadId
  }
}

function normalizeSkillTrigger(trigger: string) {
  return trigger.startsWith('@') ? trigger : `@${trigger}`
}

function customSkillId(trigger: string) {
  const slug = trigger
    .replace(/^@/, '')
    .split('')
    .map((char) => (/^[a-z0-9]$/i.test(char) ? char.toLowerCase() : '-'))
    .join('')
    .replace(/^-+|-+$/g, '')
  return `skill-custom-${slug}`
}

function nextCustomAgentId() {
  let index = fixtureState.agentWorkspace.agents.length + 1
  let id = `agent-custom-${index}`
  while (fixtureState.agentWorkspace.agents.some((agent) => agent.id === id)) {
    index += 1
    id = `agent-custom-${index}`
  }
  return id
}

function customAgentSkillId(trigger: string) {
  return `agent-skill-custom-${slugifyText(trigger.replace(/^@/, ''))}`
}

function customMemoryId(title: string) {
  return `memory-custom-${slugifyText(title)}`
}

function isMemoryCategory(value: string): value is MemoryCategory {
  return value === '偏好' || value === '项目' || value === '经验' || value === '其他'
}

function isMemoryFilter(value: string): value is MemoryFilter {
  return value === '全部' || isMemoryCategory(value)
}

function slugifyText(value: string) {
  const slug = value
    .split('')
    .map((char) => (/^[a-z0-9]$/i.test(char) ? char.toLowerCase() : '-'))
    .join('')
    .replace(/^-+|-+$/g, '')
  return slug || 'local'
}

function createMissingRuntimeStatus(): RuntimeStatus {
  return {
    binaryPath: '',
    compat: { mode: 'none', detail: 'Rust runtime is unavailable.' },
    detail: 'Missing runtime',
    entrypointPath: '',
    nodePath: '',
    runtimeRoot: '',
    status: 'missing',
  }
}

function cloneDesktopState(state: DesktopState): DesktopState {
  return JSON.parse(JSON.stringify(state)) as DesktopState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

import {
  Blocks,
  Bot,
  Brain,
  Clock3,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Search,
  Sparkles,
  SquarePen,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  addAgentSkill,
  addAttachmentMessage,
  addMediaMessage,
  addPluginSkill,
  addSkillCallMessage,
  addVoiceMessage,
  addWorkflowMessage,
  abortMessage,
  archiveMemoryItem,
  archiveThread,
  createAgent,
  createMemoryItem,
  decidePermission,
  exportDesktopData,
  pinThread,
  renameThread,
  removePluginSkill,
  runMemoryDream,
  searchDesktop,
  selectAgent,
  selectMemoryAgent,
  selectMemoryItem,
  selectNav,
  selectThread,
  sendMessage,
  setInstalledPluginEnabled,
  setPluginSkillEnabled,
  setPluginToolEnabled,
  setMemoryFilter as setDesktopMemoryFilter,
  setMemoryQuery as setDesktopMemoryQuery,
  startAutomationRuntime,
  steerMessage,
  stopAutomationRuntime,
  testAndSaveModelProfile,
  clearDesktopCache,
  deleteDesktopLocalData,
  generateDesktopDiagnostics,
  installAutomationRuntime,
  installPlugin,
  invokePluginTool,
  listSubagents,
  loadRuntimeStatus,
  openDesktopAsset,
  refreshAutomationRuntime,
  resetDesktopState,
  revealDesktopAsset,
  toggleAgentSkill,
  toggleAgentTool,
  unpinThread,
  uninstallPlugin,
  updateAgent,
  updateMemoryItem,
  updatePreferences,
  type AddAgentSkillInput,
  type AgentProfile,
  type DesktopSessionSummary,
  type DesktopPreferencesPatch,
  type DesktopPreferences,
  type DesktopIconKey,
  type DesktopState,
  type ModelProfileSetupInput,
  type RuntimeStatus,
} from './desktop-api'
import { useDesktopStateController } from './app/use-desktop-state'
import { ChatWorkspace } from './views/chat-workspace'
import { SessionWorkspace } from './views/session-workspace'
import type { SettingsSectionId } from './views/settings-workspace'
import { SearchOverlay } from './ui/search-overlay'
import { Sidebar } from './ui/sidebar'
import type { SidebarNavItem, SidebarThread } from './ui/sidebar'
import {
  ConfirmationDialog,
  type ConfirmationRequestInput,
} from './ui/confirmation-dialog'
import { getCurrentDesktopApiContext } from './api/desktop-transport'

const AgentWorkspace = lazy(() =>
  import('./views/agent-workspace').then((module) => ({
    default: module.AgentWorkspace,
  }))
)
const AutomationWorkspace = lazy(() =>
  import('./views/automation-workspace').then((module) => ({
    default: module.AutomationWorkspace,
  }))
)
const MemoryWorkspace = lazy(() =>
  import('./views/memory-workspace').then((module) => ({
    default: module.MemoryWorkspace,
  }))
)
const PluginsWorkspace = lazy(() =>
  import('./views/plugins-workspace').then((module) => ({
    default: module.PluginsWorkspace,
  }))
)
const SettingsSidebar = lazy(() =>
  import('./views/settings-workspace').then((module) => ({
    default: module.SettingsSidebar,
  }))
)
const SettingsWorkspace = lazy(() =>
  import('./views/settings-workspace').then((module) => ({
    default: module.SettingsWorkspace,
  }))
)

const iconByKey: Record<DesktopIconKey, LucideIcon> = {
  blocks: Blocks,
  bot: Bot,
  brain: Brain,
  clock3: Clock3,
  fileText: FileText,
  image: ImageIcon,
  messageCircle: MessageCircle,
  search: Search,
  sparkles: Sparkles,
  squarePen: SquarePen,
  wrench: Wrench,
}

const navPanels: Record<string, { detail: string; items: string[]; title: string }> = {
  agent: {
    title: '智能体工作区',
    detail: '选择或配置本机智能体、技能和工具能力。',
    items: ['CrawClaw', 'UI Polish', 'Workflow Runner'],
  },
  plugins: {
    title: '插件工作区',
    detail: '展示已安装插件、启用状态和可调用能力。',
    items: ['文件系统', '浏览器检查', '工作流连接器'],
  },
  automation: {
    title: '自动化工作区',
    detail: '管理 n8n、ComfyUI 和定时任务入口。',
    items: ['n8n 工作流', 'ComfyUI 工作流', '每日环境巡检'],
  },
  memory: {
    title: '记忆工作区',
    detail: '管理智能体可以复用的本地记忆与项目偏好。',
    items: ['项目偏好', 'UI 设计约束', '运行经验'],
  },
}

const defaultMemoryAgentId = 'main'

const defaultMemoryAgentProfile: AgentProfile = {
  id: defaultMemoryAgentId,
  name: '本机默认',
  role: '本机任务智能体',
  description: 'CrawClaw Desktop 的默认本机任务身份。',
  status: 'ready',
  model: 'gpt-5.5',
  thinking: 'high',
  permissionMode: '工作区模式',
  emotion: {
    style: 'neutral',
    tone: 'direct',
    boundaries: [],
    promptMd: '',
  },
  voice: {
    enabled: false,
    inputEnabled: false,
    outputEnabled: false,
    wakeEnabled: false,
    source: 'qwen-preset',
    presetVoice: 'Cherry',
    designPrompt: '',
    cloneVoiceName: '',
    cloneSampleName: '',
    style: '',
    pace: '',
  },
  channels: [],
  avatar: {
    initials: '本',
    gradient: 'cyan',
  },
  tools: [],
  skills: [],
}

function memoryScopeAgentProfile(agentId: string): AgentProfile {
  if (agentId === defaultMemoryAgentId) {
    return defaultMemoryAgentProfile
  }
  return {
    ...defaultMemoryAgentProfile,
    id: agentId,
    name: `记忆作用域 ${agentId}`,
    role: '记忆作用域',
    description: '由已保存记忆自动补齐的作用域。',
    avatar: {
      initials: '记',
      gradient: 'slate',
    },
  }
}

function memoryAgentsForWorkspace(
  agents: AgentProfile[],
  memoryWorkspace: DesktopState['memoryWorkspace'],
): AgentProfile[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const scopedIds = [
    defaultMemoryAgentId,
    memoryWorkspace.selectedAgentId,
    ...memoryWorkspace.items.map((item) => item.agentId),
  ]

  for (const id of scopedIds) {
    if (id && !byId.has(id)) {
      byId.set(id, memoryScopeAgentProfile(id))
    }
  }

  return Array.from(byId.values())
}

function DesktopIcon({
  icon,
  size = 15,
}: {
  icon: DesktopIconKey
  size?: number
}) {
  const Icon = iconByKey[icon]
  return <Icon aria-hidden="true" size={size} strokeWidth={2} />
}

function mergeDesktopPreferences(
  preferences: DesktopPreferences,
  patch: DesktopPreferencesPatch,
): DesktopPreferences {
  const next: DesktopPreferences = {
    ...preferences,
    ...patch,
    advancedDefaults: patch.advancedDefaults
      ? { ...preferences.advancedDefaults, ...patch.advancedDefaults }
      : preferences.advancedDefaults,
    confirmationDefaults: patch.confirmationDefaults
      ? { ...preferences.confirmationDefaults, ...patch.confirmationDefaults }
      : preferences.confirmationDefaults,
    memoryDefaults: patch.memoryDefaults
      ? { ...preferences.memoryDefaults, ...patch.memoryDefaults }
      : preferences.memoryDefaults,
    notificationDefaults: patch.notificationDefaults
      ? { ...preferences.notificationDefaults, ...patch.notificationDefaults }
      : preferences.notificationDefaults,
    privacyDefaults: patch.privacyDefaults
      ? { ...preferences.privacyDefaults, ...patch.privacyDefaults }
      : preferences.privacyDefaults,
    taskDefaults: patch.taskDefaults
      ? { ...preferences.taskDefaults, ...patch.taskDefaults }
      : preferences.taskDefaults,
    uiDefaults: patch.uiDefaults
      ? { ...preferences.uiDefaults, ...patch.uiDefaults }
      : preferences.uiDefaults,
  }

  const aliasesChanged = patch.selectedModel !== undefined
    || patch.selectedThinking !== undefined
    || patch.permissionMode !== undefined

  if (aliasesChanged) {
    next.taskDefaults = {
      ...next.taskDefaults,
      permissionMode: next.permissionMode,
      selectedModel: next.selectedModel,
      selectedThinking: next.selectedThinking,
    }
  } else if (patch.taskDefaults) {
    next.permissionMode = next.taskDefaults.permissionMode
    next.selectedModel = next.taskDefaults.selectedModel
    next.selectedThinking = next.taskDefaults.selectedThinking
  }

  return next
}

type PendingConfirmation = ConfirmationRequestInput & {
  id: number
  resolve: (confirmed: boolean) => void
}

function SettingsSidebarFallback() {
  return <aside aria-label="设置导航" className="desktop-sidebar settings-sidebar" />
}

function WorkspaceFallback() {
  return <div aria-label="工作区加载中" className="nav-workspace-panel" />
}

type SessionPanelState = {
  subagents: DesktopSessionSummary[]
}

const initialSessionPanelState: SessionPanelState = {
  subagents: [],
}

function isRunningSubagent(session: DesktopSessionSummary) {
  if (session.yielded) {
    return false
  }
  const status = session.status.trim().toLowerCase()
  return status === 'running'
    || status === 'working'
    || status === 'active'
    || status === 'busy'
    || status === 'pending'
}

function sameSessionSummaries(
  left: DesktopSessionSummary[],
  right: DesktopSessionSummary[],
) {
  if (left.length !== right.length) {
    return false
  }
  return left.every((session, index) => {
    const other = right[index]
    return Boolean(other)
      && session.key === other.key
      && session.title === other.title
      && session.messageCount === other.messageCount
      && session.pinned === other.pinned
      && session.spawnedBy === other.spawnedBy
      && session.status === other.status
      && session.yielded === other.yielded
  })
}

function clearActiveConversation(state: DesktopState): DesktopState {
  return {
    ...state,
    activeNavId: 'new-chat',
    conversation: {
      ...state.conversation,
      messages: [],
      resultItems: [],
      contextSummary: undefined,
    },
    sidebar: {
      ...state.sidebar,
      discussionThreads: state.sidebar.discussionThreads.map((thread) => ({ ...thread, active: false })),
      pinnedThreads: state.sidebar.pinnedThreads.map((thread) => ({ ...thread, active: false })),
      threads: state.sidebar.threads.map((thread) => ({ ...thread, active: false })),
    },
  }
}

function setRuntimeStatusLocally(state: DesktopState, runtime: RuntimeStatus): DesktopState {
  return {
    ...state,
    conversation: {
      ...state.conversation,
      resultItems: state.conversation.resultItems.length > 0
        ? state.conversation.resultItems
        : [runtime.detail],
      runtimeChecks: state.conversation.runtimeChecks.map((item) =>
        item.label === 'Runtime'
          ? {
              ...item,
              tone: runtime.status === 'ready' ? 'ok' : runtime.status === 'checking' ? 'neutral' : 'danger',
              value: runtime.status,
            }
          : item,
      ),
    },
  }
}

function setPluginToolEnabledLocally(state: DesktopState, toolId: string, enabled: boolean): DesktopState {
  return {
    ...state,
    pluginsWorkspace: {
      ...state.pluginsWorkspace,
      tools: state.pluginsWorkspace.tools.map((tool) => tool.id === toolId ? { ...tool, enabled } : tool),
    },
  }
}

function setPluginSkillEnabledLocally(state: DesktopState, skillId: string, enabled: boolean): DesktopState {
  return {
    ...state,
    pluginsWorkspace: {
      ...state.pluginsWorkspace,
      skills: state.pluginsWorkspace.skills.map((skill) => skill.id === skillId ? { ...skill, enabled } : skill),
    },
  }
}

function removePluginSkillLocally(state: DesktopState, skillId: string): DesktopState {
  return {
    ...state,
    pluginsWorkspace: {
      ...state.pluginsWorkspace,
      skills: state.pluginsWorkspace.skills.filter((skill) => skill.id !== skillId || skill.source === 'core'),
    },
  }
}

function uninstallPluginLocally(state: DesktopState, pluginId: string): DesktopState {
  return {
    ...state,
    pluginsWorkspace: {
      ...state.pluginsWorkspace,
      installed: state.pluginsWorkspace.installed.filter((plugin) => plugin.id !== pluginId),
    },
  }
}

function setInstalledPluginEnabledLocally(state: DesktopState, pluginId: string, enabled: boolean): DesktopState {
  return {
    ...state,
    pluginsWorkspace: {
      ...state.pluginsWorkspace,
      installed: state.pluginsWorkspace.installed.map((plugin) => plugin.id === pluginId ? { ...plugin, enabled } : plugin),
    },
  }
}

function appearanceClass(appearance: string) {
  if (appearance === '浅色') {
    return 'is-appearance-light'
  }
  if (appearance === '深色') {
    return 'is-appearance-dark'
  }
  return 'is-appearance-system'
}

function languageCode(language: string): 'en' | 'zh-CN' {
  return language === 'English' ? 'en' : 'zh-CN'
}

export default function App() {
  const {
    applyDesktopState,
    appendOptimisticConversationTurn,
    desktopState,
    searchResults,
    setDesktopState,
    setSearchResults,
  } = useDesktopStateController()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('general')
  const [queuedChatInputText, setQueuedChatInputText] = useState('')
  const [selectedChatAgentId, setSelectedChatAgentId] = useState('')
  const [sessionPanel, setSessionPanel] = useState<SessionPanelState>(initialSessionPanelState)
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
  const pendingConfirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const activeNavId = desktopState.activeNavId
  const appAppearanceClass = appearanceClass(desktopState.preferences.uiDefaults.appearance)
  const appLanguageCode = languageCode(desktopState.preferences.uiDefaults.language)
  const activeNavItem = desktopState.sidebar.navItems.find((item) => item.id === activeNavId)
  const activeNavLabel = activeNavId === 'settings' ? '设置' : (activeNavItem?.label ?? '新对话')
  const activeNavPanel = activeNavId === 'new-chat' ? null : navPanels[activeNavId]
  const runtimeChecks = desktopState.conversation.runtimeChecks
  const memoryWorkspace = desktopState.memoryWorkspace
  const memoryAgents = memoryAgentsForWorkspace(desktopState.agentWorkspace.agents, memoryWorkspace)
  const selectedModel = desktopState.preferences.selectedModel
  const modelOptions = Array.from(new Set([
    ...desktopState.preferences.modelOptions,
    ...desktopState.preferences.modelProfiles.map((profile) => profile.modelRef),
    selectedModel,
  ].filter(Boolean)))
  const navItems: SidebarNavItem[] = desktopState.sidebar.navItems.map((item) => ({
    ...item,
    active: item.id === activeNavId,
    icon: iconByKey[item.icon],
  }))
  const pinnedThreads: SidebarThread[] = desktopState.sidebar.pinnedThreads
  const conversations: SidebarThread[] = desktopState.sidebar.threads
  const discussionThreads: SidebarThread[] = desktopState.sidebar.discussionThreads
  const activeRegularThread = [...pinnedThreads, ...conversations].find((thread) => thread.active) ?? null
  const activeDiscussionThread = discussionThreads.find((thread) => thread.active) ?? null
  const activeSessionParentKey = activeDiscussionThread?.id ?? activeRegularThread?.id ?? undefined
  const hasRunningGeneration = desktopState.conversation.messages.some((message) => (
    message.kind === 'assistant' && message.status === 'running'
  ))
  const runningSubagents = sessionPanel.subagents.filter(isRunningSubagent)

  useEffect(() => {
    if (
      selectedChatAgentId
      && !desktopState.agentWorkspace.agents.some((agent) => agent.id === selectedChatAgentId)
    ) {
      setSelectedChatAgentId('')
    }
  }, [desktopState.agentWorkspace.agents, selectedChatAgentId])

  useEffect(() => {
    const root = document.documentElement
    root.lang = appLanguageCode
    root.dataset.crawclawAppearance = desktopState.preferences.uiDefaults.appearance
    root.dataset.crawclawLanguage = desktopState.preferences.uiDefaults.language
    root.style.colorScheme = appAppearanceClass === 'is-appearance-dark'
      ? 'dark'
      : appAppearanceClass === 'is-appearance-light'
        ? 'light'
        : 'light dark'
  }, [
    appAppearanceClass,
    appLanguageCode,
    desktopState.preferences.uiDefaults.appearance,
    desktopState.preferences.uiDefaults.language,
  ])

  const refreshSessionPanel = useCallback(async () => {
    if (!getCurrentDesktopApiContext()) {
      return
    }
    if (!activeSessionParentKey) {
      setSessionPanel((state) => state.subagents.length === 0
        ? state
        : {
          subagents: [],
        })
      return
    }

    try {
      const subagentsResponse = await listSubagents(activeSessionParentKey)

      setSessionPanel((state) => sameSessionSummaries(state.subagents, subagentsResponse.subagents)
        ? state
        : {
          subagents: subagentsResponse.subagents,
        })
    } catch {
      setSessionPanel((state) => state.subagents.length === 0
        ? state
        : {
          subagents: [],
        })
    }
  }, [activeSessionParentKey])

  useEffect(() => {
    if (activeNavId !== 'new-chat') {
      return
    }

    void refreshSessionPanel()
  }, [activeNavId, discussionThreads.length, refreshSessionPanel])

  useEffect(() => {
    let intervalId: number | undefined
    if (
        activeNavId === 'new-chat'
        && activeSessionParentKey
        && (hasRunningGeneration || runningSubagents.length > 0)
    ) {
      void refreshSessionPanel()
      intervalId = window.setInterval(() => {
        void refreshSessionPanel()
      }, 2500)
    }

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId)
      }
    }
  }, [
    activeNavId,
    activeSessionParentKey,
    hasRunningGeneration,
    refreshSessionPanel,
    runningSubagents.length,
  ])

  const applyPreferenceUpdate = (patch: DesktopPreferencesPatch) => {
    setDesktopState((state) => ({
      ...state,
      preferences: mergeDesktopPreferences(state.preferences, patch),
    }))
    void applyDesktopState(async () => {
      return updatePreferences(patch)
    })
  }

  const saveModelProfile = async (input: ModelProfileSetupInput) => {
    const nextState = await testAndSaveModelProfile(input)
    setDesktopState(nextState)
  }

  const requestConfirmation = useCallback((input: ConfirmationRequestInput): Promise<boolean> => (
    new Promise((resolve) => {
      pendingConfirmationResolverRef.current?.(false)
      pendingConfirmationResolverRef.current = resolve
      setPendingConfirmation({
        ...input,
        id: Date.now(),
        resolve,
      })
    })
  ), [])

  const settleConfirmation = (confirmed: boolean) => {
    const resolver = pendingConfirmation?.resolve ?? pendingConfirmationResolverRef.current
    pendingConfirmationResolverRef.current = null
    setPendingConfirmation(null)
    resolver?.(confirmed)
  }

  const togglePluginTool = (toolId: string, enabled: boolean) => {
    if (!getCurrentDesktopApiContext()) {
      setDesktopState((state) => setPluginToolEnabledLocally(state, toolId, enabled))
      return
    }
    void applyDesktopState(() => setPluginToolEnabled(toolId, enabled))
  }

  const updatePluginSkillEnabled = (skillId: string, enabled: boolean) => {
    if (!getCurrentDesktopApiContext()) {
      setDesktopState((state) => setPluginSkillEnabledLocally(state, skillId, enabled))
      return
    }
    void applyDesktopState(() => setPluginSkillEnabled(skillId, enabled))
  }

  const removePluginSkillFromUi = async (skillId: string) => {
    if (!getCurrentDesktopApiContext()) {
      setDesktopState((state) => removePluginSkillLocally(state, skillId))
      return
    }
    const nextState = await removePluginSkill(skillId)
    setDesktopState(nextState)
  }

  const uninstallPluginFromUi = async (pluginId: string) => {
    if (!getCurrentDesktopApiContext()) {
      setDesktopState((state) => uninstallPluginLocally(state, pluginId))
      return
    }
    const nextState = await uninstallPlugin(pluginId)
    setDesktopState(nextState)
  }

  const updateInstalledPluginEnabled = (pluginId: string, enabled: boolean) => {
    if (!getCurrentDesktopApiContext()) {
      setDesktopState((state) => setInstalledPluginEnabledLocally(state, pluginId, enabled))
      return
    }
    void applyDesktopState(() => setInstalledPluginEnabled(pluginId, enabled))
  }

  const toggleAgentToolFromUi = (agentId: string, toolId: string) => {
    void applyDesktopState(() => toggleAgentTool(agentId, toolId))
  }

  const toggleAgentSkillFromUi = (agentId: string, skillId: string) => {
    void applyDesktopState(() => toggleAgentSkill(agentId, skillId))
  }

  const addAgentSkillFromUi = (agentId: string, skill: AddAgentSkillInput) => {
    void applyDesktopState(() => addAgentSkill(agentId, skill))
  }

  const selectSettingsSection = (id: SettingsSectionId) => {
    setActiveSettingsSection(id)
  }

  const selectNavItem = (item: SidebarNavItem) => {
    if (item.id === 'search') {
      setIsSearchOpen(true)
      return
    }

    setDesktopState((state) => item.id === 'new-chat'
      ? clearActiveConversation(state)
      : {
        ...state,
        activeNavId: item.id,
      })
    void applyDesktopState(() => selectNav(item.id))
  }

  const refreshRuntimeStatus = () => {
    void loadRuntimeStatus()
      .then((runtime) => {
        setDesktopState((state) => setRuntimeStatusLocally(state, runtime))
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : '刷新 runtime 状态失败。'
        setDesktopState((state) => ({
          ...state,
          conversation: {
            ...state.conversation,
            resultItems: [detail],
          },
        }))
      })
  }

  const openSettings = () => {
    setDesktopState((state) => ({
      ...state,
      activeNavId: 'settings',
    }))
    void applyDesktopState(() => selectNav('settings'))
  }

  const returnToApp = () => {
    setDesktopState((state) => ({
      ...state,
      activeNavId: 'new-chat',
    }))
    void applyDesktopState(() => selectNav('new-chat'))
  }

  const showSearchResult = (item: { targetItemId?: string; targetNavId: string }) => {
    void applyDesktopState(async () => {
      let nextState = await selectNav(item.targetNavId)
      if (item.targetNavId === 'memory' && item.targetItemId) {
        nextState = await selectMemoryItem(item.targetItemId)
      } else if (item.targetNavId === 'new-chat' && item.targetItemId) {
        nextState = await selectThread(item.targetItemId)
      } else if (item.targetNavId === 'agent' && item.targetItemId) {
        nextState = await selectAgent(item.targetItemId)
      }
      return nextState
    })
  }

  const tryFeaturedPlugin = () => {
    setQueuedChatInputText('@macOS UI polish ')
    void applyDesktopState(() => selectNav('new-chat'))
  }

  const updateSearchResults = useCallback((query: string) => {
    void searchDesktop(query).then(setSearchResults).catch(() => {
      setSearchResults(desktopState.searchSuggestions)
    })
  }, [desktopState.searchSuggestions])

  return (
    <div
      className={`desktop-app ${appAppearanceClass}`}
      data-language={appLanguageCode}
    >
      {activeNavId === 'settings' ? (
        <Suspense fallback={<SettingsSidebarFallback />}>
          <SettingsSidebar
            activeSettingsSection={activeSettingsSection}
            language={appLanguageCode}
            onReturnToApp={returnToApp}
            onSelectSection={selectSettingsSection}
          />
        </Suspense>
      ) : (
        <Sidebar
          activeNavLabel={activeNavLabel}
          discussionThreads={discussionThreads}
          navItems={navItems}
          onNavItemClick={selectNavItem}
          onThreadArchive={(thread) => {
            void applyDesktopState(() => archiveThread(thread.id))
          }}
          onThreadPin={(thread) => {
            void applyDesktopState(() => pinThread(thread.id))
          }}
          onThreadRename={(thread, title) => {
            void applyDesktopState(() => renameThread(thread.id, title))
          }}
          onThreadSelect={(thread) => {
            setDesktopState((state) => ({
              ...state,
              activeNavId: 'new-chat',
            }))
            void applyDesktopState(() => selectThread(thread.id))
          }}
          onThreadUnpin={(thread) => {
            void applyDesktopState(() => unpinThread(thread.id))
          }}
          onSettingsClick={openSettings}
          pinnedThreads={pinnedThreads}
          threads={conversations}
        />
      )}
      <SearchOverlay
        onClose={() => setIsSearchOpen(false)}
        onQueryChange={updateSearchResults}
        onSelect={showSearchResult}
        open={isSearchOpen}
        suggestions={searchResults.map((item) => ({
          ...item,
          icon: iconByKey[item.icon],
        }))}
      />
      <main className="desktop-workspace">
        {activeNavId === 'new-chat' ? (
          <ChatWorkspace
            agents={desktopState.agentWorkspace.agents}
            conversation={desktopState.conversation}
            modelOptions={modelOptions}
            onAddAttachmentMessage={(input) => void applyDesktopState(() => addAttachmentMessage(input))}
            onAddMediaMessage={(input) => void applyDesktopState(() => addMediaMessage(input))}
            onAddSkillCallMessage={(input) => void applyDesktopState(() => addSkillCallMessage(input))}
            onAddVoiceMessage={(input) => void applyDesktopState(() => addVoiceMessage(input))}
            onAddWorkflowMessage={(input) => void applyDesktopState(() => addWorkflowMessage(input))}
            onAbortMessage={() => void applyDesktopState(() => abortMessage())}
            onDecidePermission={(requestId, status) => void applyDesktopState(() => decidePermission(requestId, status))}
            onOpenAsset={(assetId) => void applyDesktopState(() => openDesktopAsset(assetId))}
            onPreferenceUpdate={applyPreferenceUpdate}
            onQueuedInputTextConsumed={() => setQueuedChatInputText('')}
            onRevealAsset={(assetId) => void applyDesktopState(() => revealDesktopAsset(assetId))}
            onRequestConfirmation={requestConfirmation}
            onSelectedChatAgentChange={setSelectedChatAgentId}
            onSendMessage={(message) => {
              appendOptimisticConversationTurn(message)
              void applyDesktopState(() => sendMessage(message, {
                agentId: selectedChatAgentId || undefined,
              }))
            }}
            onSteerMessage={(text, mode) => void applyDesktopState(() => steerMessage(text, mode))}
            permissionRequest={desktopState.permissionRequest}
            preferences={desktopState.preferences}
            queuedInputText={queuedChatInputText}
            renderDesktopIcon={(icon) => <DesktopIcon icon={icon} />}
            selectedChatAgentId={selectedChatAgentId}
            sessionPanel={runningSubagents.length > 0 ? (
              <SessionWorkspace
                subagents={runningSubagents}
              />
            ) : undefined}
          />
        ) : (
          <section className="desktop-content" aria-label={`${activeNavLabel} 工作区`}>
            <Suspense fallback={<WorkspaceFallback />}>
              {activeNavId === 'agent' ? (
              <AgentWorkspace
                availableSkills={desktopState.pluginsWorkspace.skills}
                availableTools={desktopState.pluginsWorkspace.tools}
                modelOptions={modelOptions}
                onAddAgentSkill={addAgentSkillFromUi}
                onCreateAgent={(input) => void applyDesktopState(() => createAgent(input))}
                onSelectAgent={(agentId) => void applyDesktopState(() => selectAgent(agentId))}
                onToggleAgentSkill={toggleAgentSkillFromUi}
                onToggleAgentTool={toggleAgentToolFromUi}
                onUpdateAgent={(agentId, input) => void applyDesktopState(() => updateAgent(agentId, input))}
                preferences={desktopState.preferences}
                workspace={desktopState.agentWorkspace}
              />
            ) : activeNavId === 'plugins' ? (
              <PluginsWorkspace
                installed={desktopState.pluginsWorkspace.installed}
                onFeaturedPlugin={tryFeaturedPlugin}
                onInstallPlugin={async (input) => {
                  const nextState = await installPlugin(input)
                  setDesktopState(nextState)
                }}
                onInstallSkill={async (input) => {
                  const nextState = await addPluginSkill(input)
                  setDesktopState(nextState)
                }}
                onInvokePluginTool={async (pluginId, toolId, input) => {
                  const nextState = await invokePluginTool(pluginId, toolId, input)
                  setDesktopState(nextState)
                }}
                onRequestConfirmation={requestConfirmation}
                onRemovePluginSkill={removePluginSkillFromUi}
                onSetInstalledPluginEnabled={updateInstalledPluginEnabled}
                onSetPluginSkillEnabled={updatePluginSkillEnabled}
                onSetPluginToolEnabled={togglePluginTool}
                onUninstallPlugin={uninstallPluginFromUi}
                onUseSkill={(skill) => void applyDesktopState(() => addSkillCallMessage({
                  detail: skill.description,
                  skillId: skill.id,
                  status: 'ready',
                  title: skill.name,
                }))}
                skills={desktopState.pluginsWorkspace.skills}
                tools={desktopState.pluginsWorkspace.tools}
              />
            ) : activeNavId === 'automation' ? (
              <AutomationWorkspace
                automationWorkspace={desktopState.automationWorkspace}
                confirmHighRisk={desktopState.preferences.confirmationDefaults.confirmHighRisk}
                onAddWorkflowMessage={(input) => void applyDesktopState(() => addWorkflowMessage(input))}
                onInstallRuntime={(runtimeId, input) => applyDesktopState(() => installAutomationRuntime(runtimeId, input))}
                onRequestConfirmation={requestConfirmation}
                onStartRuntime={(runtimeId) => applyDesktopState(() => startAutomationRuntime(runtimeId))}
                onStopRuntime={(runtimeId) => applyDesktopState(() => stopAutomationRuntime(runtimeId))}
                onRefreshRuntime={(runtimeId) => applyDesktopState(() => refreshAutomationRuntime(runtimeId))}
              />
            ) : activeNavId === 'memory' ? (
              <MemoryWorkspace
                agents={memoryAgents}
                memoryCleanupConfirmation={desktopState.preferences.memoryDefaults.memoryCleanupConfirmation}
                memoryWorkspace={memoryWorkspace}
                onArchiveMemory={(memoryId, confirmed) => void applyDesktopState(() => archiveMemoryItem(memoryId, confirmed))}
                onCreateMemory={(input) => void applyDesktopState(() => createMemoryItem(input))}
                onRequestConfirmation={requestConfirmation}
                onRunMemoryDream={(agentId) => void applyDesktopState(() => runMemoryDream(agentId))}
                onSelectAgent={(agentId) => void applyDesktopState(() => selectMemoryAgent(agentId))}
                onSelectMemory={(memoryId) => void applyDesktopState(() => selectMemoryItem(memoryId))}
                onSetFilter={(filter) => void applyDesktopState(() => setDesktopMemoryFilter(filter))}
                onSetQuery={(query) => void applyDesktopState(() => setDesktopMemoryQuery(query))}
                onUpdateMemory={(memoryId, patch) => void applyDesktopState(() => updateMemoryItem(memoryId, patch))}
              />
            ) : activeNavId === 'settings' ? (
              <SettingsWorkspace
                activeSettingsSection={activeSettingsSection}
                language={appLanguageCode}
                modelOptions={modelOptions}
                onClearCache={() => void applyDesktopState(() => clearDesktopCache())}
                onDeleteLocalData={() => {
                  void (async () => {
                    const confirmed = await requestConfirmation({
                      title: '删除本机桌面数据',
                      detail: '会删除桌面 runtime 数据，保留 credentials、API key 和真实项目文件。',
                      confirmLabel: '删除',
                      tone: 'danger',
                    })
                    if (confirmed) {
                      void applyDesktopState(() => deleteDesktopLocalData('DELETE'))
                    }
                  })()
                }}
                onExportData={() => void applyDesktopState(() => exportDesktopData())}
                onGenerateDiagnostics={() => void applyDesktopState(() => generateDesktopDiagnostics())}
                onModelProfileTestAndSave={saveModelProfile}
                onPreferenceUpdate={applyPreferenceUpdate}
                onRefreshRuntimeStatus={refreshRuntimeStatus}
                onResetState={() => {
                  void (async () => {
                    const confirmed = await requestConfirmation({
                      title: '重置桌面状态',
                      detail: '会清空桌面会话、偏好、诊断和日志，保留模型配置、记忆、工作流和密钥。',
                      confirmLabel: '重置',
                      tone: 'danger',
                    })
                    if (confirmed) {
                      void applyDesktopState(() => resetDesktopState('RESET'))
                    }
                  })()
                }}
                preferences={desktopState.preferences}
                runtimeStatus={runtimeChecks.find((item) => item.label === 'Runtime')?.value ?? '未知'}
              />
            ) : activeNavPanel ? (
              <div className="nav-workspace-panel">
                <div className="nav-workspace-card">
                  <p className="panel-kicker">{activeNavLabel}</p>
                  <h1>{activeNavPanel.title}</h1>
                  <p>{activeNavPanel.detail}</p>
                  <div className="nav-workspace-card__items" aria-label={`${activeNavLabel} 可用入口`}>
                    {activeNavPanel.items.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>
              </div>
              ) : null}
            </Suspense>
          </section>
        )}
      </main>
      {pendingConfirmation ? (
        <ConfirmationDialog
          cancelLabel={pendingConfirmation.cancelLabel}
          confirmLabel={pendingConfirmation.confirmLabel}
          detail={pendingConfirmation.detail}
          onCancel={() => settleConfirmation(false)}
          onConfirm={() => settleConfirmation(true)}
          title={pendingConfirmation.title}
          tone={pendingConfirmation.tone}
        />
      ) : null}
    </div>
  )
}

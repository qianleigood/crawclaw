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
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  addAttachmentMessage,
  addMediaMessage,
  addPluginSkill,
  addSkillCallMessage,
  addVoiceMessage,
  addWorkflowMessage,
  archiveMemoryItem,
  archiveThread,
  createAgent,
  createMemoryItem,
  decidePermission,
  pinThread,
  renameThread,
  runMemoryDream,
  searchDesktop,
  selectAgent,
  selectMemoryAgent,
  selectMemoryItem,
  selectNav,
  selectThread,
  sendMessage,
  setMemoryFilter as setDesktopMemoryFilter,
  setMemoryQuery as setDesktopMemoryQuery,
  togglePluginSkill,
  unpinThread,
  updateMemoryItem,
  updatePreferences,
  type AddPluginSkillInput,
  type DesktopPreferences,
  type DesktopIconKey,
  type DesktopState,
  type PluginSkill,
} from './desktop-api'
import { useDesktopStateController } from './app/use-desktop-state'
import { AgentWorkspace } from './views/agent-workspace'
import { ChatWorkspace } from './views/chat-workspace'
import { MemoryWorkspace } from './views/memory-workspace'
import { PluginsWorkspace } from './views/plugins-workspace'
import {
  SettingsSidebar,
  SettingsWorkspace,
  type SettingsSectionId,
} from './views/settings-workspace'
import { SearchOverlay } from './ui/search-overlay'
import { Sidebar } from './ui/sidebar'
import type { SidebarNavItem, SidebarThread } from './ui/sidebar'

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
    detail: '选择或配置本机智能体，后续会接入运行状态与技能能力。',
    items: ['CrawClaw', 'UI Polish', 'Workflow Runner'],
  },
  plugins: {
    title: '插件工作区',
    detail: '展示已安装插件、启用状态和可调用能力。',
    items: ['文件系统', '浏览器检查', '工作流连接器'],
  },
  automation: {
    title: '自动化工作区',
    detail: '管理 n8n、ComfyUI 和定时任务的静态入口。',
    items: ['n8n 工作流', 'ComfyUI 工作流', '每日环境巡检'],
  },
  memory: {
    title: '记忆工作区',
    detail: '管理智能体可以复用的本地记忆与项目偏好。',
    items: ['项目偏好', 'UI 设计约束', '运行经验'],
  },
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

function localPluginSkillId(trigger: string) {
  return `skill-custom-${trigger.replace(/^@/, '').replace(/[^a-zA-Z0-9_.-]+/g, '-')}`
}

function addPluginSkillLocally(state: DesktopState, input: AddPluginSkillInput): DesktopState {
  const id = localPluginSkillId(input.trigger)
  const skill: PluginSkill = {
    description: input.description,
    icon: 'sparkles',
    id,
    name: input.name,
    open: false,
    source: '自定义',
    status: '本地',
    trigger: input.trigger,
  }
  const hasSkill = state.pluginsWorkspace.skills.some((item) => item.trigger === input.trigger)
  const hasCommand = state.conversation.skillCommands.some((item) => item.mention.trim() === input.trigger)
  const hasSearchSuggestion = state.searchSuggestions.some((item) => item.id === `search-${id}`)

  return {
    ...state,
    conversation: {
      ...state.conversation,
      skillCommands: hasCommand
        ? state.conversation.skillCommands
        : [
          ...state.conversation.skillCommands,
          {
            detail: input.description,
            icon: skill.icon,
            id,
            label: input.name,
            mention: `${input.trigger} `,
          },
        ],
    },
    pluginsWorkspace: {
      ...state.pluginsWorkspace,
      skills: hasSkill ? state.pluginsWorkspace.skills : [...state.pluginsWorkspace.skills, skill],
    },
    searchSuggestions: hasSearchSuggestion
      ? state.searchSuggestions
      : [
        ...state.searchSuggestions,
        {
          icon: skill.icon,
          id: `search-${id}`,
          label: input.name,
          meta: 'Skill',
          targetNavId: 'plugins',
        },
      ],
  }
}

function mergeDesktopPreferences(
  preferences: DesktopPreferences,
  patch: Partial<DesktopPreferences>,
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

function clearActiveConversation(state: DesktopState): DesktopState {
  return {
    ...state,
    activeNavId: 'new-chat',
    conversation: {
      ...state.conversation,
      messages: [],
      resultItems: [],
    },
    sidebar: {
      ...state.sidebar,
      discussionThreads: state.sidebar.discussionThreads.map((thread) => ({ ...thread, active: false })),
      pinnedThreads: state.sidebar.pinnedThreads.map((thread) => ({ ...thread, active: false })),
      threads: state.sidebar.threads.map((thread) => ({ ...thread, active: false })),
    },
  }
}

export default function App() {
  const {
    applyDesktopState,
    desktopState,
    searchResults,
    setDesktopState,
    setSearchResults,
  } = useDesktopStateController()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('general')
  const [customModelOptions, setCustomModelOptions] = useState<string[]>([])
  const [queuedChatInputText, setQueuedChatInputText] = useState('')
  const [selectedChatAgentId, setSelectedChatAgentId] = useState('')
  const activeNavId = desktopState.activeNavId
  const activeNavItem = desktopState.sidebar.navItems.find((item) => item.id === activeNavId)
  const activeNavLabel = activeNavId === 'settings' ? '设置' : (activeNavItem?.label ?? '新对话')
  const activeNavPanel = activeNavId === 'new-chat' ? null : navPanels[activeNavId]
  const runtimeChecks = desktopState.conversation.runtimeChecks
  const memoryWorkspace = desktopState.memoryWorkspace
  const selectedModel = desktopState.preferences.selectedModel
  const modelOptions = Array.from(new Set([
    ...desktopState.preferences.modelOptions,
    ...customModelOptions,
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

  useEffect(() => {
    if (
      selectedChatAgentId
      && !desktopState.agentWorkspace.agents.some((agent) => agent.id === selectedChatAgentId)
    ) {
      setSelectedChatAgentId('')
    }
  }, [desktopState.agentWorkspace.agents, selectedChatAgentId])

  const applyPreferenceUpdate = (patch: Parameters<typeof updatePreferences>[0]) => {
    setDesktopState((state) => ({
      ...state,
      preferences: mergeDesktopPreferences(state.preferences, patch),
    }))
    void applyDesktopState(() => updatePreferences(patch))
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
    <div className="desktop-app">
      {activeNavId === 'settings' ? (
        <SettingsSidebar
          activeSettingsSection={activeSettingsSection}
          onReturnToApp={returnToApp}
          onSelectSection={selectSettingsSection}
        />
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
            onDecidePermission={(requestId, status) => void applyDesktopState(() => decidePermission(requestId, status))}
            onPreferenceUpdate={applyPreferenceUpdate}
            onQueuedInputTextConsumed={() => setQueuedChatInputText('')}
            onSelectedChatAgentChange={setSelectedChatAgentId}
            onSendMessage={(message) => void applyDesktopState(() => sendMessage(message, {
              agentId: selectedChatAgentId || undefined,
            }))}
            permissionRequest={desktopState.permissionRequest}
            preferences={desktopState.preferences}
            queuedInputText={queuedChatInputText}
            renderDesktopIcon={(icon) => <DesktopIcon icon={icon} />}
            selectedChatAgentId={selectedChatAgentId}
          />
        ) : (
          <section className="desktop-content" aria-label={`${activeNavLabel} 工作区`}>
            {activeNavId === 'agent' ? (
              <AgentWorkspace
                modelOptions={modelOptions}
                onCreateAgent={(input) => void applyDesktopState(() => createAgent(input))}
                onSelectAgent={(agentId) => void applyDesktopState(() => selectAgent(agentId))}
                preferences={desktopState.preferences}
                workspace={desktopState.agentWorkspace}
              />
            ) : activeNavId === 'plugins' ? (
              <PluginsWorkspace
                onFeaturedPlugin={tryFeaturedPlugin}
                onInstallSkill={async (input) => {
                  try {
                    const nextState = await addPluginSkill(input)
                    setDesktopState(nextState)
                  } catch {
                    setDesktopState((state) => addPluginSkillLocally(state, input))
                  }
                }}
                onTogglePluginSkill={(skillId) => void applyDesktopState(() => togglePluginSkill(skillId))}
                renderSkillIcon={(icon) => <DesktopIcon icon={icon} />}
                skills={desktopState.pluginsWorkspace.skills}
              />
            ) : activeNavId === 'memory' ? (
              <MemoryWorkspace
                agents={desktopState.agentWorkspace.agents}
                memoryWorkspace={memoryWorkspace}
                onArchiveMemory={(memoryId) => void applyDesktopState(() => archiveMemoryItem(memoryId))}
                onCreateMemory={(input) => void applyDesktopState(() => createMemoryItem(input))}
                onRunMemoryDream={(agentId) => void applyDesktopState(() => runMemoryDream(agentId))}
                onSelectAgent={(agentId) => void applyDesktopState(() => selectMemoryAgent(agentId))}
                onSetFilter={(filter) => void applyDesktopState(() => setDesktopMemoryFilter(filter))}
                onSetQuery={(query) => void applyDesktopState(() => setDesktopMemoryQuery(query))}
                onUpdateMemory={(memoryId, patch) => void applyDesktopState(() => updateMemoryItem(memoryId, patch))}
              />
            ) : activeNavId === 'settings' ? (
              <SettingsWorkspace
                activeSettingsSection={activeSettingsSection}
                modelOptions={modelOptions}
                onAddModelOption={(modelName) => {
                  setCustomModelOptions((models) => (
                    models.some((model) => model.toLowerCase() === modelName.toLowerCase())
                      ? models
                      : [...models, modelName]
                  ))
                  applyPreferenceUpdate({ selectedModel: modelName })
                }}
                onPreferenceUpdate={applyPreferenceUpdate}
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
          </section>
        )}
      </main>
    </div>
  )
}

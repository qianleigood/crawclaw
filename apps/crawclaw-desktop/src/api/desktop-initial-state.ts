import type { DesktopState } from '../generated/desktop-api-contract.generated'

export function createDesktopInitialState(): DesktopState {
  return createDesktopUnavailableState()
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
      selectedModel: 'gpt-5.5',
      selectedThinking: 'high',
      permissionMode: '工作区模式',
      modelOptions: ['gpt-5.5'],
      providerDescriptors: [],
      providerSetupOptions: [],
      providerModelPickerEntries: [],
      webProviderBoundaries: [],
      thinkingOptions: ['high', 'medium', 'low'],
      permissionModeOptions: ['工作区模式', '只读模式', '完全访问'],
    },
    permissionRequest: {
      id: '',
      status: 'denied',
    },
    searchSuggestions: [],
  }
}

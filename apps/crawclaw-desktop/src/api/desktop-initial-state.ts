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
      messages: [],
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
      taskDefaults: {
        selectedModel: 'gpt-5.5',
        selectedThinking: 'high',
        permissionMode: '工作区模式',
        responseSpeed: '标准',
        allowTools: true,
        showReasoningSummary: false,
      },
      confirmationDefaults: {
        confirmFileChanges: true,
        confirmCommands: true,
        confirmExternalApps: true,
        confirmHighRisk: true,
      },
      notificationDefaults: {
        notifyTaskDone: true,
        notifyConfirmNeeded: true,
        notifyDreamDone: true,
        notifyAutomationFailed: true,
        notificationSound: false,
      },
      uiDefaults: {
        defaultPage: '新对话',
        language: '中文',
        appearance: '跟随系统',
        launchAtLogin: false,
        showInMenuBar: true,
      },
      memoryDefaults: {
        rememberPreferences: true,
        rememberProjectContext: true,
        memoryDreamEnabled: true,
        memoryDreamFrequency: '空闲时',
        memoryCleanupConfirmation: '每次确认',
      },
      privacyDefaults: {
        dataLocation: '本机默认位置',
      },
      advancedDefaults: {
        logLevel: '标准',
      },
      modelOptions: ['gpt-5.5'],
      modelProfiles: [],
      providerDescriptors: [],
      providerSetupOptions: [],
      providerModelPickerEntries: [],
      webProviderBoundaries: [],
      thinkingOptions: ['high', 'medium', 'low'],
      permissionModeOptions: ['工作区模式', '只读模式', '完全访问'],
    },
    permissionRequest: {
      id: '',
      title: '',
      detail: '',
      status: 'denied',
    },
    searchSuggestions: [],
  }
}

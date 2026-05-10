// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPage from './ChatPage.vue'

const localStorageRows = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => localStorageRows.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageRows.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    localStorageRows.delete(key)
  }),
  clear: vi.fn(() => {
    localStorageRows.clear()
  }),
})

const baseAgentStatus = () => ({
  phase: 'idle',
  runId: null,
  detail: null,
  updatedAtMs: Date.now(),
  sinceMs: Date.now(),
  sessionKey: null,
  lastMessage: null,
  finishedAtMs: null,
})

const mocks = vi.hoisted(() => ({
  desktopStore: {
    isDesktopMode: true,
    advancedMode: false,
  },
  chatStore: {
    sessionKey: '',
    messages: [] as Array<{
      id?: string
      role: 'user' | 'assistant' | 'tool' | 'system'
      content: string
      timestamp?: string
      rawContent?: Array<Record<string, unknown>>
    }>,
    loading: false,
    syncing: false,
    sending: false,
    lastError: null as string | null,
    lastSyncedAt: null as number | null,
    agentSteps: new Map<string, unknown[]>(),
    toolProgress: new Map<string, unknown>(),
    getOrCreateAgentStatus: vi.fn(() => baseAgentStatus()),
    setSessionKey: vi.fn((key: string) => {
      mocks.chatStore.sessionKey = key
    }),
    fetchHistory: vi.fn(async () => undefined),
    handleRealtimeEvent: vi.fn(),
    handleAgentStatusEvent: vi.fn(),
    clearTimers: vi.fn(),
    sendMessage: vi.fn(async () => undefined),
    abortActiveRun: vi.fn(async () => undefined),
  },
  configStore: {
    config: {
      agents: {
        defaults: { workspace: '/workspace' },
        list: [],
      },
      models: {},
    },
    loading: false,
    fetchConfig: vi.fn(async () => undefined),
  },
  sessionStore: {
    sessions: [{ key: 'main', label: 'Main', agentId: 'main', peer: 'local', model: 'gpt-test' }],
    loading: false,
    fetchSessions: vi.fn(async () => undefined),
    fetchUsage: vi.fn(async () => ({ sessions: [], totals: null })),
  },
  skillStore: {
    skills: [],
    loading: false,
    fetchSkills: vi.fn(async () => undefined),
    isSkillVisibleInChat: vi.fn(() => true),
  },
  wsStore: {
    rpc: {
      getSessionsUsage: vi.fn(async () => ({ sessions: [], totals: null })),
    },
    subscribe: vi.fn(() => vi.fn()),
  },
}))

vi.mock('naive-ui', () => ({
  NAlert: { template: '<section class="n-alert"><slot /></section>' },
  NButton: { props: ['disabled', 'loading'], template: '<button type="button" :disabled="disabled"><slot name="icon" /><slot /></button>' },
  NCard: {
    props: ['title'],
    template: `
      <section class="n-card">
        <header v-if="title || $slots['header-extra']" class="n-card-header">
          <span v-if="title">{{ title }}</span>
          <slot name="header-extra" />
        </header>
        <div class="n-card__content"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </section>
    `,
  },
  NEmpty: { props: ['description'], template: '<div class="n-empty">{{ description }}</div>' },
  NForm: { template: '<form><slot /></form>' },
  NFormItem: { template: '<label><slot /></label>' },
  NGrid: { template: '<div class="n-grid"><slot /></div>' },
  NGridItem: { template: '<div class="n-grid-item"><slot /></div>' },
  NIcon: { template: '<i><slot /></i>' },
  NInput: {
    inheritAttrs: false,
    props: ['value', 'placeholder', 'type', 'size'],
    emits: ['update:value', 'keydown'],
    template: `
      <textarea
        v-if="type === 'textarea'"
        :placeholder="placeholder"
        :value="value"
        @input="$emit('update:value', $event.target.value)"
        @keydown="$emit('keydown', $event)"
      />
      <input
        v-else
        :placeholder="placeholder"
        :value="value"
        @input="$emit('update:value', $event.target.value)"
        @keydown="$emit('keydown', $event)"
      />
    `,
  },
  NModal: { template: '<div><slot /><slot name="footer" /></div>' },
  NPopconfirm: { template: '<span><slot name="trigger" /><slot /></span>' },
  NSelect: {
    props: ['value', 'options'],
    emits: ['update:value'],
    template: '<div class="n-select"><slot /></div>',
  },
  NSpace: { template: '<div class="n-space"><slot /></div>' },
  NSpin: { template: '<div><slot /></div>' },
  NSwitch: { template: '<input type="checkbox" />' },
  NTag: { template: '<span class="n-tag"><slot /></span>' },
  NText: { template: '<span><slot /></span>' },
  NTooltip: { template: '<span><slot name="trigger" /><slot /></span>' },
  useMessage: () => ({
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}))

vi.mock('@vicons/ionicons5', () => ({
  CopyOutline: {},
  RefreshOutline: {},
  SendOutline: {},
  StopCircleOutline: {},
  ChevronBackOutline: {},
  ChevronForwardOutline: {},
  VolumeHighOutline: {},
  StopOutline: {},
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    locale: { value: 'zh-CN' },
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/stores/chat', () => ({ useChatStore: () => mocks.chatStore }))
vi.mock('@/stores/config', () => ({ useConfigStore: () => mocks.configStore }))
vi.mock('@/stores/session', () => ({ useSessionStore: () => mocks.sessionStore }))
vi.mock('@/stores/skill', () => ({ useSkillStore: () => mocks.skillStore }))
vi.mock('@/stores/websocket', () => ({ useWebSocketStore: () => mocks.wsStore }))
vi.mock('@/stores/desktop', () => ({ useDesktopStore: () => mocks.desktopStore }))

vi.mock('@/utils/format', () => ({
  formatDate: (value: string) => value,
  formatRelativeTime: () => 'just now',
  parseSessionKey: () => ({ agent: 'main', channel: 'web', peer: 'local' }),
  truncate: (value: string) => value,
}))

vi.mock('@/utils/markdown', () => ({
  renderSimpleMarkdown: (value: string) => value,
}))

vi.mock('@/utils/desktop-host', () => ({
  createDesktopScreenshotDraft: vi.fn(),
  getCrawClawDesktopHost: () => null,
}))

vi.mock('@/composables/useEdgeTTS', () => ({
  useEdgeTTS: () => ({
    speak: vi.fn(async () => undefined),
    stop: vi.fn(),
    isPlaying: { value: false },
    isLoading: { value: false },
  }),
}))

vi.mock('@/composables/useTTSSettings', () => ({
  useTTSSettings: () => ({
    settings: { value: { enabled: false, autoPlay: false } },
  }),
}))

async function mountChatPage() {
  const wrapper = mount(ChatPage)
  await flushPromises()
  return wrapper
}

describe('ChatPage desktop simple mode', () => {
  beforeEach(() => {
    mocks.desktopStore.isDesktopMode = true
    mocks.desktopStore.advancedMode = false
    mocks.chatStore.messages = [
      { id: 'user-1', role: 'user', content: 'hello', timestamp: '2026-05-08T00:00:00Z' },
      { id: 'tool-1', role: 'tool', content: 'internal tool output', timestamp: '2026-05-08T00:00:01Z' },
      {
        id: 'assistant-tool-1',
        role: 'assistant',
        content: '',
        timestamp: '2026-05-08T00:00:02Z',
        rawContent: [{ type: 'tool_call', name: 'exec', arguments: { cmd: 'pwd' } }],
      },
      { id: 'assistant-1', role: 'assistant', content: 'hi there', timestamp: '2026-05-08T00:00:03Z' },
    ]
    mocks.chatStore.sessionKey = ''
    mocks.chatStore.loading = false
    mocks.chatStore.syncing = false
    mocks.chatStore.sending = false
    mocks.chatStore.lastError = null
    mocks.chatStore.lastSyncedAt = null
    mocks.chatStore.agentSteps = new Map()
    mocks.chatStore.toolProgress = new Map()
    mocks.chatStore.getOrCreateAgentStatus.mockReturnValue(baseAgentStatus())
    mocks.chatStore.setSessionKey.mockClear()
    mocks.chatStore.fetchHistory.mockClear()
    mocks.chatStore.clearTimers.mockClear()
    mocks.configStore.fetchConfig.mockClear()
    mocks.sessionStore.fetchSessions.mockClear()
    mocks.skillStore.fetchSkills.mockClear()
    mocks.wsStore.subscribe.mockClear()
    localStorage.clear()
  })

  it('hides advanced chat controls and keeps only conversational content in desktop simple mode', async () => {
    const wrapper = await mountChatPage()

    expect(wrapper.classes()).toContain('chat-page--simple')
    expect(wrapper.find('.chat-grid-side').exists()).toBe(false)
    expect(wrapper.find('.chat-token-metrics').exists()).toBe(false)
    expect(wrapper.find('.chat-bubble-meta').exists()).toBe(false)
    expect(wrapper.find('.chat-content-copy-btn').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('pages.chat.actions.clearInput')
    expect(wrapper.text()).not.toContain('pages.chat.quickReplies.title')
    expect(wrapper.text()).not.toContain('pages.chat.filters.title')
    expect(wrapper.text()).not.toContain('pages.chat.sessionTag')
    expect(wrapper.text()).not.toContain('pages.chat.structured.toolCall')
    expect(wrapper.text()).not.toContain('internal tool output')
    expect(wrapper.text()).toContain('hello')
    expect(wrapper.text()).toContain('hi there')
    expect(wrapper.find('textarea').attributes('placeholder')).toBe('pages.chat.input.simplePlaceholder')
    expect(wrapper.text()).toContain('pages.chat.input.simpleSendHint')
  })

  it('keeps advanced chat controls available in desktop advanced mode', async () => {
    mocks.desktopStore.advancedMode = true

    const wrapper = await mountChatPage()

    expect(wrapper.classes()).not.toContain('chat-page--simple')
    expect(wrapper.find('.chat-grid-side').exists()).toBe(true)
    expect(wrapper.find('.chat-bubble-meta').exists()).toBe(true)
    expect(wrapper.find('.chat-content-copy-btn').exists()).toBe(true)
    expect(wrapper.text()).toContain('pages.chat.actions.clearInput')
    expect(wrapper.text()).toContain('pages.chat.quickReplies.title')
    expect(wrapper.text()).toContain('pages.chat.filters.title')
    expect(wrapper.text()).toContain('pages.chat.sessionTag')
    expect(wrapper.text()).toContain('pages.chat.structured.toolCall')
    expect(wrapper.find('textarea').attributes('placeholder')).toBe('pages.chat.input.placeholder')
  })
})

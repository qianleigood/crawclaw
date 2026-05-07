// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage.vue'
import { ConnectionState } from '@/api/types'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  desktopStore: {
    capability: vi.fn(() => ({ available: true, platform: 'darwin' })),
    ensureCapabilitiesLoaded: vi.fn(),
    refreshCapabilities: vi.fn(),
  },
}))

vi.mock('naive-ui', () => ({
  NCard: { props: ['title'], template: '<section><h2>{{ title }}</h2><slot name="header-extra" /><slot /></section>' },
  NSpace: { template: '<div><slot /></div>' },
  NSelect: { template: '<div />' },
  NText: { template: '<span><slot /></span>' },
  NAlert: { template: '<div><slot /></div>' },
  NForm: { template: '<form><slot /></form>' },
  NFormItem: { template: '<label><slot /></label>' },
  NInput: { template: '<input />' },
  NButton: { template: '<button v-bind="$attrs"><slot /></button>' },
  NSpin: { template: '<div><slot /></div>' },
  useMessage: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({
    mode: 'light',
    setMode: vi.fn(),
  }),
}))

vi.mock('@/stores/websocket', () => ({
  useWebSocketStore: () => ({
    state: ConnectionState.CONNECTED,
    reconnectAttempts: 0,
    lastError: null,
  }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    getToken: () => 'token-1',
  }),
}))

vi.mock('@/stores/desktop', () => ({
  useDesktopStore: () => mocks.desktopStore,
}))

describe('SettingsPage desktop capabilities', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, config: {} })))
    mocks.desktopStore.ensureCapabilitiesLoaded.mockReset()
    mocks.desktopStore.refreshCapabilities.mockReset()
    mocks.desktopStore.capability.mockReturnValue({ available: true, platform: 'darwin' })
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('shows desktop release update mode in Settings when desktop updates are available', async () => {
    const wrapper = mount(SettingsPage)

    await flushPromises()

    expect(wrapper.text()).toContain('pages.settings.desktopUpdateMode')
    expect(wrapper.text()).toContain('components.connectionStatus.desktopUpdateMessage')
  })
})

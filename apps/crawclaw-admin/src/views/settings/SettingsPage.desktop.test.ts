// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage.vue'
import { ConnectionState } from '@/api/types'
import type { DesktopOptionalRuntime } from '@/api/types'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  desktopStore: {
    capability: vi.fn(() => ({ available: true, platform: 'darwin' })),
    ensureCapabilitiesLoaded: vi.fn(),
    refreshCapabilities: vi.fn(),
    isDesktopMode: true,
    advancedMode: false,
    runtimeStatus: null,
    runtimeLogs: '',
    runtimeLoading: false,
    runtimeLastError: null,
    optionalRuntimes: [] as DesktopOptionalRuntime[],
    optionalRuntimesLoading: false,
    optionalRuntimesLastError: null,
    refreshRuntimeStatus: vi.fn(),
    bootstrapRuntime: vi.fn(),
    startGatewayService: vi.fn(),
    stopGatewayService: vi.fn(),
    restartGatewayService: vi.fn(),
    tailRuntimeLogs: vi.fn(),
    refreshOptionalRuntimes: vi.fn(),
    installOptionalRuntime: vi.fn(),
    setAdvancedMode: vi.fn(),
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
  NTag: { template: '<span><slot /></span>' },
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
    mocks.desktopStore.refreshRuntimeStatus.mockReset()
    mocks.desktopStore.bootstrapRuntime.mockReset()
    mocks.desktopStore.startGatewayService.mockReset()
    mocks.desktopStore.stopGatewayService.mockReset()
    mocks.desktopStore.restartGatewayService.mockReset()
    mocks.desktopStore.tailRuntimeLogs.mockReset()
    mocks.desktopStore.refreshOptionalRuntimes.mockReset()
    mocks.desktopStore.installOptionalRuntime.mockReset()
    mocks.desktopStore.setAdvancedMode.mockReset()
    mocks.desktopStore.isDesktopMode = true
    mocks.desktopStore.advancedMode = false
    mocks.desktopStore.runtimeStatus = null
    mocks.desktopStore.runtimeLogs = ''
    mocks.desktopStore.runtimeLoading = false
    mocks.desktopStore.runtimeLastError = null
    mocks.desktopStore.optionalRuntimes = [
      { id: 'n8n', name: 'n8n', state: 'not-installed', installed: false },
      { id: 'skill-openai-whisper', name: 'Whisper', state: 'not-installed', installed: false },
      { id: 'qwen3-tts', name: 'Qwen3-TTS', state: 'not-installed', installed: false },
    ]
    mocks.desktopStore.optionalRuntimesLoading = false
    mocks.desktopStore.optionalRuntimesLastError = null
    mocks.desktopStore.capability.mockReturnValue({ available: true, platform: 'darwin' })
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('shows desktop release update mode in Settings when desktop updates are available', async () => {
    const wrapper = mount(SettingsPage)

    await flushPromises()

    expect(wrapper.text()).toContain('pages.settings.desktopUpdateMode')
    expect(wrapper.text()).toContain('components.connectionStatus.desktopUpdateMessage')
  })

  it('omits secret-bearing fields when saving desktop config', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          ok: true,
          config: {
            AUTH_USERNAME: 'admin',
            AUTH_PASSWORD: 'admin-password',
            CRAWCLAW_WS_URL: 'ws://gateway:18789',
            CRAWCLAW_AUTH_TOKEN: 'gateway-token',
            CRAWCLAW_AUTH_PASSWORD: 'gateway-password',
          },
        }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))

    const wrapper = mount(SettingsPage)

    await flushPromises()

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'pages.settings.save')
    expect(saveButton).toBeDefined()
    await saveButton!.trigger('click')
    await flushPromises()

    const saveCall = mocks.fetch.mock.calls[1]
    expect(saveCall).toBeDefined()
    const [, request] = saveCall!
    expect(JSON.parse(request.body)).toEqual({
      AUTH_USERNAME: 'admin',
    })
  })

  it('keeps desktop service controls out of simple Settings', async () => {
    const wrapper = mount(SettingsPage)

    await flushPromises()

    expect(wrapper.text()).not.toContain('pages.settings.connectionSettings')
    expect(wrapper.text()).toContain('pages.settings.desktopExperience')
    expect(wrapper.text()).toContain('pages.settings.advancedMode')
    expect(wrapper.text()).not.toContain('pages.settings.gatewayService')
    expect(wrapper.text()).not.toContain('pages.settings.serviceStart')
    expect(wrapper.text()).not.toContain('pages.settings.serviceLogs')
  })

  it('shows desktop Gateway service controls in advanced Settings', async () => {
    mocks.desktopStore.advancedMode = true
    const wrapper = mount(SettingsPage)

    await flushPromises()

    expect(wrapper.text()).toContain('pages.settings.gatewayService')
    expect(wrapper.text()).toContain('pages.settings.runtimeStatus')
    expect(wrapper.text()).toContain('pages.settings.serviceStart')
    expect(wrapper.text()).toContain('pages.settings.serviceStop')
    expect(wrapper.text()).toContain('pages.settings.serviceRestart')
    expect(wrapper.text()).toContain('pages.settings.serviceLogs')
  })

  it('shows optional desktop runtime components in Settings', async () => {
    mocks.desktopStore.advancedMode = true
    const wrapper = mount(SettingsPage)

    await flushPromises()

    expect(wrapper.text()).toContain('pages.settings.optionalComponents')
    expect(wrapper.text()).toContain('n8n')
    expect(wrapper.text()).toContain('Whisper')
    expect(wrapper.text()).toContain('Qwen3-TTS')
    expect(wrapper.text()).toContain('pages.settings.installRuntime')
  })
})

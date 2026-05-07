// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionStatus from './ConnectionStatus.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  wsStore: {
    state: 'connected',
    gatewayVersion: '1.0.0',
    updateAvailable: null as { latestVersion: string } | null,
    subscribe: vi.fn(() => () => {}),
  },
  desktopStore: {
    capability: vi.fn((): { available: boolean; platform: string } | null => ({ available: true, platform: 'darwin' })),
    ensureCapabilitiesLoaded: vi.fn(),
    loaded: true,
  },
}))

vi.mock('naive-ui', () => ({
  NTag: { template: '<span><slot /></span>' },
  NSpace: { template: '<div><slot /></div>' },
  NButton: { template: '<button v-bind="$attrs"><slot /></button>' },
  NSelect: { template: '<div />' },
  NPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
  useMessage: () => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'components.connectionStatus.newVersionAvailable') {
        return `New version ${String(params?.version ?? '')}`
      }
      return key
    },
  }),
}))

vi.mock('@fortawesome/vue-fontawesome', () => ({
  FontAwesomeIcon: { template: '<span />' },
}))

vi.mock('@/stores/websocket', () => ({
  useWebSocketStore: () => mocks.wsStore,
}))

vi.mock('@/stores/hermes/connection', () => ({
  useHermesConnectionStore: () => ({
    currentGateway: 'crawclaw',
    hermesConnected: false,
    hermesConnecting: false,
  }),
}))

vi.mock('@/stores/desktop', () => ({
  useDesktopStore: () => mocks.desktopStore,
}))

describe('ConnectionStatus desktop update mode', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ versions: ['1.0.1'], latestVersion: '1.0.1' })))
    mocks.wsStore.updateAvailable = null
    mocks.wsStore.subscribe.mockClear()
    mocks.desktopStore.ensureCapabilitiesLoaded.mockReset()
    mocks.desktopStore.ensureCapabilitiesLoaded.mockResolvedValue(null)
    mocks.desktopStore.loaded = true
    mocks.desktopStore.capability.mockReturnValue({ available: true, platform: 'darwin' })
    vi.stubGlobal('fetch', mocks.fetch)
  })

  it('does not fetch npm versions when desktop updates are handled by releases', async () => {
    mount(ConnectionStatus)

    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('waits for desktop capabilities before checking npm versions', async () => {
    let resolveCapabilities: (value: null) => void = () => {}
    let loaded = false
    mocks.desktopStore.loaded = false
    mocks.desktopStore.ensureCapabilitiesLoaded.mockReturnValue(
      new Promise<null>((resolve) => {
        resolveCapabilities = resolve
      })
    )
    mocks.desktopStore.capability.mockImplementation(() => (
      loaded ? { available: true, platform: 'darwin' } : null
    ))

    mount(ConnectionStatus)
    await Promise.resolve()

    expect(mocks.fetch).not.toHaveBeenCalled()

    loaded = true
    mocks.desktopStore.loaded = true
    resolveCapabilities(null)
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('unsubscribes from websocket updates on unmount', async () => {
    const unsubscribe = vi.fn()
    mocks.wsStore.subscribe.mockReturnValueOnce(unsubscribe)

    const wrapper = mount(ConnectionStatus)
    await flushPromises()

    expect(mocks.wsStore.subscribe).toHaveBeenCalledWith('connected', expect.any(Function))

    wrapper.unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

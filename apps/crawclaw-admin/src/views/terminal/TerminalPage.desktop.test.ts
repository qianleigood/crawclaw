// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalPage from './TerminalPage.vue'

const mocks = vi.hoisted(() => ({
  listNodes: vi.fn(),
  ensureCapabilitiesLoaded: vi.fn(),
  capabilityUnavailableReason: vi.fn(),
}))

vi.mock('naive-ui', () => ({
  NAlert: { template: '<div><slot /></div>' },
  NButton: { template: '<button v-bind="$attrs"><slot /></button>' },
  NCard: { props: ['title'], template: '<section><h2>{{ title }}</h2><slot name="header-extra" /><slot /></section>' },
  NFormItem: { template: '<label><slot /></label>' },
  NIcon: { template: '<span><slot /></span>' },
  NInput: { template: '<input />' },
  NInputNumber: { template: '<input />' },
  NSelect: { template: '<div />' },
  NSpace: { template: '<div><slot /></div>' },
  NTag: { template: '<span><slot /></span>' },
  NText: { template: '<span><slot /></span>' },
  NSpin: { template: '<div><slot /></div>' },
  useMessage: () => ({
    success: vi.fn(),
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/stores/terminal', () => ({
  useTerminalStore: () => ({
    isConnected: false,
    isConnecting: false,
    hasError: false,
    currentSession: null,
    error: null,
    config: { cols: 120, rows: 36 },
    setConfig: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendInput: vi.fn(),
    resize: vi.fn(),
    onOutput: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
  }),
}))

vi.mock('@/stores/websocket', () => ({
  useWebSocketStore: () => ({
    rpc: {
      listNodes: mocks.listNodes,
    },
  }),
}))

vi.mock('@/stores/desktop', () => ({
  useDesktopStore: () => ({
    ensureCapabilitiesLoaded: mocks.ensureCapabilitiesLoaded,
    capabilityUnavailableReason: mocks.capabilityUnavailableReason,
  }),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    onData() {}
    onResize() {}
    onSelectionChange() {}
    write() {}
    dispose() {}
    clear() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}))

describe('TerminalPage desktop capabilities', () => {
  beforeEach(() => {
    mocks.listNodes.mockReset()
    mocks.ensureCapabilitiesLoaded.mockResolvedValue(null)
    mocks.capabilityUnavailableReason.mockReturnValue('Terminal is unavailable on this platform.')
  })

  it('shows a disabled shell and skips terminal initialization when terminal capability is unavailable', async () => {
    const wrapper = mount(TerminalPage)

    await flushPromises()

    expect(wrapper.text()).toContain('Terminal is unavailable on this platform.')
    expect(mocks.listNodes).not.toHaveBeenCalled()
  })
})

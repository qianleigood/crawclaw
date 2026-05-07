// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const hermesStore = {
    currentGateway: 'crawclaw',
    connect: vi.fn(),
    disconnect: vi.fn(),
  }

  return {
    wsConnect: vi.fn(),
    wsDisconnect: vi.fn(),
    ensureCapabilitiesLoaded: vi.fn(),
    isDesktopLocal: false,
    route: { meta: { gateway: 'crawclaw' } as Record<string, unknown> },
    routerReplace: vi.fn(),
    routerPush: vi.fn(),
    hermesStore,
  }
})

vi.mock('naive-ui', () => {
  const LayoutStub = {
    setup(_: unknown, { slots }: { slots: { default?: () => unknown } }) {
      return () => slots.default?.()
    },
  }

  return {
    NLayout: LayoutStub,
    NLayoutSider: LayoutStub,
    NLayoutHeader: LayoutStub,
    NLayoutContent: LayoutStub,
  }
})

vi.mock('@/components/layout/AppHeader.vue', () => ({
  default: { render: () => null },
}))

vi.mock('@/components/layout/AppSidebar.vue', () => ({
  default: { render: () => null },
}))

vi.mock('@/stores/websocket', () => ({
  useWebSocketStore: () => ({
    connect: mocks.wsConnect,
    disconnect: mocks.wsDisconnect,
  }),
}))

vi.mock('@/stores/hermes/connection', () => ({
  useHermesConnectionStore: () => mocks.hermesStore,
}))

vi.mock('@/stores/desktop', () => ({
  useDesktopStore: () => ({
    ensureCapabilitiesLoaded: mocks.ensureCapabilitiesLoaded,
    isDesktopLocal: mocks.isDesktopLocal,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({
    replace: mocks.routerReplace,
    push: mocks.routerPush,
  }),
}))

import DefaultLayout from './DefaultLayout.vue'

describe('DefaultLayout desktop capabilities', () => {
  beforeEach(() => {
    mocks.wsConnect.mockReset()
    mocks.wsDisconnect.mockReset()
    mocks.hermesStore.connect.mockReset()
    mocks.hermesStore.disconnect.mockReset()
    mocks.ensureCapabilitiesLoaded.mockReset()
    mocks.routerReplace.mockReset()
    mocks.routerPush.mockReset()
    mocks.route.meta = { gateway: 'crawclaw' }
    mocks.hermesStore.currentGateway = 'crawclaw'
    mocks.isDesktopLocal = false
  })

  it('loads desktop capabilities once when the authenticated CrawClaw layout boots', async () => {
    mount(DefaultLayout, {
      global: {
        stubs: {
          RouterView: true,
        },
      },
    })

    await nextTick()

    expect(mocks.wsConnect).toHaveBeenCalledTimes(1)
    expect(mocks.ensureCapabilitiesLoaded).toHaveBeenCalledTimes(1)
  })

  it('forces CrawClaw mode in desktop-local mode and does not connect Hermes', async () => {
    mocks.isDesktopLocal = true
    mocks.hermesStore.currentGateway = 'hermes'
    mocks.route.meta = { gateway: 'hermes' }

    mount(DefaultLayout, {
      global: {
        stubs: {
          RouterView: true,
        },
      },
    })

    await nextTick()

    expect(mocks.hermesStore.currentGateway).toBe('crawclaw')
    expect(mocks.wsConnect).toHaveBeenCalledTimes(1)
    expect(mocks.hermesStore.connect).not.toHaveBeenCalled()
    expect(mocks.routerReplace).toHaveBeenCalledWith('/')
  })
})

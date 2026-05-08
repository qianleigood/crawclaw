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
    isDesktopMode: true,
    onboardingComplete: true,
    route: { name: 'Dashboard', meta: { gateway: 'crawclaw' } as Record<string, unknown> },
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
    NLayoutSider: {
      props: ['collapsed'],
      template: '<aside data-test="layout-sider" :data-collapsed="String(collapsed)"><slot /></aside>',
    },
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
    isDesktopMode: mocks.isDesktopMode,
    onboardingComplete: mocks.onboardingComplete,
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
    mocks.route.name = 'Dashboard'
    mocks.hermesStore.currentGateway = 'crawclaw'
    mocks.isDesktopMode = true
    mocks.onboardingComplete = true
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1024,
    })
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

  it('does not start Hermes when desktop-local mode locks the app to CrawClaw', async () => {
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

    expect(mocks.hermesStore.connect).not.toHaveBeenCalled()
    expect(mocks.wsConnect).toHaveBeenCalledTimes(1)
    expect(mocks.routerReplace).toHaveBeenCalledWith('/')
  })

  it('sends first-run desktop users to onboarding before the workbench', async () => {
    mocks.onboardingComplete = false
    mocks.route.name = 'Dashboard'

    mount(DefaultLayout, {
      global: {
        stubs: {
          RouterView: true,
        },
      },
    })

    await nextTick()

    expect(mocks.routerReplace).toHaveBeenCalledWith({ name: 'DesktopOnboarding' })
  })

  it('keeps the desktop sidebar expanded and relies on the fixed minimum desktop width', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    })

    const wrapper = mount(DefaultLayout, {
      global: {
        stubs: {
          RouterView: true,
        },
      },
    })

    await nextTick()

    expect(wrapper.find('[data-test="layout-sider"]').attributes('data-collapsed')).toBe('false')
  })
})

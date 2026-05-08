// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppHeader from './AppHeader.vue'

const mocks = vi.hoisted(() => ({
  desktopStore: {
    isDesktopMode: true,
  },
}))

vi.mock('naive-ui', () => ({
  NBreadcrumb: { template: '<nav><slot /></nav>' },
  NBreadcrumbItem: { template: '<span><slot /></span>' },
  NButton: { template: '<button><slot name="icon" /><slot /></button>' },
  NSpace: { template: '<div><slot /></div>' },
  NTooltip: { template: '<span><slot name="trigger" /><slot /></span>' },
  NIcon: { template: '<i />' },
}))

vi.mock('@vicons/ionicons5', () => ({
  SunnyOutline: {},
  MoonOutline: {},
  LogOutOutline: {},
  LanguageOutline: {},
  ExpandOutline: {},
  ContractOutline: {},
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'Dashboard', meta: { titleKey: 'routes.dashboard' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/composables/useTheme', () => ({
  useTheme: () => ({ isDark: false, toggle: vi.fn() }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ logout: vi.fn() }),
}))

vi.mock('@/stores/locale', () => ({
  useLocaleStore: () => ({ locale: 'en-US', toggle: vi.fn() }),
}))

vi.mock('@/stores/websocket', () => ({
  useWebSocketStore: () => ({ disconnect: vi.fn() }),
}))

vi.mock('@/stores/wideMode', () => ({
  useWideModeStore: () => ({ isWideMode: false, toggle: vi.fn() }),
}))

vi.mock('@/stores/desktop', () => ({
  useDesktopStore: () => mocks.desktopStore,
}))

vi.mock('@/components/common/ConnectionStatus.vue', () => ({
  default: { template: '<div data-test="connection-status" />' },
}))

vi.mock('@/components/common/GatewaySwitcher.vue', () => ({
  default: { template: '<div data-test="gateway-switcher" />' },
}))

describe('AppHeader desktop mode', () => {
  it('hides the Gateway switcher in CrawClaw Desktop', () => {
    const wrapper = mount(AppHeader)

    expect(wrapper.find('[data-test="connection-status"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="gateway-switcher"]').exists()).toBe(false)
  })

  it('uses a compact desktop toolbar title instead of a breadcrumb trail', () => {
    const wrapper = mount(AppHeader)

    expect(wrapper.text()).toContain('routes.dashboard')
    expect(wrapper.text()).not.toContain('common.home')
  })
})

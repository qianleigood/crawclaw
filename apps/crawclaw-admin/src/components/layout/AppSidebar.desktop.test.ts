// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AppSidebar from './AppSidebar.vue'

const mocks = vi.hoisted(() => ({
  desktopStore: {
    isDesktopMode: true,
    advancedMode: false,
  },
}))

vi.mock('naive-ui', () => ({
  NMenu: {
    props: ['options'],
    template: `
      <nav>
        <section v-for="option in options" :key="option.key || option.label">
          <strong v-if="option.type === 'group'">{{ option.label }}</strong>
          <span v-else>{{ option.label }}</span>
          <span v-for="child in option.children || []" :key="child.key">{{ child.label }}</span>
        </section>
      </nav>
    `,
  },
  NText: { template: '<strong><slot /></strong>' },
  NIcon: { template: '<i />' },
}))

vi.mock('@vicons/ionicons5', () => ({
  GridOutline: {},
  ChatboxEllipsesOutline: {},
  ChatbubblesOutline: {},
  BookOutline: {},
  CalendarOutline: {},
  SparklesOutline: {},
  GitNetworkOutline: {},
  ExtensionPuzzleOutline: {},
  CogOutline: {},
  PulseOutline: {},
  FolderOutline: {},
  PeopleOutline: {},
  BusinessOutline: {},
  StorefrontOutline: {},
  ConstructOutline: {},
  TerminalOutline: {},
  DesktopOutline: {},
  ArchiveOutline: {},
  SettingsOutline: {},
  CodeSlashOutline: {},
  ImagesOutline: {},
  HardwareChipOutline: {},
  VolumeHighOutline: {},
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'Dashboard' }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/stores/hermes/connection', () => ({
  useHermesConnectionStore: () => ({ currentGateway: 'crawclaw' }),
}))

vi.mock('@/stores/desktop', () => ({
  useDesktopStore: () => mocks.desktopStore,
}))

describe('AppSidebar desktop mode', () => {
  it('uses the CrawClaw Desktop product name', () => {
    const wrapper = mount(AppSidebar, { props: { collapsed: false } })

    expect(wrapper.text()).toContain('CrawClaw Desktop')
    expect(wrapper.text()).not.toContain('CrawClaw Admin')
    expect(wrapper.text()).not.toContain('🦀')
  })

  it('keeps expert routes out of the default desktop sidebar', () => {
    mocks.desktopStore.advancedMode = false
    const wrapper = mount(AppSidebar, { props: { collapsed: false } })

    expect(wrapper.text()).toContain('routes.nav.daily')
    expect(wrapper.text()).toContain('routes.nav.setup')
    expect(wrapper.text()).toContain('routes.dashboard')
    expect(wrapper.text()).toContain('routes.chat')
    expect(wrapper.text()).toContain('routes.models')
    expect(wrapper.text()).toContain('routes.channels')
    expect(wrapper.text()).toContain('routes.settings')
    expect(wrapper.text()).not.toContain('routes.terminal')
    expect(wrapper.text()).not.toContain('routes.files')
    expect(wrapper.text()).not.toContain('routes.monitor')
    expect(wrapper.text()).not.toContain('routes.backup')
  })

  it('shows expert routes after advanced mode is enabled', () => {
    mocks.desktopStore.advancedMode = true
    const wrapper = mount(AppSidebar, { props: { collapsed: false } })

    expect(wrapper.text()).toContain('routes.nav.advanced')
    expect(wrapper.text()).toContain('routes.terminal')
    expect(wrapper.text()).toContain('routes.files')
    expect(wrapper.text()).toContain('routes.monitor')
    expect(wrapper.text()).toContain('routes.backup')
  })
})

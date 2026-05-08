// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  completeOnboarding: vi.fn(),
  setAdvancedMode: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/stores/desktop', () => ({
  useDesktopStore: () => ({
    completeOnboarding: mocks.completeOnboarding,
    setAdvancedMode: mocks.setAdvancedMode,
  }),
}))

vi.mock('naive-ui', () => ({
  NButton: {
    template: '<button type="button" v-bind="$attrs"><slot /></button>',
  },
  NCard: {
    template: '<section><slot /><slot name="header-extra" /></section>',
  },
  NText: {
    template: '<span><slot /></span>',
  },
}))

import DesktopOnboardingPage from './DesktopOnboardingPage.vue'

describe('DesktopOnboardingPage', () => {
  beforeEach(() => {
    mocks.routerPush.mockReset()
    mocks.completeOnboarding.mockReset()
    mocks.setAdvancedMode.mockReset()
  })

  it('starts first-run users in chat without forcing setup', async () => {
    const wrapper = mount(DesktopOnboardingPage)

    await wrapper.find('.desktop-onboarding__button').trigger('click')

    expect(mocks.completeOnboarding).toHaveBeenCalledTimes(1)
    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'Chat' })
  })

  it('lets users choose a model or connect channels from setup assistant', async () => {
    const wrapper = mount(DesktopOnboardingPage)
    const actionButtons = wrapper.findAll('.desktop-onboarding__actions button')
    const modelButton = actionButtons[1]
    const channelsButton = actionButtons[2]

    if (!modelButton || !channelsButton) {
      throw new Error('Expected setup assistant model and channel action buttons')
    }

    await modelButton.trigger('click')
    await channelsButton.trigger('click')

    expect(mocks.completeOnboarding).toHaveBeenCalledTimes(2)
    expect(mocks.routerPush).toHaveBeenNthCalledWith(1, { name: 'Models' })
    expect(mocks.routerPush).toHaveBeenNthCalledWith(2, { name: 'Channels' })
  })

  it('enables advanced mode only when users choose the advanced setup entry', async () => {
    const wrapper = mount(DesktopOnboardingPage)
    const setupSteps = wrapper.findAll('.desktop-onboarding__step')
    const advancedStep = setupSteps[2]

    if (!advancedStep) {
      throw new Error('Expected setup assistant advanced mode entry')
    }

    await advancedStep.trigger('click')

    expect(mocks.setAdvancedMode).toHaveBeenCalledWith(true)
    expect(mocks.completeOnboarding).toHaveBeenCalledTimes(1)
    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'Settings' })
  })
})

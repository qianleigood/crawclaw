import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/messages/en-US'
import zhCN from '@/i18n/messages/zh-CN'
import { resolveChannelTemplate } from '@/utils/channel-config'
import channelsPageSource from './ChannelsPage.vue?raw'

describe('ChannelsPage Weixin entry', () => {
  it('shows Weixin as a primary channel with the bundled plugin install spec', () => {
    expect(channelsPageSource).toContain("key: 'weixin'")
    expect(channelsPageSource).toContain("pluginPackages: ['@crawclaw/weixin']")
    expect(channelsPageSource).toContain("pluginIds: ['weixin']")
    expect(channelsPageSource).toContain('https://docs.crawclaw.ai/channels/weixin')
  })

  it('uses the weixin config key and localized channel copy', () => {
    expect(resolveChannelTemplate('weixin')?.key).toBe('weixin')
    expect(enUS.pages.channels.guides.weixin).toBe('Weixin guide')
    expect(enUS.pages.channels.channels.weixin.label).toBe('Weixin')
    expect(zhCN.pages.channels.guides.weixin).toBe('微信 教学')
    expect(zhCN.pages.channels.channels.weixin.label).toBe('微信')
  })
})

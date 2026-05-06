import { describe, expect, it } from 'vitest'
import zhCN from '@/i18n/messages/zh-CN'
import monitorSource from './MonitorPage.vue?raw'

describe('MonitorPage Chinese labels', () => {
  it('localizes the health probe action and labels', () => {
    const diag = zhCN.pages.monitor.diag as Record<string, string>

    expect(diag.probeAction).toBe('深度探测')
    expect(diag.hint).toContain('深度探测')
    expect(diag.probeResult).toBe('探测结果')
    expect(diag.lastProbeAt).toContain('最近探测')
    expect(monitorSource).toContain("t('pages.monitor.diag.probeAction')")
  })
})

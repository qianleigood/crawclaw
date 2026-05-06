import { describe, expect, it } from 'vitest'
import monitorSource from '@/views/monitor/MonitorPage.vue?raw'
import { routes } from './routes'

describe('monitor route consolidation', () => {
  it('keeps observability as the only visible monitor entry', () => {
    const mainRoute = routes.find((route) => route.path === '/')
    const children = mainRoute?.children || []
    const systemRoute = children.find((route) => route.name === 'System')
    const monitorRoute = children.find((route) => route.name === 'Monitor')

    expect(systemRoute?.redirect).toEqual({ name: 'Monitor' })
    expect(systemRoute?.meta?.hidden).toBe(true)
    expect(monitorRoute?.meta?.titleKey).toBe('routes.monitor')
  })

  it('renders legacy host metrics inside MonitorPage', () => {
    expect(monitorSource).toContain('/api/system/metrics')
    expect(monitorSource).toContain('pages.monitor.host.cpu')
    expect(monitorSource).not.toContain("name=\"host\"")
  })
})

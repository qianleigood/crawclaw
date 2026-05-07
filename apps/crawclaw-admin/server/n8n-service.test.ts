import { describe, expect, it } from 'vitest'
import { N8nService } from './n8n-service.js'

describe('N8nService runtime env updates', () => {
  it('restarts a running managed process when requested', async () => {
    const service = new N8nService({ CRAWCLAW_N8N_MANAGED: 'true' })
    let restartedLocale = ''
    service.process = { killed: false }
    service.restart = async (locale) => {
      restartedLocale = locale
    }

    await service.updateEnv(
      { CRAWCLAW_N8N_MANAGED: 'true', CRAWCLAW_N8N_PORT: '5680' },
      { restartManaged: true, locale: 'zh-CN' }
    )

    expect(service.env.CRAWCLAW_N8N_PORT).toBe('5680')
    expect(restartedLocale).toBe('zh-CN')
  })

  it('clears stale external running state when env changes', async () => {
    const service = new N8nService({ CRAWCLAW_N8N_MANAGED: 'true', CRAWCLAW_N8N_PORT: '5679' })
    service.externalRunning = true

    await service.updateEnv({ CRAWCLAW_N8N_MANAGED: 'true', CRAWCLAW_N8N_PORT: '5680' })

    expect(service.externalRunning).toBe(false)
  })
})

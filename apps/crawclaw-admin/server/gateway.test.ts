import { describe, expect, it } from 'vitest'
import { CrawClawGateway } from './gateway.js'

describe('CrawClawGateway disconnect', () => {
  it('does not schedule reconnect after an intentional disconnect close event', () => {
    const gateway = new CrawClawGateway('ws://localhost:18789', '', '')
    let scheduled = false

    gateway.scheduleReconnect = () => {
      scheduled = true
    }

    gateway.disconnect()
    gateway.handleDisconnect(1000, 'intentional close')

    expect(scheduled).toBe(false)
  })
})

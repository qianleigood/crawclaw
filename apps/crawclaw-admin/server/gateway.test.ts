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

  it('ignores stale close events after reconnecting the same instance', async () => {
    const gateway = new CrawClawGateway('ws://localhost:18789', '', '')
    let scheduled = false

    gateway.scheduleReconnect = () => {
      scheduled = true
    }
    gateway.ws = { close() {} }
    gateway.isConnected = true

    const staleGeneration = gateway.connectionGeneration
    gateway.disconnect()
    await gateway.connect()
    gateway.isConnected = true
    gateway.handleDisconnect(1000, 'stale close', staleGeneration)

    expect(scheduled).toBe(false)
    expect(gateway.isConnected).toBe(true)
  })
})

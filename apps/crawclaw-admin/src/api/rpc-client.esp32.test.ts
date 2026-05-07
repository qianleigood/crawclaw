import { describe, expect, it } from 'vitest'
import { RPCClient } from './rpc-client'
import type { RPCFrame, RPCResponse } from './types'

type RequestFrame = Extract<RPCFrame, { type: 'req' }>
type RpcSocket = ConstructorParameters<typeof RPCClient>[0]

class FakeWebSocket {
  readonly requests: RequestFrame[] = []
  private readonly handlers = new Map<string, Set<(response: unknown) => void>>()
  private readonly responses: Record<string, unknown>

  constructor(responses: Record<string, unknown>) {
    this.responses = responses
  }

  on(event: string, handler: (response: unknown) => void): () => void {
    const handlers = this.handlers.get(event) ?? new Set()
    handlers.add(handler)
    this.handlers.set(event, handlers)
    return () => handlers.delete(handler)
  }

  async send(frame: RPCFrame): Promise<void> {
    if (frame.type !== 'req') {return}
    this.requests.push(frame)
    const response: RPCResponse<unknown> = {
      type: 'res',
      id: frame.id,
      ok: true,
      payload: this.responses[frame.method],
    }
    this.handlers.get(`rpc:${frame.id}`)?.forEach((handler) => handler(response))
  }
}

describe('RPCClient esp32 methods', () => {
  it('starts an esp32 pairing session with normalized params', async () => {
    const ws = new FakeWebSocket({
      'esp32.pairing.start': {
        pairId: 'pair-1',
      },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    await client.startEsp32Pairing({ name: ' desk ', ttlMs: 301234.9 })

    expect(ws.requests[0]?.method).toBe('esp32.pairing.start')
    expect(ws.requests[0]?.params).toEqual({ name: 'desk', ttlMs: 301234 })
  })

  it('lists esp32 pairing requests from the items payload', async () => {
    const ws = new FakeWebSocket({
      'esp32.pairing.requests.list': {
        items: [
          {
            requestId: 'req-1',
            deviceId: 'esp32-1',
          },
        ],
      },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    const result = await client.listEsp32PairingRequests()

    expect(ws.requests[0]?.method).toBe('esp32.pairing.requests.list')
    expect(result).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        deviceId: 'esp32-1',
      }),
    ])
  })

  it('revokes an esp32 pairing session through the session endpoint', async () => {
    const ws = new FakeWebSocket({
      'esp32.pairing.session.revoke': { pairId: 'pair-1' },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    await client.revokeEsp32PairingSession('pair-1')

    expect(ws.requests[0]?.method).toBe('esp32.pairing.session.revoke')
    expect(ws.requests[0]?.params).toEqual({ pairId: 'pair-1' })
  })

  it('sends esp32 device display text through the command endpoint', async () => {
    const ws = new FakeWebSocket({
      'esp32.devices.command.send': { ok: true },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    await client.sendEsp32DisplayText('esp32-1', 'hello')

    expect(ws.requests[0]?.method).toBe('esp32.devices.command.send')
    expect(ws.requests[0]?.params).toEqual({ deviceId: 'esp32-1', text: 'hello' })
  })
})

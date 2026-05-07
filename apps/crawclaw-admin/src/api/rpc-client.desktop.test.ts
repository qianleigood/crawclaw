import { describe, expect, it } from 'vitest'
import { RPCClient } from './rpc-client'
import type { RPCFrame } from './types'

type RequestFrame = Extract<RPCFrame, { type: 'req' }>
type RpcSocket = ConstructorParameters<typeof RPCClient>[0]

class FakeWebSocket {
  readonly requests: RequestFrame[] = []

  on(): () => void {
    return () => {}
  }

  async send(frame: RPCFrame): Promise<void> {
    if (frame.type === 'req') {
      this.requests.push(frame)
    }
  }
}

describe('RPCClient desktop methods', () => {
  it('loads desktop capabilities through HTTP without Gateway RPC', async () => {
    const ws = new FakeWebSocket()
    const fetchCalls: string[] = []
    const capabilities = {
      terminal: { available: true, platform: 'darwin' },
      files: { available: true, platform: 'darwin' },
      backup: { available: true, platform: 'darwin' },
      hermesCli: {
        available: false,
        platform: 'darwin',
        reason: 'Set HERMES_CLI_PATH to enable Hermes CLI.',
      },
      n8n: { available: true, platform: 'darwin' },
      comfyuiDownloads: { available: true, platform: 'darwin' },
      systemMetrics: { available: true, platform: 'darwin' },
      remoteDesktop: {
        available: false,
        platform: 'darwin',
        reason: 'Remote desktop capture is not implemented for this platform.',
      },
      desktopInput: {
        available: false,
        platform: 'darwin',
        reason: 'Desktop input is only implemented for Linux display sessions.',
      },
      desktopUpdate: { available: true, platform: 'darwin' },
      desktopLocal: { available: true, platform: 'darwin' },
    }
    const fetchFn: typeof fetch = async (input) => {
      fetchCalls.push(String(input))
      return new Response(JSON.stringify({ ok: true, capabilities }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const authorizationHeaders: (string | null)[] = []
    const authenticatedFetch: typeof fetch = async (input, init) => {
      authorizationHeaders.push(new Headers(init?.headers).get('Authorization'))
      return fetchFn(input, init)
    }
    const client = new RPCClient(ws as unknown as RpcSocket, {
      fetch: authenticatedFetch,
      getToken: () => 'token-1',
    })

    const result = await client.getDesktopCapabilities()

    expect(fetchCalls).toEqual(['/api/desktop/capabilities'])
    expect(authorizationHeaders).toEqual(['Bearer token-1'])
    expect(ws.requests).toEqual([])
    expect(result).toEqual(capabilities)
  })
})

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

  it('runs desktop runtime service actions through authenticated HTTP endpoints', async () => {
    const ws = new FakeWebSocket()
    const calls: Array<{ url: string; method: string; authorization: string | null; body: string | null }> = []
    const fetchFn: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('Authorization'),
        body: typeof init?.body === 'string' ? init.body : null,
      })
      return new Response(JSON.stringify({ ok: true, action: 'service.restart', result: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const client = new RPCClient(ws as unknown as RpcSocket, {
      fetch: fetchFn,
      getToken: () => 'token-1',
    })

    const result = await client.restartDesktopGatewayService()

    expect(result).toEqual({ action: 'service.restart', result: { ok: true } })
    expect(calls).toEqual([
      {
        url: '/api/desktop/runtime/service/restart',
        method: 'POST',
        authorization: 'Bearer token-1',
        body: null,
      },
    ])
    expect(ws.requests).toEqual([])
  })

  it('loads and installs desktop optional runtimes through authenticated HTTP endpoints', async () => {
    const ws = new FakeWebSocket()
    const calls: Array<{ url: string; method: string; authorization: string | null; body: string | null }> = []
    const fetchFn: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('Authorization'),
        body: typeof init?.body === 'string' ? init.body : null,
      })
      if (String(input).endsWith('/install')) {
        return new Response(JSON.stringify({ ok: true, runtime: { id: 'n8n', state: 'healthy', installed: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        ok: true,
        runtimes: [{ id: 'n8n', name: 'n8n', state: 'not-installed', installed: false }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const client = new RPCClient(ws as unknown as RpcSocket, {
      fetch: fetchFn,
      getToken: () => 'token-1',
    })

    expect(await client.listDesktopOptionalRuntimes()).toEqual([
      { id: 'n8n', name: 'n8n', state: 'not-installed', installed: false },
    ])
    expect(await client.installDesktopOptionalRuntime('n8n')).toEqual({
      id: 'n8n',
      state: 'healthy',
      installed: true,
    })
    expect(calls).toEqual([
      {
        url: '/api/desktop/runtimes',
        method: 'GET',
        authorization: 'Bearer token-1',
        body: null,
      },
      {
        url: '/api/desktop/runtimes/install',
        method: 'POST',
        authorization: 'Bearer token-1',
        body: '{"id":"n8n"}',
      },
    ])
    expect(ws.requests).toEqual([])
  })
})

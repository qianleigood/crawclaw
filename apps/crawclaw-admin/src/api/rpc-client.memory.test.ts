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

describe('RPCClient memory methods', () => {
  it('fetches the admin memory overview with bounded params', async () => {
    const ws = new FakeWebSocket({
      'memory.admin.overview': {
        generatedAt: '2026-05-03T00:00:00.000Z',
        provider: {
          provider: 'notebooklm',
          enabled: true,
          ready: true,
          lifecycle: 'ready',
          reason: null,
          recommendedAction: 'crawclaw memory status',
          profile: 'default',
          notebookId: 'nb-crawclaw',
          refreshAttempted: false,
          refreshSucceeded: false,
          authSource: 'profile',
          lastValidatedAt: '2026-05-03T00:00:00.000Z',
          lastRefreshAt: null,
          nextProbeAt: null,
          nextAllowedRefreshAt: null,
          details: null,
        },
        runtime: { storePath: '/tmp/memory-runtime.db' },
        durable: {
          visibleCount: 1,
          recentUpdatedAt: '2026-05-01T00:00:00.000Z',
          items: [
            {
              id: 'agents/main/channels/discord/users/alice/MEMORY.md',
              relativePath: 'agents/main/channels/discord/users/alice/MEMORY.md',
              scopeKey: 'main:discord:alice',
              agentId: 'main',
              channel: 'discord',
              userId: 'alice',
              title: 'Alice memory',
              updatedAt: '2026-05-01T00:00:00.000Z',
              sizeBytes: 120,
              noteCount: 2,
            },
          ],
        },
        experience: {
          visibleCount: 1,
          pendingSyncCount: 1,
          statusCounts: { active: 1, stale: 0, superseded: 0, archived: 0 },
          syncStatusCounts: { synced: 0, pending_sync: 1, failed: 0 },
          items: [
            {
              id: 'experience-outbox:gateway-recovery',
              title: 'Gateway recovery',
              status: 'active',
              syncStatus: 'pending_sync',
            },
          ],
        },
        dreaming: {
          enabled: true,
          minHours: 24,
          minSessions: 5,
          scanThrottleMs: 600000,
          lockStaleAfterMs: 3600000,
        },
        sessionSummary: {
          enabled: true,
          rootDir: '~/.crawclaw',
          lightInitTokenThreshold: 3000,
          minTokensToInit: 10000,
          minTokensBetweenUpdates: 5000,
          toolCallsBetweenUpdates: 3,
          maxWaitMs: 15000,
          maxTurns: 5,
        },
      },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    const result = await client.getMemoryAdminOverview({
      durableLimit: 3,
      experienceLimit: 4,
    })

    expect(ws.requests[0]?.method).toBe('memory.admin.overview')
    expect(ws.requests[0]?.params).toEqual({ durableLimit: 3, experienceLimit: 4 })
    expect(result.provider.ready).toBe(true)
    expect(result.durable.items[0]?.scopeKey).toBe('main:discord:alice')
    expect(result.experience.pendingSyncCount).toBe(1)
  })

  it('routes durable and experience detail reads through memory RPC methods', async () => {
    const ws = new FakeWebSocket({
      'memory.durable.index.list': { items: [] },
      'memory.experience.outbox.list': { items: [] },
      'memory.sessionSummary.status': {
        agentId: 'main',
        sessionId: 'sess-1',
        summaryPath: '/tmp/summary.md',
        exists: false,
        updatedAt: null,
        profile: null,
        state: null,
        sections: {
          currentState: '',
          openLoops: '',
          taskSpecification: '',
          keyResults: '',
          errorsAndCorrections: '',
        },
      },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    await client.listMemoryDurableDocuments(12)
    await client.listMemoryExperienceOutbox({ status: 'stale', limit: 8 })
    await client.getMemorySessionSummaryStatus({ agent: 'main', sessionId: 'sess-1' })

    expect(ws.requests.map((request) => request.method)).toEqual([
      'memory.durable.index.list',
      'memory.experience.outbox.list',
      'memory.sessionSummary.status',
    ])
    expect(ws.requests[0]?.params).toEqual({ limit: 12 })
    expect(ws.requests[1]?.params).toEqual({ status: 'stale', limit: 8 })
    expect(ws.requests[2]?.params).toEqual({ agent: 'main', sessionId: 'sess-1' })
  })
})

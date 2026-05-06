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

describe('RPCClient observability methods', () => {
  it('lists observation runs with bounded filters', async () => {
    const ws = new FakeWebSocket({
      'agent.observations.list': {
        generatedAt: 1767225600000,
        nextCursor: 'cursor-2',
        items: [
          {
            runId: 'run-1',
            taskId: 'task-1',
            traceId: 'trace-1',
            sessionKey: 'agent:main:default',
            agentId: 'main',
            status: 'running',
            startedAt: 1767225500000,
            lastEventAt: 1767225590000,
            eventCount: 3,
            errorCount: 1,
            sources: ['lifecycle', 'trajectory'],
            summary: 'running main observation',
          },
        ],
      },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    const result = await client.listObservationRuns({
      query: 'trace-1',
      status: 'running',
      source: 'trajectory',
      limit: 500,
      from: 1767225000000,
      to: 1767225600000,
    })

    expect(ws.requests[0]?.method).toBe('agent.observations.list')
    expect(ws.requests[0]?.params).toEqual({
      query: 'trace-1',
      status: 'running',
      source: 'trajectory',
      limit: 200,
      from: 1767225000000,
      to: 1767225600000,
    })
    expect(result.nextCursor).toBe('cursor-2')
    expect(result.items[0]).toMatchObject({
      traceId: 'trace-1',
      runId: 'run-1',
      status: 'running',
      eventCount: 3,
      errorCount: 1,
      sources: ['lifecycle', 'trajectory'],
    })
  })

  it('inspects one observation trace by trace id', async () => {
    const ws = new FakeWebSocket({
      'agent.inspect': {
        lookup: { traceId: 'trace-1' },
        runId: 'run-1',
        taskId: 'task-1',
        refs: { trajectoryRef: 'agents/main/tasks/task-1.trajectory.json' },
        warnings: [],
        timeline: [
          {
            eventId: 'evt-1',
            type: 'run.lifecycle.start',
            phase: 'start',
            source: 'lifecycle',
            createdAt: 1767225500000,
            traceId: 'trace-1',
            spanId: 'root:trace-1',
            parentSpanId: null,
            status: 'running',
            decisionCode: 'run_started',
            summary: 'run started',
            metrics: { tokenCount: 10 },
            refs: { requestId: 'req-1' },
          },
        ],
      },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    const result = await client.inspectObservationRun({ traceId: 'trace-1' })

    expect(ws.requests[0]?.method).toBe('agent.inspect')
    expect(ws.requests[0]?.params).toEqual({ traceId: 'trace-1' })
    expect(result.timeline?.[0]).toMatchObject({
      eventId: 'evt-1',
      type: 'run.lifecycle.start',
      phase: 'start',
      source: 'lifecycle',
      traceId: 'trace-1',
      status: 'running',
      summary: 'run started',
    })
  })
})

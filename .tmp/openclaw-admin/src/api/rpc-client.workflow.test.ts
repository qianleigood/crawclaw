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

describe('RPCClient workflow methods', () => {
  it('lists workflows and normalizes list entries', async () => {
    const ws = new FakeWebSocket({
      'workflow.list': {
        count: 1,
        workflows: [
          {
            workflowId: 'wf_publish',
            name: 'Publish update',
            deploymentState: 'deployed',
            n8nWorkflowId: 'n8n_publish',
            runCount: 3,
            recentExecution: {
              executionId: 'exec_1',
              status: 'succeeded',
            },
          },
        ],
      },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    const result = await client.listWorkflows()

    expect(ws.requests[0]?.method).toBe('workflow.list')
    expect(ws.requests[0]?.params).toEqual({ includeDisabled: true })
    expect(result.count).toBe(1)
    expect(result.workflows[0]).toMatchObject({
      workflowId: 'wf_publish',
      name: 'Publish update',
      deploymentState: 'deployed',
      n8nWorkflowId: 'n8n_publish',
      runCount: 3,
      recentExecution: {
        executionId: 'exec_1',
        status: 'succeeded',
      },
    })
  })

  it('fetches n8n workflow details with a bounded execution limit', async () => {
    const ws = new FakeWebSocket({
      'workflow.n8n.get': {
        workflow: {
          workflowId: 'wf_publish',
          name: 'Publish update',
          n8nWorkflowId: 'n8n_publish',
        },
        remoteWorkflow: {
          id: 'n8n_publish',
          name: 'Publish update',
          active: true,
          nodes: [
            {
              id: 'node_manual',
              name: 'Manual Trigger',
              type: 'n8n-nodes-base.manualTrigger',
            },
          ],
          connections: {
            ManualTrigger: {
              main: [],
            },
          },
        },
        remoteExecutions: [
          {
            id: 'exec_remote_1',
            status: 'success',
            finished: true,
            startedAt: '2026-05-01T08:00:00.000Z',
          },
        ],
        remoteWorkflowUrl: 'https://n8n.example.test/workflow/n8n_publish',
        remoteExecutionsUrl: 'https://n8n.example.test/executions?workflowId=n8n_publish',
      },
    })
    const client = new RPCClient(ws as unknown as RpcSocket)

    const result = await client.getWorkflowN8nDetails('wf_publish', { executionsLimit: 5 })

    expect(ws.requests[0]?.method).toBe('workflow.n8n.get')
    expect(ws.requests[0]?.params).toEqual({ workflow: 'wf_publish', executionsLimit: 5 })
    expect(result.remoteWorkflow.nodes[0]?.name).toBe('Manual Trigger')
    expect(result.remoteWorkflow.connections).toEqual({
      ManualTrigger: {
        main: [],
      },
    })
    expect(result.remoteExecutions[0]?.id).toBe('exec_remote_1')
    expect(result.remoteWorkflowUrl).toBe('https://n8n.example.test/workflow/n8n_publish')
  })
})

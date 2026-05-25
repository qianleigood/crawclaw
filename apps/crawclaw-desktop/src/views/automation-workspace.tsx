import {
  Blocks,
  CalendarClock,
  Play,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import type { AddWorkflowMessageInput } from '../desktop-api'
import type { ConfirmationRequestInput } from '../ui/confirmation-dialog'

type AutomationWorkspaceProps = {
  confirmHighRisk: boolean
  onAddWorkflowMessage: (input: AddWorkflowMessageInput) => void
  onRequestConfirmation: (input: ConfirmationRequestInput) => Promise<boolean>
}

type AutomationKind = 'comfyui' | 'n8n' | 'schedule'

const automationCards: Array<{
  detail: string
  kind: AutomationKind
  primaryAction: string
  secondaryAction: string
  title: string
}> = [
  {
    detail: '查看本机 ComfyUI 服务状态，或向队列提交一个最小工作流请求。',
    kind: 'comfyui',
    primaryAction: 'status',
    secondaryAction: 'run',
    title: 'ComfyUI',
  },
  {
    detail: '列出 n8n 工作流，或触发指定 workflowId 的执行。',
    kind: 'n8n',
    primaryAction: 'list',
    secondaryAction: 'run',
    title: 'n8n',
  },
  {
    detail: '查看本机 cron 自动化状态，或创建一个最小定时任务请求。',
    kind: 'schedule',
    primaryAction: 'cron.status',
    secondaryAction: 'cron.create',
    title: 'Cron',
  },
]

export function AutomationWorkspace({
  confirmHighRisk,
  onAddWorkflowMessage,
  onRequestConfirmation,
}: AutomationWorkspaceProps) {
  const [comfyBaseUrl, setComfyBaseUrl] = useState('http://127.0.0.1:8188')
  const [n8nWorkflowId, setN8nWorkflowId] = useState('')
  const [cronName, setCronName] = useState('desktop-check')

  const runAutomation = (kind: AutomationKind, action: string) => {
    const requiresConfirmation = confirmHighRisk && isHighRiskAutomationAction(kind, action)
    void (async () => {
      if (requiresConfirmation) {
        const confirmed = await onRequestConfirmation({
          cancelLabel: '取消',
          confirmLabel: '执行',
          detail: '该自动化可能调用外部服务或修改本机状态，确认后才会提交到 Desktop API。',
          title: '执行自动化',
          tone: 'danger',
        })
        if (!confirmed) {
          return
        }
      }
      onAddWorkflowMessage(createWorkflowMessage(kind, action, {
        comfyBaseUrl,
        confirm: requiresConfirmation,
        cronName,
        n8nWorkflowId,
      }))
    })()
  }

  return (
    <div className="automation-workspace">
      <section className="automation-workspace__header">
        <div>
          <h1>自动化工作区</h1>
          <p>管理本机工作流入口，执行结果会回到当前对话流。</p>
        </div>
      </section>

      <div className="automation-grid">
        {automationCards.map((card) => (
          <article className="automation-card" key={card.kind}>
            <header>
              <span className="automation-card__icon">
                {card.kind === 'schedule'
                  ? <CalendarClock aria-hidden="true" size={18} strokeWidth={2.1} />
                  : <Blocks aria-hidden="true" size={18} strokeWidth={2.1} />}
              </span>
              <div>
                <h2>{card.title}</h2>
                <p>{card.detail}</p>
              </div>
            </header>

            {card.kind === 'comfyui' ? (
              <label>
                <span>Base URL</span>
                <input value={comfyBaseUrl} onChange={(event) => setComfyBaseUrl(event.target.value)} />
              </label>
            ) : null}
            {card.kind === 'n8n' ? (
              <label>
                <span>Workflow ID</span>
                <input placeholder="可选" value={n8nWorkflowId} onChange={(event) => setN8nWorkflowId(event.target.value)} />
              </label>
            ) : null}
            {card.kind === 'schedule' ? (
              <label>
                <span>任务名</span>
                <input value={cronName} onChange={(event) => setCronName(event.target.value)} />
              </label>
            ) : null}

            <div className="automation-card__actions">
              <button onClick={() => runAutomation(card.kind, card.primaryAction)} type="button">
                <RefreshCw aria-hidden="true" size={14} strokeWidth={2} />
                状态
              </button>
              <button className="workspace-primary-button" onClick={() => runAutomation(card.kind, card.secondaryAction)} type="button">
                <Play aria-hidden="true" size={14} fill="currentColor" strokeWidth={0} />
                执行
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function createWorkflowMessage(
  kind: AutomationKind,
  action: string,
  values: {
    comfyBaseUrl: string
    confirm: boolean
    cronName: string
    n8nWorkflowId: string
  },
): AddWorkflowMessageInput {
  const commonSteps = [
    { id: 'prepare', label: 'Prepare', status: 'done' },
    { id: 'run', label: 'Run', status: 'active' },
    { id: 'result', label: 'Result', status: 'pending' },
  ]
  if (kind === 'comfyui') {
    return {
      action,
      confirm: values.confirm ? true : undefined,
      detail: 'ComfyUI 工作流请求已从自动化工作区发起。',
      input: { action, baseUrl: values.comfyBaseUrl },
      status: 'running',
      steps: commonSteps,
      title: action === 'status' ? 'ComfyUI 状态' : 'ComfyUI 执行',
      workflowKind: 'comfyui',
    }
  }
  if (kind === 'n8n') {
    return {
      action,
      confirm: values.confirm ? true : undefined,
      detail: 'n8n 工作流请求已从自动化工作区发起。',
      input: values.n8nWorkflowId ? { workflowId: values.n8nWorkflowId } : { limit: 10 },
      status: 'running',
      steps: commonSteps,
      title: action === 'list' ? 'n8n 工作流列表' : 'n8n 工作流执行',
      workflowKind: 'n8n',
    }
  }
  return {
    action,
    confirm: values.confirm ? true : undefined,
    detail: 'Cron 自动化请求已从自动化工作区发起。',
    input: action === 'cron.create'
      ? {
        name: values.cronName.trim() || 'desktop-check',
        schedule: {
          kind: 'every',
          everyMs: 86_400_000,
        },
        text: `Desktop automation check: ${values.cronName.trim() || 'desktop-check'}`,
      }
      : {},
    status: 'running',
    steps: commonSteps,
    title: action === 'cron.status' ? 'Cron 状态' : 'Cron 创建',
    workflowKind: 'schedule',
  }
}

function isHighRiskAutomationAction(kind: AutomationKind, action: string) {
  if (kind === 'comfyui') {
    return action === 'run'
  }
  if (kind === 'n8n') {
    return action === 'run'
  }
  return action === 'cron.create'
}

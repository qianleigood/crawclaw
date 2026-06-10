import {
  Blocks,
  CalendarClock,
  Download,
  Image as ImageIcon,
  Play,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import type {
  AddWorkflowMessageInput,
  AutomationTabSummary,
  AutomationWorkspaceState,
  AutomationWorkspaceItem,
} from '../desktop-api'
import type { ConfirmationRequestInput } from '../ui/confirmation-dialog'
import { Badge, type BadgeTone } from '../ui/badge'

type AutomationWorkspaceProps = {
  automationWorkspace: AutomationWorkspaceState
  confirmHighRisk: boolean
  onAddWorkflowMessage: (input: AddWorkflowMessageInput) => void
  onRequestConfirmation: (input: ConfirmationRequestInput) => Promise<boolean>
}

type AutomationKind = 'comfyui' | 'n8n' | 'schedule'
type AutomationTabKind = 'comfyui' | 'n8n' | 'cron'
type AutomationSectionKey = 'activeRuns' | 'workflows' | 'history' | 'artifacts'

const automationSections: Array<{
  empty: string
  key: AutomationSectionKey
  title: string
}> = [
  { empty: '暂无当前执行任务', key: 'activeRuns', title: '当前执行任务' },
  { empty: '暂无工作流', key: 'workflows', title: '工作流' },
  { empty: '暂无执行历史', key: 'history', title: '执行历史' },
  { empty: '暂无产物', key: 'artifacts', title: '执行产物' },
]

export function AutomationWorkspace({
  automationWorkspace,
  confirmHighRisk,
  onAddWorkflowMessage,
  onRequestConfirmation,
}: AutomationWorkspaceProps) {
  const [comfyBaseUrl, setComfyBaseUrl] = useState('http://127.0.0.1:8188')
  const [n8nWorkflowId, setN8nWorkflowId] = useState('')
  const [cronName, setCronName] = useState('desktop-check')
  const [activeTabKind, setActiveTabKind] = useState<AutomationTabKind>('comfyui')
  const automationTabs = normalizedAutomationTabs(automationWorkspace)
  const activeTab = automationTabs.find((tab) => tab.kind === activeTabKind) ?? automationTabs[0]

  const runAutomation = (
    kind: AutomationKind,
    action: string,
    inputOverride: Record<string, unknown> = {},
  ) => {
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
        inputOverride,
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

      <section className="automation-product">
        <div className="automation-tabs" role="tablist" aria-label="Automation tabs">
          {automationTabs.map((tab) => (
            <button
              aria-selected={activeTab?.kind === tab.kind}
              className={activeTab?.kind === tab.kind ? 'is-active' : undefined}
              key={tab.kind}
              onClick={() => setActiveTabKind(tab.kind as AutomationTabKind)}
              role="tab"
              type="button"
            >
              {tab.kind === 'cron'
                ? <CalendarClock aria-hidden="true" size={15} strokeWidth={2.1} />
                : tab.kind === 'comfyui'
                ? <ImageIcon aria-hidden="true" size={15} strokeWidth={2.1} />
                : <Blocks aria-hidden="true" size={15} strokeWidth={2.1} />}
              {tab.title}
            </button>
          ))}
        </div>

        {activeTab ? (
          <div className="automation-execution-board">
            <header className="automation-execution-board__header">
              <div>
                <h2>{activeTab.title}</h2>
                <p>{activeTab.runtime.detail}</p>
              </div>
              <Badge tone={automationRuntimeTone(activeTab.runtime.status)}>
                {automationStatusLabel(activeTab.runtime.status)}
              </Badge>
            </header>

            <div className="automation-execution-metrics">
              {activeTab.runtime.baseUrl ? (
                <div>
                  <span>Endpoint</span>
                  <strong>{activeTab.runtime.baseUrl}</strong>
                </div>
              ) : null}
              {activeTab.runtime.healthStatus ? (
                <div>
                  <span>Health</span>
                  <strong>{activeTab.runtime.healthStatus}</strong>
                </div>
              ) : null}
              {activeTab.runtime.processId ? (
                <div>
                  <span>PID</span>
                  <strong>{activeTab.runtime.processId}</strong>
                </div>
              ) : null}
              {activeTab.runtime.metrics.map((metric) => (
                <div key={`${metric.label}:${metric.value}`}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>

            <div className="automation-command-bar">
              {activeTab.kind === 'comfyui' ? (
                <label>
                  <span>Base URL</span>
                  <input value={comfyBaseUrl} onChange={(event) => setComfyBaseUrl(event.target.value)} />
                </label>
              ) : null}
              {activeTab.kind === 'n8n' ? (
                <label>
                  <span>Workflow ID</span>
                  <input placeholder="可选" value={n8nWorkflowId} onChange={(event) => setN8nWorkflowId(event.target.value)} />
                </label>
              ) : null}
              {activeTab.kind === 'cron' ? (
                <label>
                  <span>任务名</span>
                  <input value={cronName} onChange={(event) => setCronName(event.target.value)} />
                </label>
              ) : null}
              <button
                onClick={() => runAutomation(tabWorkflowKind(activeTab.kind), defaultStatusAction(activeTab.kind))}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} strokeWidth={2} />
                状态
              </button>
              <button
                className="workspace-primary-button"
                onClick={() => runAutomation(tabWorkflowKind(activeTab.kind), defaultCreateAction(activeTab.kind))}
                type="button"
              >
                <Play aria-hidden="true" size={14} fill="currentColor" strokeWidth={0} />
                {activeTab.kind === 'cron' ? '创建' : '执行'}
              </button>
            </div>

            <div className="automation-section-grid">
              {automationSections.map((section) => (
                <AutomationSection
                  errors={activeTab.errors.filter((error) => error.section === section.key)}
                  key={section.key}
                  empty={section.empty}
                  items={activeTab[section.key]}
                  kind={activeTab.kind as AutomationTabKind}
                  onRunAutomation={runAutomation}
                  sectionKey={section.key}
                  title={section.title}
                  values={{ comfyBaseUrl }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>
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
    inputOverride: Record<string, unknown>
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
      input: { action, baseUrl: values.comfyBaseUrl, ...values.inputOverride },
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
      input: {
        ...(values.n8nWorkflowId ? { workflowId: values.n8nWorkflowId } : { limit: 10 }),
        ...values.inputOverride,
      },
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
    input: Object.keys(values.inputOverride).length > 0
      ? values.inputOverride
      : action === 'cron.add'
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

type AutomationSectionProps = {
  empty: string
  errors: Array<{ detail: string; section: string }>
  items: AutomationWorkspaceItem[]
  kind: AutomationTabKind
  onRunAutomation: (kind: AutomationKind, action: string, inputOverride?: Record<string, unknown>) => void
  sectionKey: AutomationSectionKey
  title: string
  values: {
    comfyBaseUrl: string
  }
}

function AutomationSection({
  empty,
  errors,
  items,
  kind,
  onRunAutomation,
  sectionKey,
  title,
  values,
}: AutomationSectionProps) {
  return (
    <section className="automation-section">
      <header>
        <h3>{title}</h3>
        <Badge tone={errors.length > 0 ? 'danger' : 'neutral'}>{items.length}</Badge>
      </header>
      {errors.map((error) => (
        <p className="automation-section__error" key={`${error.section}:${error.detail}`}>{error.detail}</p>
      ))}
      {items.length === 0 ? (
        <p className="automation-section__empty">{empty}</p>
      ) : (
        <div className="automation-section__items">
          {items.map((item) => (
            <div className="automation-item" key={`${sectionKey}:${item.id}`}>
              <div className="automation-item__main">
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <small>{automationItemMeta(item)}</small>
              </div>
              <Badge tone={automationRuntimeTone(item.status)}>{automationStatusLabel(item.status)}</Badge>
              <div className="automation-item__actions">
                {automationItemActions(kind, sectionKey, item, values).map((action) => (
                  <button
                    className={action.primary ? 'workspace-primary-button' : undefined}
                    key={action.action}
                    onClick={() => onRunAutomation(tabWorkflowKind(kind), action.action, action.input)}
                    type="button"
                  >
                    {action.icon === 'download'
                      ? <Download aria-hidden="true" size={13} strokeWidth={2} />
                      : action.icon === 'refresh'
                      ? <RefreshCw aria-hidden="true" size={13} strokeWidth={2} />
                      : <Play aria-hidden="true" size={13} fill="currentColor" strokeWidth={0} />}
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function normalizedAutomationTabs(automationWorkspace: AutomationWorkspaceState): AutomationTabSummary[] {
  if (automationWorkspace.tabs.length > 0) {
    return automationWorkspace.tabs
  }
  return [
    emptyAutomationTab('comfyui', 'ComfyUI'),
    emptyAutomationTab('n8n', 'n8n'),
    emptyAutomationTab('cron', 'Cron'),
  ]
}

function emptyAutomationTab(kind: AutomationTabKind, title: string): AutomationTabSummary {
  return {
    activeRuns: [],
    artifacts: [],
    availableActions: [],
    errors: [],
    history: [],
    kind,
    runtime: {
      detail: '等待本机 Gateway 返回自动化状态。',
      id: kind,
      metrics: [],
      name: title,
      status: 'unavailable',
    },
    title,
    workflows: [],
  }
}

function tabWorkflowKind(kind: string): AutomationKind {
  return kind === 'cron' ? 'schedule' : kind === 'n8n' ? 'n8n' : 'comfyui'
}

function defaultStatusAction(kind: string) {
  if (kind === 'cron') {
    return 'cron.status'
  }
  if (kind === 'n8n') {
    return 'list'
  }
  return 'runs-list'
}

function defaultCreateAction(kind: string) {
  if (kind === 'cron') {
    return 'cron.add'
  }
  return 'run'
}

function automationItemActions(
  kind: AutomationTabKind,
  sectionKey: AutomationSectionKey,
  item: AutomationWorkspaceItem,
  values: { comfyBaseUrl: string },
) {
  if (kind === 'comfyui') {
    if (sectionKey === 'workflows' && item.workflowId) {
      return [{
        action: 'run',
        icon: 'play',
        input: {
          baseUrl: values.comfyBaseUrl,
          downloadOutputs: true,
          waitForCompletion: true,
          workflowId: item.workflowId,
        },
        label: '执行',
        primary: true,
      }]
    }
    if ((sectionKey === 'activeRuns' || sectionKey === 'history') && item.runId) {
      return [{
        action: 'status',
        icon: 'refresh',
        input: { baseUrl: values.comfyBaseUrl, promptId: item.runId },
        label: '状态',
        primary: false,
      }]
    }
    if (sectionKey === 'artifacts' && item.runId) {
      return [{
        action: 'outputs',
        icon: 'download',
        input: { baseUrl: values.comfyBaseUrl, download: false, promptId: item.runId },
        label: '产物',
        primary: false,
      }]
    }
  }
  if (kind === 'n8n') {
    if (sectionKey === 'workflows' && item.workflowId) {
      return [{
        action: 'run',
        icon: 'play',
        input: { workflowId: item.workflowId },
        label: '执行',
        primary: true,
      }]
    }
    if ((sectionKey === 'activeRuns' || sectionKey === 'history') && item.runId) {
      return [{
        action: 'status',
        icon: 'refresh',
        input: { runId: item.runId },
        label: '状态',
        primary: false,
      }]
    }
  }
  if (kind === 'cron' && sectionKey === 'workflows') {
    const id = item.workflowId ?? item.id
    return [{
      action: 'cron.run',
      icon: 'play',
      input: { id, mode: 'force' },
      label: '执行',
      primary: true,
    }]
  }
  return []
}

function automationItemMeta(item: AutomationWorkspaceItem) {
  return [
    item.workflowId ? `workflow ${item.workflowId}` : '',
    item.runId ? `run ${item.runId}` : '',
    item.path ?? '',
    item.updatedAt ? `updated ${item.updatedAt}` : item.startedAt ? `started ${item.startedAt}` : '',
  ].filter(Boolean).join(' · ')
}

function isHighRiskAutomationAction(kind: AutomationKind, action: string) {
  if (kind === 'comfyui') {
    return action === 'run'
  }
  if (kind === 'n8n') {
    return ['run', 'cancel', 'resume'].includes(action)
  }
  return ['cron.add', 'cron.run', 'cron.remove'].includes(action)
}

function automationStatusLabel(status: string) {
  if (status === 'ready') {
    return '可用'
  }
  if (status === 'installed') {
    return '已安装'
  }
  if (status === 'running') {
    return '运行中'
  }
  if (status === 'queued') {
    return '排队'
  }
  if (status === 'pending') {
    return '等待'
  }
  if (status === 'success' || status === 'done') {
    return '完成'
  }
  if (status === 'scheduled' || status === 'enabled') {
    return '已排程'
  }
  if (status === 'disabled') {
    return '停用'
  }
  if (status === 'notInstalled') {
    return '未安装'
  }
  if (status === 'unavailable') {
    return '等待 Gateway'
  }
  if (status === 'idle') {
    return '空闲'
  }
  if (status === 'error' || status === 'failed') {
    return '错误'
  }
  return status
}

function automationRuntimeTone(status: string): BadgeTone {
  if (['ready', 'installed', 'running', 'success', 'done', 'scheduled', 'enabled'].includes(status)) {
    return 'ok'
  }
  if (['error', 'failed', 'unhealthy'].includes(status)) {
    return 'danger'
  }
  return 'idle'
}

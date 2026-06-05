import {
  Blocks,
  CalendarClock,
  Download,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react'
import { useState } from 'react'
import type {
  AddWorkflowMessageInput,
  AutomationRuntimeInstallInput,
  AutomationRuntimeSummary,
  AutomationWorkspaceState,
} from '../desktop-api'
import type { ConfirmationRequestInput } from '../ui/confirmation-dialog'
import { Badge, type BadgeTone } from '../ui/badge'

type AutomationWorkspaceProps = {
  automationWorkspace: AutomationWorkspaceState
  confirmHighRisk: boolean
  onAddWorkflowMessage: (input: AddWorkflowMessageInput) => void
  onInstallRuntime: (runtimeId: string, input: AutomationRuntimeInstallInput) => Promise<void>
  onRequestConfirmation: (input: ConfirmationRequestInput) => Promise<boolean>
  onRefreshRuntime: (runtimeId: string) => Promise<void>
  onStartRuntime: (runtimeId: string) => Promise<void>
  onStopRuntime: (runtimeId: string) => Promise<void>
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
  automationWorkspace,
  confirmHighRisk,
  onAddWorkflowMessage,
  onInstallRuntime,
  onRequestConfirmation,
  onRefreshRuntime,
  onStartRuntime,
  onStopRuntime,
}: AutomationWorkspaceProps) {
  const [comfyBaseUrl, setComfyBaseUrl] = useState('http://127.0.0.1:8188')
  const [n8nWorkflowId, setN8nWorkflowId] = useState('')
  const [cronName, setCronName] = useState('desktop-check')
  const [pendingRuntimeAction, setPendingRuntimeAction] = useState<string | null>(null)
  const [selectedComputeProfiles, setSelectedComputeProfiles] = useState<Record<string, string>>({})
  const [runtimePytorchIndexUrls, setRuntimePytorchIndexUrls] = useState<Record<string, string>>({})
  const managedRuntimes = automationWorkspace.runtimes

  const runRuntimeAction = (runtime: AutomationRuntimeSummary, action: 'install' | 'refresh' | 'start' | 'stop') => {
    const pendingKey = `${runtime.id}:${action}`
    void (async () => {
      if (confirmHighRisk && action !== 'refresh') {
        const confirmed = await onRequestConfirmation({
          cancelLabel: '取消',
          confirmLabel: runtimeActionConfirmLabel(action),
          detail: runtimeActionConfirmationDetail(runtime, action),
          title: runtimeActionConfirmationTitle(runtime, action),
          tone: action === 'stop' ? 'default' : 'danger',
        })
        if (!confirmed) {
          return
        }
      }

      setPendingRuntimeAction(pendingKey)
      try {
        if (action === 'refresh') {
          await onRefreshRuntime(runtime.id)
          return
        }
        if (action === 'install') {
          await onInstallRuntime(runtime.id, runtimeInstallInput(
            runtime,
            selectedComputeProfiles[runtime.id],
            runtimePytorchIndexUrls[runtime.id],
          ))
          return
        }
        if (action === 'start') {
          await onStartRuntime(runtime.id)
          return
        }
        await onStopRuntime(runtime.id)
      } finally {
        setPendingRuntimeAction(null)
      }
    })()
  }

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

      <section className="automation-runtime-panel">
        <header className="automation-runtime-panel__header">
          <div>
            <h2>Automation Runtime Manager</h2>
            <p>n8n / ComfyUI</p>
          </div>
          <Badge tone="neutral">{managedRuntimes.length} runtimes</Badge>
        </header>

        {managedRuntimes.length === 0 ? (
          <p className="automation-runtime-empty">Runtime manifest 未返回 n8n / ComfyUI。</p>
        ) : (
          <div className="automation-runtime-grid">
            {managedRuntimes.map((runtime) => (
              <article className="automation-runtime-card" key={runtime.id}>
                <header>
                  <span className="automation-runtime-card__icon">
                    {runtime.id === 'comfyui'
                      ? <ImageIcon aria-hidden="true" size={18} strokeWidth={2.1} />
                      : <Blocks aria-hidden="true" size={18} strokeWidth={2.1} />}
                  </span>
                  <div>
                    <h3>{runtime.name}</h3>
                    <p>{runtime.detail}</p>
                  </div>
                  <Badge tone={runtimeStatusTone(runtime.status)}>{runtimeStatusLabel(runtime.status)}</Badge>
                </header>

                <dl className="automation-runtime-card__meta">
                  <div>
                    <dt>Endpoint</dt>
                    <dd>{runtime.baseUrl}</dd>
                  </div>
                  {runtime.healthUrl ? (
                    <div>
                      <dt>Health</dt>
                      <dd>
                        {runtime.healthStatus
                          ? `${runtime.healthStatus}${runtime.healthDetail ? ` (${runtime.healthDetail})` : ''}`
                          : runtime.healthUrl}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Runtime</dt>
                    <dd>{runtime.runtime}</dd>
                  </div>
                  <div>
                    <dt>Install</dt>
                    <dd>{runtime.install.channel}</dd>
                  </div>
                  <div>
                    <dt>Policy</dt>
                    <dd>{runtime.install.scriptPolicy}</dd>
                  </div>
                  {runtime.processId ? (
                    <div>
                      <dt>PID</dt>
                      <dd>{runtime.processId}</dd>
                    </div>
                  ) : null}
                  {runtime.logPath ? (
                    <div>
                      <dt>Log</dt>
                      <dd>{runtime.logPath}</dd>
                    </div>
                  ) : null}
                </dl>

                {runtime.computeProfiles.length > 0 ? (
                  <div className="automation-runtime-card__profiles">
                    <label>
                      <span>Profile</span>
                      <select
                        disabled={runtime.status === 'running' || pendingRuntimeAction !== null}
                        value={selectedComputeProfiles[runtime.id] ?? runtime.selectedComputeProfile ?? ''}
                        onChange={(event) => setSelectedComputeProfiles((profiles) => ({
                          ...profiles,
                          [runtime.id]: event.target.value,
                        }))}
                      >
                        <option value="">auto</option>
                        {runtime.computeProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.id}{profile.experimental ? ' experimental' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {runtime.id === 'comfyui' ? (
                      <label>
                        <span>PyTorch index URL</span>
                        <input
                          disabled={runtime.status === 'running' || pendingRuntimeAction !== null}
                          placeholder={runtimePytorchIndexUrlPlaceholder(runtime, selectedComputeProfiles[runtime.id])}
                          required={runtimeRequiresPytorchIndexUrl(runtime, selectedComputeProfiles[runtime.id])}
                          value={runtimePytorchIndexUrls[runtime.id] ?? ''}
                          onChange={(event) => setRuntimePytorchIndexUrls((urls) => ({
                            ...urls,
                            [runtime.id]: event.target.value,
                          }))}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}

                <div className="automation-runtime-card__actions">
                  <button
                    disabled={pendingRuntimeAction !== null}
                    onClick={() => runRuntimeAction(runtime, 'refresh')}
                    type="button"
                  >
                    <RefreshCw aria-hidden="true" size={14} strokeWidth={2} />
                    刷新
                  </button>
                  {runtimePrimaryAction(runtime) === 'stop' ? (
                    <button
                      className="workspace-secondary-button"
                      disabled={pendingRuntimeAction !== null}
                      onClick={() => runRuntimeAction(runtime, 'stop')}
                      type="button"
                    >
                      <Square aria-hidden="true" size={13} fill="currentColor" strokeWidth={0} />
                      停止
                    </button>
                  ) : runtimePrimaryAction(runtime) === 'start' ? (
                    <button
                      className="workspace-primary-button"
                      disabled={pendingRuntimeAction !== null}
                      onClick={() => runRuntimeAction(runtime, 'start')}
                      type="button"
                    >
                      <Play aria-hidden="true" size={14} fill="currentColor" strokeWidth={0} />
                      启动
                    </button>
                  ) : (
                    <button
                      className="workspace-primary-button"
                      disabled={pendingRuntimeAction !== null
                        || runtimeInstallNeedsPytorchIndexUrl(
                          runtime,
                          selectedComputeProfiles[runtime.id],
                          runtimePytorchIndexUrls[runtime.id],
                        )}
                      onClick={() => runRuntimeAction(runtime, 'install')}
                      type="button"
                    >
                      <Download aria-hidden="true" size={14} strokeWidth={2} />
                      安装
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
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

function runtimeStatusLabel(status: AutomationRuntimeSummary['status']) {
  if (status === 'ready') {
    return '可用'
  }
  if (status === 'installed') {
    return '已安装'
  }
  if (status === 'running') {
    return '运行中'
  }
  if (status === 'notInstalled') {
    return '未安装'
  }
  if (status === 'unavailable') {
    return '等待 Gateway'
  }
  if (status === 'error') {
    return '错误'
  }
  return status
}

function runtimeStatusTone(status: AutomationRuntimeSummary['status']): BadgeTone {
  if (status === 'ready' || status === 'installed' || status === 'running') {
    return 'ok'
  }
  if (status === 'error') {
    return 'danger'
  }
  return 'idle'
}

function runtimePrimaryAction(runtime: AutomationRuntimeSummary): 'install' | 'start' | 'stop' {
  if (runtime.status === 'running') {
    return 'stop'
  }
  if (runtime.status === 'installed' || runtime.status === 'stopped') {
    return 'start'
  }
  return 'install'
}

function selectedRuntimeComputeProfile(
  runtime: AutomationRuntimeSummary,
  selectedComputeProfile: string | undefined,
) {
  const profileId = selectedComputeProfile?.trim() || runtime.selectedComputeProfile?.trim()
  return runtime.computeProfiles.find((profile) => profile.id === profileId)
}

function runtimePytorchIndexUrlPlaceholder(
  runtime: AutomationRuntimeSummary,
  selectedComputeProfile: string | undefined,
) {
  const profile = selectedRuntimeComputeProfile(runtime, selectedComputeProfile)
  const defaultUrl = profile?.pytorchIndexUrlDefault?.trim()
  if (defaultUrl) {
    return `默认 ${defaultUrl}`
  }
  return profile?.pytorchIndexUrlHint ?? ''
}

function runtimeRequiresPytorchIndexUrl(
  runtime: AutomationRuntimeSummary,
  selectedComputeProfile: string | undefined,
) {
  return selectedRuntimeComputeProfile(runtime, selectedComputeProfile)?.requiresPytorchIndexUrl ?? false
}

function runtimeInstallNeedsPytorchIndexUrl(
  runtime: AutomationRuntimeSummary,
  selectedComputeProfile: string | undefined,
  pytorchIndexUrl: string | undefined,
) {
  const profile = selectedRuntimeComputeProfile(runtime, selectedComputeProfile)
  return (profile?.requiresPytorchIndexUrl ?? false) && !profile?.pytorchIndexUrlDefault?.trim() && !pytorchIndexUrl?.trim()
}

function runtimeInstallInput(
  runtime: AutomationRuntimeSummary,
  selectedComputeProfile: string | undefined,
  pytorchIndexUrl: string | undefined,
): AutomationRuntimeInstallInput {
  if (runtime.id !== 'comfyui') {
    return {}
  }
  const computeProfile = selectedComputeProfile?.trim()
  const indexUrl = pytorchIndexUrl?.trim()
  return {
    ...(computeProfile ? { computeProfile } : {}),
    ...(indexUrl ? { pytorchIndexUrl: indexUrl } : {}),
  }
}

function runtimeActionConfirmLabel(action: 'install' | 'refresh' | 'start' | 'stop') {
  if (action === 'install') {
    return '安装'
  }
  if (action === 'start') {
    return '启动'
  }
  if (action === 'stop') {
    return '停止'
  }
  return '刷新'
}

function runtimeActionConfirmationTitle(
  runtime: AutomationRuntimeSummary,
  action: 'install' | 'refresh' | 'start' | 'stop',
) {
  return `${runtime.name} ${runtimeActionConfirmLabel(action)}`
}

function runtimeActionConfirmationDetail(
  runtime: AutomationRuntimeSummary,
  action: 'install' | 'refresh' | 'start' | 'stop',
) {
  if (action === 'install') {
    return `${runtime.name} 安装会在本机 runtime 目录写入文件，并可能下载依赖包。`
  }
  if (action === 'start') {
    return `${runtime.name} 会作为本机服务进程启动。`
  }
  if (action === 'stop') {
    return `${runtime.name} 当前本机服务进程会被停止。`
  }
  return `${runtime.name} 状态会重新读取。`
}

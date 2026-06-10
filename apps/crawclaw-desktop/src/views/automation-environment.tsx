import {
  Blocks,
  Download,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react'
import { useState } from 'react'
import type {
  AutomationRuntimeInstallInput,
  AutomationRuntimeSummary,
  AutomationWorkspaceState,
} from '../desktop-api'
import type { ConfirmationRequestInput } from '../ui/confirmation-dialog'
import { Badge, type BadgeTone } from '../ui/badge'

type AutomationEnvironmentProps = {
  automationWorkspace: AutomationWorkspaceState
  confirmHighRisk: boolean
  onInstallRuntime: (runtimeId: string, input: AutomationRuntimeInstallInput) => Promise<void>
  onRequestConfirmation: (input: ConfirmationRequestInput) => Promise<boolean>
  onRefreshRuntime: (runtimeId: string) => Promise<void>
  onStartRuntime: (runtimeId: string) => Promise<void>
  onStopRuntime: (runtimeId: string) => Promise<void>
}

const managedRuntimeOrder = ['n8n', 'comfyui']

export function AutomationEnvironment({
  automationWorkspace,
  confirmHighRisk,
  onInstallRuntime,
  onRequestConfirmation,
  onRefreshRuntime,
  onStartRuntime,
  onStopRuntime,
}: AutomationEnvironmentProps) {
  const [pendingRuntimeAction, setPendingRuntimeAction] = useState<string | null>(null)
  const [selectedComputeProfiles, setSelectedComputeProfiles] = useState<Record<string, string>>({})
  const [runtimePytorchIndexUrls, setRuntimePytorchIndexUrls] = useState<Record<string, string>>({})
  const runtimeSummaries = automationWorkspace.runtimes ?? []
  const managedRuntimes = managedRuntimeOrder.reduce<AutomationRuntimeSummary[]>((runtimes, runtimeId) => {
    const runtime = runtimeSummaries.find((candidate) => candidate.id === runtimeId)
    if (runtime) {
      runtimes.push(runtime)
    }
    return runtimes
  }, [])
  const environmentStats = automationEnvironmentStats(managedRuntimes)

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

  return (
    <section className="automation-environment-panel" data-testid="automation-environment-panel">
      <header className="automation-environment-panel__header">
        <div>
          <h3>自动化环境</h3>
          <p>安装、启动和检查 n8n / ComfyUI，本机内置 Cron 不需要安装。</p>
        </div>
        <Badge tone="neutral">{environmentStats.installed}/{environmentStats.total} 已安装</Badge>
      </header>

      {managedRuntimes.length === 0 ? (
        <p className="automation-environment-empty">自动化环境清单未返回 n8n / ComfyUI。</p>
      ) : (
        <div className="automation-environment-layout">
          <div className="automation-environment-overview" data-testid="automation-environment-overview">
            <div>
              <span>安装入口</span>
              <strong>{environmentStats.total}</strong>
              <small>n8n / ComfyUI</small>
            </div>
            <div>
              <span>已就绪</span>
              <strong>{environmentStats.installed}</strong>
              <small>ready / installed / running</small>
            </div>
            <div>
              <span>内置 Cron</span>
              <strong>无需安装</strong>
              <small>在自动化工作区执行和查看</small>
            </div>
          </div>

          <div className="automation-environment-services">
            {managedRuntimes.map((runtime) => {
              const selectedComputeProfile = selectedComputeProfiles[runtime.id]
              const pytorchIndexUrl = runtimePytorchIndexUrls[runtime.id]
              const computeProfiles = runtime.computeProfiles ?? []
              const installDisabledReason = runtimeInstallDisabledReason(
                runtime,
                selectedComputeProfile,
                pytorchIndexUrl,
              )
              return (
                <article
                  className="automation-environment-service"
                  data-runtime-id={runtime.id}
                  data-testid="automation-environment-service"
                  key={runtime.id}
                >
                  <header>
                    <span className="automation-environment-service__icon">
                      {runtime.id === 'comfyui'
                        ? <ImageIcon aria-hidden="true" size={18} strokeWidth={2.1} />
                        : <Blocks aria-hidden="true" size={18} strokeWidth={2.1} />}
                    </span>
                    <div className="automation-environment-service__title">
                      <h4>{runtime.name}</h4>
                      <p>{runtime.detail}</p>
                    </div>
                    <Badge data-testid="automation-environment-status" tone={runtimeStatusTone(runtime.status)}>
                      {runtimeStatusLabel(runtime.status)}
                    </Badge>
                  </header>

                  <section className="automation-environment-install-center" aria-label={`${runtime.name} 安装环境`}>
                    <div className="automation-environment-install-center__header">
                      <span>安装环境</span>
                      <Badge tone="neutral">{runtime.install.channel}</Badge>
                    </div>
                    <div className="automation-environment-install">
                      <div className="automation-environment-install__body">
                        <strong>{runtimeInstallTitle(runtime)}</strong>
                        <small>{runtime.install.scriptPolicy} · {runtime.install.manifestPath}</small>
                      </div>
                      <button
                        className="workspace-primary-button"
                        data-runtime-action="install"
                        data-testid="automation-runtime-action"
                        disabled={pendingRuntimeAction !== null || installDisabledReason !== null}
                        onClick={() => runRuntimeAction(runtime, 'install')}
                        title={installDisabledReason ?? undefined}
                        type="button"
                      >
                        <Download aria-hidden="true" size={14} strokeWidth={2} />
                        {pendingRuntimeAction === `${runtime.id}:install` ? '安装中' : '安装环境'}
                      </button>
                    </div>
                  </section>

                  <dl className="automation-environment-service__meta" aria-label={`${runtime.name} 运行状态`}>
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
                      <dd>{runtime.runtime} · {runtime.service}</dd>
                    </div>
                    <div>
                      <dt>Mode</dt>
                      <dd>{runtime.mode}</dd>
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

                  {computeProfiles.length > 0 ? (
                    <div className="automation-environment-service__profiles">
                      <div className="automation-environment-service__profiles-header">
                        <strong>显卡与 PyTorch</strong>
                        <span>{runtime.selectedComputeProfile ? `当前 ${runtime.selectedComputeProfile}` : 'auto'}</span>
                      </div>
                      <label>
                        <span>Profile</span>
                        <select
                          disabled={runtime.status === 'running' || pendingRuntimeAction !== null}
                          value={selectedComputeProfile ?? runtime.selectedComputeProfile ?? ''}
                          onChange={(event) => setSelectedComputeProfiles((profiles) => ({
                            ...profiles,
                            [runtime.id]: event.target.value,
                          }))}
                        >
                          <option value="">auto</option>
                          {computeProfiles.map((profile) => (
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
                            placeholder={runtimePytorchIndexUrlPlaceholder(runtime, selectedComputeProfile)}
                            required={runtimeRequiresPytorchIndexUrl(runtime, selectedComputeProfile)}
                            value={pytorchIndexUrl ?? ''}
                            onChange={(event) => setRuntimePytorchIndexUrls((urls) => ({
                              ...urls,
                              [runtime.id]: event.target.value,
                            }))}
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : null}

                  <section className="automation-environment-run-control" aria-label={`${runtime.name} 运行控制`}>
                    <div>
                      <strong>运行控制</strong>
                      <span>刷新状态、启动服务或停止本机进程。</span>
                    </div>
                    <div className="automation-environment-service__actions">
                      <button
                        data-runtime-action="refresh"
                        data-testid="automation-runtime-action"
                        disabled={pendingRuntimeAction !== null}
                        onClick={() => runRuntimeAction(runtime, 'refresh')}
                        type="button"
                      >
                        <RefreshCw aria-hidden="true" size={14} strokeWidth={2} />
                        刷新
                      </button>
                      {runtimeCanStop(runtime) ? (
                      <button
                        className="workspace-secondary-button"
                        data-runtime-action="stop"
                        data-testid="automation-runtime-action"
                        disabled={pendingRuntimeAction !== null}
                        onClick={() => runRuntimeAction(runtime, 'stop')}
                        type="button"
                      >
                        <Square aria-hidden="true" size={13} fill="currentColor" strokeWidth={0} />
                        停止
                      </button>
                      ) : runtimeCanStart(runtime) ? (
                      <button
                        className="workspace-primary-button"
                        data-runtime-action="start"
                        data-testid="automation-runtime-action"
                        disabled={pendingRuntimeAction !== null}
                        onClick={() => runRuntimeAction(runtime, 'start')}
                        type="button"
                      >
                        <Play aria-hidden="true" size={14} fill="currentColor" strokeWidth={0} />
                        启动
                      </button>
                      ) : null}
                    </div>
                  </section>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function automationEnvironmentStats(runtimes: AutomationRuntimeSummary[]) {
  return {
    installed: runtimes.filter((runtime) => ['installed', 'ready', 'running'].includes(runtime.status)).length,
    running: runtimes.filter((runtime) => runtime.status === 'running').length,
    total: runtimes.length,
  }
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

function runtimeCanStart(runtime: AutomationRuntimeSummary) {
  return runtime.status === 'installed' || runtime.status === 'stopped'
}

function runtimeCanStop(runtime: AutomationRuntimeSummary) {
  return runtime.status === 'running'
}

function runtimeInstallTitle(runtime: AutomationRuntimeSummary) {
  return runtime.id === 'comfyui'
    ? '安装 ComfyUI 与匹配的 PyTorch'
    : '安装 n8n 本机运行环境'
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

function runtimeInstallDisabledReason(
  runtime: AutomationRuntimeSummary,
  selectedComputeProfile: string | undefined,
  pytorchIndexUrl: string | undefined,
) {
  if (runtime.status === 'running') {
    return '停止环境后再安装。'
  }
  if (runtimeInstallNeedsPytorchIndexUrl(runtime, selectedComputeProfile, pytorchIndexUrl)) {
    return '该显卡 profile 需要填写 PyTorch index URL。'
  }
  return null
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
    return '安装环境'
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

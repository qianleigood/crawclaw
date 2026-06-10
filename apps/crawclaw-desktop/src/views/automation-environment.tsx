import {
  Blocks,
  Cpu,
  Download,
  FileText,
  Gauge,
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
          <p>安装并维护 n8n / ComfyUI 的本机运行环境。</p>
        </div>
        <Badge tone="neutral">{environmentStats.installed}/{environmentStats.total} 已安装</Badge>
      </header>

      {managedRuntimes.length === 0 ? (
        <p className="automation-environment-empty">自动化环境清单未返回可安装环境。</p>
      ) : (
        <div className="automation-environment-layout">
          <div className="automation-environment-overview" data-testid="automation-environment-overview">
            <div>
              <span>可安装环境</span>
              <strong>{environmentStats.total}</strong>
              <small>n8n / ComfyUI</small>
            </div>
            <div>
              <span>已安装</span>
              <strong>{environmentStats.installed}</strong>
              <small>本机 runtime 已准备</small>
            </div>
            <div>
              <span>运行中</span>
              <strong>{environmentStats.running}</strong>
              <small>可直接执行工作流</small>
            </div>
            <div>
              <span>健康通过</span>
              <strong>{environmentStats.healthy}</strong>
              <small>health endpoint 可访问</small>
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

                  <div className="automation-environment-service__quick-status" aria-label={`${runtime.name} 环境状态`}>
                    <span>
                      <Gauge aria-hidden="true" size={14} strokeWidth={2} />
                      {runtimeHealthSummary(runtime)}
                    </span>
                    <span>
                      <FileText aria-hidden="true" size={14} strokeWidth={2} />
                      {runtime.logPath ? '日志已记录' : '暂无日志'}
                    </span>
                    {computeProfiles.length > 0 ? (
                      <span>
                        <Cpu aria-hidden="true" size={14} strokeWidth={2} />
                        {runtimeProfileSummary(runtime, selectedComputeProfile)}
                      </span>
                    ) : null}
                  </div>

                  <div className="automation-environment-flow" aria-label={`${runtime.name} 环境管理`}>
                    <section className="automation-environment-step automation-environment-install-center">
                      <div className="automation-environment-step__marker">1</div>
                      <div>
                        <span>安装环境</span>
                        <strong>{runtimeInstallTitle(runtime)}</strong>
                        <small>{runtimeInstallDetail(runtime)}</small>
                      </div>
                      <button
                        className="workspace-primary-button automation-environment-install-button"
                        data-runtime-action="install"
                        data-testid="automation-runtime-action"
                        disabled={pendingRuntimeAction !== null || installDisabledReason !== null}
                        onClick={() => runRuntimeAction(runtime, 'install')}
                        title={installDisabledReason ?? undefined}
                        type="button"
                      >
                        <Download aria-hidden="true" size={14} strokeWidth={2} />
                        {pendingRuntimeAction === `${runtime.id}:install`
                          ? '安装中'
                          : runtimeInstalled(runtime)
                          ? '更新环境'
                          : '安装环境'}
                      </button>
                    </section>

                    {computeProfiles.length > 0 ? (
                      <section className="automation-environment-step automation-environment-step--config">
                        <div className="automation-environment-step__marker">2</div>
                        <div className="automation-environment-config">
                          <div className="automation-environment-config__header">
                            <span>显卡与 PyTorch</span>
                            <strong>{runtimeProfileSummary(runtime, selectedComputeProfile)}</strong>
                          </div>
                          <label>
                            <span>显卡 profile</span>
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
                          {runtime.id === 'comfyui' && (
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
                          )}
                        </div>
                      </section>
                    ) : null}

                    <section className="automation-environment-step automation-environment-step--runtime automation-environment-run-control">
                      <div className="automation-environment-step__marker">{computeProfiles.length > 0 ? '3' : '2'}</div>
                      <div className="automation-environment-runtime">
                        <div>
                          <span>运行控制</span>
                          <strong>{runtimeStatusSummary(runtime)}</strong>
                          <small>{runtimeConnectionSummary(runtime)}</small>
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
                      </div>
                    </section>
                  </div>

                  <dl className="automation-environment-service__meta" aria-label={`${runtime.name} 连接信息`}>
                    <div>
                      <dt>Endpoint</dt>
                      <dd>{runtime.baseUrl}</dd>
                    </div>
                    {runtime.healthUrl ? (
                      <div>
                        <dt>Health</dt>
                        <dd title={runtime.healthUrl}>{runtimeHealthSummary(runtime)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Runtime</dt>
                      <dd>{runtime.runtime} · {runtime.service}</dd>
                    </div>
                    <div>
                      <dt>Install</dt>
                      <dd title={runtime.install.manifestPath}>{runtime.install.manifestPath}</dd>
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
  const installed = runtimes.filter(runtimeInstalled).length
  return {
    healthy: runtimes.filter((runtime) => runtime.healthStatus === 'healthy').length,
    installed,
    notInstalled: runtimes.filter((runtime) => runtime.status === 'notInstalled').length,
    running: runtimes.filter((runtime) => runtime.status === 'running').length,
    total: runtimes.length,
  }
}

function runtimeInstalled(runtime: AutomationRuntimeSummary) {
  return ['installed', 'ready', 'running'].includes(runtime.status)
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

function runtimeStatusSummary(runtime: AutomationRuntimeSummary) {
  if (runtime.status === 'running' && runtime.processId) {
    return `PID ${runtime.processId}`
  }
  if (runtime.healthStatus) {
    return runtime.healthDetail ? `${runtime.healthStatus} · ${runtime.healthDetail}` : runtime.healthStatus
  }
  if (runtime.status === 'notInstalled') {
    return '等待安装'
  }
  if (runtime.status === 'unavailable') {
    return '等待 Gateway'
  }
  return runtimeStatusLabel(runtime.status)
}

function runtimeHealthSummary(runtime: AutomationRuntimeSummary) {
  if (runtime.healthStatus) {
    return runtime.healthDetail ? `${runtime.healthStatus} · ${runtime.healthDetail}` : runtime.healthStatus
  }
  if (runtime.status === 'running') {
    return '等待健康检查'
  }
  if (runtime.status === 'unavailable') {
    return '等待 Gateway'
  }
  return '未检查'
}

function runtimeConnectionSummary(runtime: AutomationRuntimeSummary) {
  if (runtime.healthUrl) {
    return `${runtime.baseUrl} · ${runtimeHealthSummary(runtime)}`
  }
  return runtime.baseUrl
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

function runtimeInstallDetail(runtime: AutomationRuntimeSummary) {
  const policy = runtime.install.scriptPolicy?.trim()
  const channel = runtime.install.channel?.trim()
  const parts = [
    policy ? `${policy} 校验` : '',
    channel ? runtimeInstallModeLabel(channel) : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '按本机 manifest 安装'
}

function runtimeProfileSummary(
  runtime: AutomationRuntimeSummary,
  selectedComputeProfile: string | undefined,
) {
  return selectedComputeProfile?.trim() || runtime.selectedComputeProfile?.trim() || 'auto'
}

function runtimeInstallModeLabel(channel: string) {
  if (channel === 'github-release') {
    return 'GitHub Release'
  }
  return channel
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

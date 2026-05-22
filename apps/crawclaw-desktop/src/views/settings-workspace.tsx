import {
  Bot,
  Brain,
  ChevronDown,
  ChevronLeft,
  Clock3,
  FileText,
  MessageCircle,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { DesktopPreferences } from '../desktop-api'

export type SettingsSectionId = 'general' | 'model' | 'permissions' | 'memory' | 'notifications' | 'privacy' | 'advanced'
type SettingsRowStatusValue = 'active' | 'planned' | 'preview'
type SettingsPreferencePatch = Partial<DesktopPreferences>

const settingsSections: Array<{ icon: LucideIcon; id: SettingsSectionId; label: string }> = [
  { icon: Wrench, id: 'general', label: '常规' },
  { icon: Bot, id: 'model', label: '模型与回复' },
  { icon: ShieldCheck, id: 'permissions', label: '权限与确认' },
  { icon: Brain, id: 'memory', label: '记忆偏好' },
  { icon: MessageCircle, id: 'notifications', label: '通知' },
  { icon: FileText, id: 'privacy', label: '数据与隐私' },
  { icon: Clock3, id: 'advanced', label: '高级' },
]

const permissionModeDescriptions: Record<string, string> = {
  工作区模式: '只允许访问当前工作区中的内容，适合日常使用。',
  只读模式: 'CrawClaw 只查看信息，不会修改文件或执行写入操作。',
  完全访问: '允许更大范围的本机操作，适合你明确需要自动执行任务时。',
}

type SettingsWorkspaceProps = {
  activeSettingsSection: SettingsSectionId
  modelOptions: string[]
  onAddModelOption: (modelName: string) => void
  onPreferenceUpdate: (patch: SettingsPreferencePatch) => void
  preferences: DesktopPreferences
  runtimeStatus: string
}

type SettingsSidebarProps = {
  activeSettingsSection: SettingsSectionId
  onReturnToApp: () => void
  onSelectSection: (id: SettingsSectionId) => void
}

export function SettingsWorkspace({
  activeSettingsSection,
  modelOptions,
  onAddModelOption,
  onPreferenceUpdate,
  preferences,
  runtimeStatus,
}: SettingsWorkspaceProps) {
  const [isAddingModel, setIsAddingModel] = useState(false)
  const [modelDraftName, setModelDraftName] = useState('')
  const taskDefaults = preferences.taskDefaults
  const confirmationDefaults = preferences.confirmationDefaults
  const notificationDefaults = preferences.notificationDefaults
  const uiDefaults = preferences.uiDefaults
  const memoryDefaults = preferences.memoryDefaults
  const privacyDefaults = preferences.privacyDefaults
  const advancedDefaults = preferences.advancedDefaults

  const updateTaskDefaults = (patch: Partial<DesktopPreferences['taskDefaults']>) => {
    const nextTaskDefaults = {
      ...taskDefaults,
      ...patch,
    }
    onPreferenceUpdate({
      permissionMode: nextTaskDefaults.permissionMode,
      selectedModel: nextTaskDefaults.selectedModel,
      selectedThinking: nextTaskDefaults.selectedThinking,
      taskDefaults: nextTaskDefaults,
    })
  }

  const updateConfirmationDefaults = (patch: Partial<DesktopPreferences['confirmationDefaults']>) => {
    onPreferenceUpdate({
      confirmationDefaults: {
        ...confirmationDefaults,
        ...patch,
      },
    })
  }

  const updateNotificationDefaults = (patch: Partial<DesktopPreferences['notificationDefaults']>) => {
    onPreferenceUpdate({
      notificationDefaults: {
        ...notificationDefaults,
        ...patch,
      },
    })
  }

  const updateUiDefaults = (patch: Partial<DesktopPreferences['uiDefaults']>) => {
    onPreferenceUpdate({
      uiDefaults: {
        ...uiDefaults,
        ...patch,
      },
    })
  }

  const updateMemoryDefaults = (patch: Partial<DesktopPreferences['memoryDefaults']>) => {
    onPreferenceUpdate({
      memoryDefaults: {
        ...memoryDefaults,
        ...patch,
      },
    })
  }

  const updateAdvancedDefaults = (patch: Partial<DesktopPreferences['advancedDefaults']>) => {
    onPreferenceUpdate({
      advancedDefaults: {
        ...advancedDefaults,
        ...patch,
      },
    })
  }

  const onSubmitCustomModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const modelName = modelDraftName.trim()
    if (!modelName) {
      return
    }

    onAddModelOption(modelName)
    setModelDraftName('')
    setIsAddingModel(false)
  }

  const renderSettingsSelectRow = (
    label: string,
    detail: string,
    value: string,
    options: string[],
    onSelect: (value: string) => void,
    status: SettingsRowStatusValue,
    getSelectedDetail?: (value: string) => string,
  ) => (
    <div className="settings-field">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
        <SettingsRowStatus status={status} />
      </div>
      <div className="settings-select-control">
        <select
          aria-label={label}
          className="settings-select"
          onChange={(event) => onSelect(event.currentTarget.value)}
          value={value}
        >
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="settings-select-control__icon" size={14} strokeWidth={2} />
        {getSelectedDetail ? (
          <small className="settings-select-control__detail">{getSelectedDetail(value)}</small>
        ) : null}
      </div>
    </div>
  )

  const renderModelConfigurationSelector = () => (
    renderSettingsActionRow(
      '选择模型配置',
      '先选择一套默认回复配置，再按需要微调模型、思考等级和回复速度。',
    )
  )

  const renderSettingsToggleRow = (
    label: string,
    detail: string,
    checked: boolean,
    onToggle: () => void,
    status: SettingsRowStatusValue,
    disabled = false,
  ) => (
    <div className="settings-field">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
        <SettingsRowStatus status={status} />
      </div>
      <button
        aria-label={label}
        aria-pressed={checked}
        className={checked ? 'settings-switch is-on' : 'settings-switch'}
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        <span>{checked ? '开启' : '关闭'}</span>
        <i aria-hidden="true" />
      </button>
    </div>
  )

  const renderSettingsValueRow = (
    label: string,
    detail: string,
    value: string,
    status: SettingsRowStatusValue,
  ) => (
    <div className="settings-field">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
        <SettingsRowStatus status={status} />
      </div>
      <span className="settings-value-pill">{value}</span>
    </div>
  )

  const renderSettingsActionRow = (label: string, detail: string, tone: 'neutral' | 'danger' = 'neutral') => (
    <div className="settings-field">
      <div className="settings-field__label">
        <strong>{label}</strong>
        <span>{detail}</span>
        <SettingsRowStatus status="planned" />
      </div>
      <button className={`settings-action-button is-${tone}`} disabled type="button">
        计划中
      </button>
    </div>
  )

  const renderAddModelRow = () => (
    <div className="settings-field settings-field--model-add">
      <div className="settings-field__label">
        <strong>模型</strong>
        <span>添加一个可在默认模型中选择的模型名称。</span>
        <SettingsRowStatus status="preview" />
      </div>
      {isAddingModel ? (
        <form className="settings-model-add-form" onSubmit={onSubmitCustomModel}>
          <input
            aria-label="模型名称"
            autoFocus
            onChange={(event) => setModelDraftName(event.currentTarget.value)}
            placeholder="输入模型名称"
            value={modelDraftName}
          />
          <button disabled={!modelDraftName.trim()} type="submit">保存模型</button>
          <button
            onClick={() => {
              setIsAddingModel(false)
              setModelDraftName('')
            }}
            type="button"
          >
            取消
          </button>
        </form>
      ) : (
        <button className="settings-action-button" onClick={() => setIsAddingModel(true)} type="button">
          添加模型
        </button>
      )}
    </div>
  )

  const getSettingsSectionClass = (id: SettingsSectionId) => (
    activeSettingsSection === id ? 'settings-section is-active' : 'settings-section'
  )

  const getPermissionModeDescription = (mode: string) => (
    permissionModeDescriptions[mode] ?? '控制 CrawClaw 可以访问和操作的范围。'
  )

  return (
    <div className="settings-workspace">
      <header className="settings-workspace__header">
        <h1>设置</h1>
        <p>调整 CrawClaw 的默认规则和偏好，不重复管理智能体、记忆、插件或自动化。</p>
      </header>

      <div className="settings-workspace__body">
        <section aria-label="常规" className={getSettingsSectionClass('general')} id="settings-general">
          <header className="settings-section__header">
            <h2>常规</h2>
            <p>控制桌面应用的基础使用习惯。</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow('默认打开页面', '启动后默认进入哪个工作区。', uiDefaults.defaultPage, ['新对话', '记忆', '智能体'], (value) => updateUiDefaults({ defaultPage: value }), 'preview')}
            {renderSettingsSelectRow('语言', '设置桌面界面的显示语言。', uiDefaults.language, ['中文', 'English'], (value) => updateUiDefaults({ language: value }), 'preview')}
            {renderSettingsSelectRow('外观', '选择界面颜色模式。', uiDefaults.appearance, ['跟随系统', '浅色', '深色'], (value) => updateUiDefaults({ appearance: value }), 'preview')}
            {renderSettingsToggleRow('启动时打开 CrawClaw', '登录系统后自动打开桌面应用。', uiDefaults.launchAtLogin, () => {}, 'planned', true)}
            {renderSettingsToggleRow('在菜单栏显示', '保留菜单栏入口，便于快速唤起。', uiDefaults.showInMenuBar, () => {}, 'planned', true)}
          </div>
        </section>

        <section aria-label="模型与回复" className={getSettingsSectionClass('model')} id="settings-model">
          <header className="settings-section__header">
            <h2>模型与回复</h2>
            <p>设置新对话默认使用的模型、推理强度和回复偏好。</p>
          </header>
          <div className="settings-group">
            {renderModelConfigurationSelector()}
            {renderSettingsSelectRow('默认模型', '选择 CrawClaw 默认使用的模型。', taskDefaults.selectedModel, modelOptions, (value) => updateTaskDefaults({ selectedModel: value }), 'active')}
            {renderAddModelRow()}
            {renderSettingsSelectRow('思考等级', '决定回复前花多少时间推理。', taskDefaults.selectedThinking, preferences.thinkingOptions, (value) => updateTaskDefaults({ selectedThinking: value }), 'active')}
            {renderSettingsSelectRow('回复速度', '控制回复时更重视速度还是稳定性。', taskDefaults.responseSpeed, ['标准', '更快', '更稳'], (value) => updateTaskDefaults({ responseSpeed: value }), 'preview')}
            {renderSettingsToggleRow('默认允许工具', '新对话默认允许 CrawClaw 使用工具完成任务。', taskDefaults.allowTools, () => updateTaskDefaults({ allowTools: !taskDefaults.allowTools }), 'active')}
            {renderSettingsToggleRow('显示推理摘要', '在适合的回复里显示简短思考摘要。', taskDefaults.showReasoningSummary, () => updateTaskDefaults({ showReasoningSummary: !taskDefaults.showReasoningSummary }), 'active')}
          </div>
        </section>

        <section aria-label="权限与确认" className={getSettingsSectionClass('permissions')} id="settings-permissions">
          <header className="settings-section__header">
            <h2>权限与确认</h2>
            <p>控制 CrawClaw 默认能查看或操作哪些内容。</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow(
              '权限模式',
              '选择 CrawClaw 默认能查看或操作哪些内容。',
              taskDefaults.permissionMode,
              preferences.permissionModeOptions,
              (value) => updateTaskDefaults({ permissionMode: value }),
              'active',
              getPermissionModeDescription,
            )}
            {renderSettingsToggleRow('修改文件前确认', '写入或覆盖文件前先询问你。', confirmationDefaults.confirmFileChanges, () => updateConfirmationDefaults({ confirmFileChanges: !confirmationDefaults.confirmFileChanges }), 'active')}
            {renderSettingsToggleRow('执行命令前确认', '运行本机命令前先显示确认。', confirmationDefaults.confirmCommands, () => updateConfirmationDefaults({ confirmCommands: !confirmationDefaults.confirmCommands }), 'active')}
            {renderSettingsToggleRow('操作外部应用前确认', '控制浏览器、日历或其他应用前先确认。', confirmationDefaults.confirmExternalApps, () => updateConfirmationDefaults({ confirmExternalApps: !confirmationDefaults.confirmExternalApps }), 'active')}
            {renderSettingsToggleRow('高风险操作始终确认', '删除、发布、支付等操作始终需要确认。', confirmationDefaults.confirmHighRisk, () => updateConfirmationDefaults({ confirmHighRisk: !confirmationDefaults.confirmHighRisk }), 'active')}
          </div>
        </section>

        <section aria-label="记忆偏好" className={getSettingsSectionClass('memory')} id="settings-memory">
          <header className="settings-section__header">
            <h2>记忆偏好</h2>
            <p>控制 CrawClaw 什么时候记住、整理和清理信息。</p>
          </header>
          <div className="settings-group">
            {renderSettingsToggleRow('自动记住偏好', '允许 CrawClaw 自动保存稳定的个人偏好。', memoryDefaults.rememberPreferences, () => updateMemoryDefaults({ rememberPreferences: !memoryDefaults.rememberPreferences }), 'preview')}
            {renderSettingsToggleRow('整理项目上下文', '允许 CrawClaw 将项目相关事实整理为长期上下文。', memoryDefaults.rememberProjectContext, () => updateMemoryDefaults({ rememberProjectContext: !memoryDefaults.rememberProjectContext }), 'preview')}
            {renderSettingsToggleRow('做梦整理记忆', '空闲时整理最近对话中的长期记忆。', memoryDefaults.memoryDreamEnabled, () => updateMemoryDefaults({ memoryDreamEnabled: !memoryDefaults.memoryDreamEnabled }), 'preview')}
            {renderSettingsSelectRow('做梦频率', '决定记忆整理触发的频率。', memoryDefaults.memoryDreamFrequency, ['空闲时', '每天', '手动'], (value) => updateMemoryDefaults({ memoryDreamFrequency: value }), 'preview')}
            {renderSettingsSelectRow('清理记忆确认', '清理记忆前是否需要再次确认。', memoryDefaults.memoryCleanupConfirmation, ['每次确认', '仅重要记忆', '不自动清理'], (value) => updateMemoryDefaults({ memoryCleanupConfirmation: value }), 'preview')}
          </div>
        </section>

        <section aria-label="通知" className={getSettingsSectionClass('notifications')} id="settings-notifications">
          <header className="settings-section__header">
            <h2>通知</h2>
            <p>决定什么时候让 CrawClaw 主动提醒你。</p>
          </header>
          <div className="settings-group">
            {renderSettingsToggleRow('任务完成通知', '长任务完成后发送通知。', notificationDefaults.notifyTaskDone, () => updateNotificationDefaults({ notifyTaskDone: !notificationDefaults.notifyTaskDone }), 'active')}
            {renderSettingsToggleRow('需要确认时通知', '需要你确认权限或操作时提醒。', notificationDefaults.notifyConfirmNeeded, () => updateNotificationDefaults({ notifyConfirmNeeded: !notificationDefaults.notifyConfirmNeeded }), 'active')}
            {renderSettingsToggleRow('做梦完成通知', '记忆整理完成后提醒。', notificationDefaults.notifyDreamDone, () => updateNotificationDefaults({ notifyDreamDone: !notificationDefaults.notifyDreamDone }), 'active')}
            {renderSettingsToggleRow('自动化失败通知', '自动化任务失败时提醒。', notificationDefaults.notifyAutomationFailed, () => updateNotificationDefaults({ notifyAutomationFailed: !notificationDefaults.notifyAutomationFailed }), 'active')}
            {renderSettingsToggleRow('声音提示', '通知出现时播放提示音。', notificationDefaults.notificationSound, () => updateNotificationDefaults({ notificationSound: !notificationDefaults.notificationSound }), 'active')}
          </div>
        </section>

        <section aria-label="数据与隐私" className={getSettingsSectionClass('privacy')} id="settings-privacy">
          <header className="settings-section__header">
            <h2>数据与隐私</h2>
            <p>查看本机数据位置，并保留后续清理与导出入口。</p>
          </header>
          <div className="settings-group">
            {renderSettingsValueRow('本机数据位置', 'CrawClaw Desktop 默认把数据保存在本机。', privacyDefaults.dataLocation, 'preview')}
            {renderSettingsActionRow('清理缓存', '清理临时预览、下载和运行缓存。')}
            {renderSettingsActionRow('导出数据', '导出本机偏好、记忆和设置快照。')}
            {renderSettingsActionRow('删除本机数据', '删除前会要求再次确认。', 'danger')}
          </div>
        </section>

        <section aria-label="高级" className={getSettingsSectionClass('advanced')} id="settings-advanced">
          <header className="settings-section__header">
            <h2>高级</h2>
            <p>只保留诊断入口和状态表达，不进入普通工作流。</p>
          </header>
          <div className="settings-group">
            {renderSettingsSelectRow('日志级别', '控制本机诊断日志的详细程度。', advancedDefaults.logLevel, ['标准', '详细', '错误'], (value) => updateAdvancedDefaults({ logLevel: value }), 'preview')}
            {renderSettingsValueRow('Runtime 状态', '当前本机 CrawClaw runtime 的摘要状态。', runtimeStatus, 'active')}
            {renderSettingsActionRow('诊断信息', '生成给开发者排查问题用的本机诊断信息。')}
            {renderSettingsActionRow('重置桌面状态', '只重置桌面 UI 状态，不删除真实项目文件。', 'danger')}
          </div>
        </section>
      </div>
    </div>
  )
}

function SettingsRowStatus({ status }: { status: SettingsRowStatusValue }) {
  const label = status === 'active' ? '已接入' : status === 'preview' ? '偏好预览' : '计划中'
  return <span className={`settings-row-status is-${status}`}>{label}</span>
}

export function SettingsSidebar({
  activeSettingsSection,
  onReturnToApp,
  onSelectSection,
}: SettingsSidebarProps) {
  return (
    <aside aria-label="设置导航" className="desktop-sidebar settings-sidebar">
      <button className="settings-sidebar__back" onClick={onReturnToApp} type="button">
        <ChevronLeft aria-hidden="true" size={15} strokeWidth={2} />
        <span>返回应用</span>
      </button>
      <nav aria-label="设置分类" className="settings-sidebar__nav">
        {settingsSections.map((section) => (
          <button
            className={activeSettingsSection === section.id ? 'is-active' : ''}
            key={section.id}
            onClick={() => onSelectSection(section.id)}
            type="button"
          >
            <section.icon aria-hidden="true" size={15} strokeWidth={2} />
            <span>{section.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

import {
  ArrowUp,
  Blocks,
  Bot,
  Brain,
  ChevronDown,
  Clock3,
  FileText,
  Image as ImageIcon,
  Mic,
  Play,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import type {
  AddAttachmentMessageInput,
  AddMediaMessageInput,
  AddSkillCallMessageInput,
  AddVoiceMessageInput,
  AddWorkflowMessageInput,
  AgentProfile,
  ConversationState,
  DesktopIconKey,
  DesktopPreferences,
  PermissionRequest,
  SkillSuggestion,
} from '../desktop-api'
import { Composer, PermissionModeButton } from '../ui/composer'
import { IconButton } from '../ui/icon-button'
import { ChatThread } from './chat-thread'
import type { PreferencePatch } from './chat-workspace-model'

type ChatWorkspaceProps = {
  agents: AgentProfile[]
  conversation: ConversationState
  modelOptions: string[]
  onAddAttachmentMessage: (input: AddAttachmentMessageInput) => void
  onAddMediaMessage: (input: AddMediaMessageInput) => void
  onAddSkillCallMessage: (input: AddSkillCallMessageInput) => void
  onAddVoiceMessage: (input: AddVoiceMessageInput) => void
  onAddWorkflowMessage: (input: AddWorkflowMessageInput) => void
  onDecidePermission: (requestId: string, status: 'approved' | 'denied') => void
  onPreferenceUpdate: (patch: Partial<PreferencePatch>) => void
  onQueuedInputTextConsumed?: () => void
  onSendMessage: (message: string) => void
  onSelectedChatAgentChange: (agentId: string) => void
  permissionRequest: PermissionRequest
  preferences: DesktopPreferences
  queuedInputText?: string
  renderDesktopIcon: (icon: DesktopIconKey) => ReactNode
  selectedChatAgentId: string
}

export function ChatWorkspace({
  agents,
  conversation,
  modelOptions,
  onAddAttachmentMessage,
  onAddMediaMessage,
  onAddSkillCallMessage,
  onAddVoiceMessage,
  onAddWorkflowMessage,
  onDecidePermission,
  onPreferenceUpdate,
  onQueuedInputTextConsumed,
  onSendMessage,
  onSelectedChatAgentChange,
  permissionRequest,
  preferences,
  queuedInputText,
  renderDesktopIcon,
  selectedChatAgentId,
}: ChatWorkspaceProps) {
  const [composerText, setComposerText] = useState('')
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState<'agent' | 'thinking' | 'model' | 'permission' | null>(null)
  const slashCommands = conversation.slashCommands
  const selectedAgent = agents.find((agent) => agent.id === selectedChatAgentId) ?? null
  const isAgentMode = Boolean(selectedAgent)
  const skillCommands = selectedAgent
    ? selectedAgent.skills.filter((skill) => skill.enabled).map(agentSkillSuggestion)
    : conversation.skillCommands
  const approvalState = permissionRequest.status
  const hasPermissionRequest = Boolean(permissionRequest.id)
  const permissionMode = selectedAgent?.permissionMode ?? preferences.permissionMode
  const selectedModel = selectedAgent?.model ?? preferences.selectedModel
  const selectedThinking = selectedAgent?.thinking ?? preferences.selectedThinking
  const commandTrigger = composerText.startsWith('/') ? '/' : composerText.startsWith('@') ? '@' : null
  const commandQuery = commandTrigger ? composerText.slice(1).trim().toLowerCase() : ''
  const visibleSlashCommands = isCommandMenuOpen && commandTrigger === '/'
    ? slashCommands.filter((command) => {
        if (!commandQuery) {
          return true
        }

        return command.command.includes(commandQuery) || command.label.toLowerCase().includes(commandQuery)
      })
    : []
  const visibleSkillCommands = isCommandMenuOpen && commandTrigger === '@'
    ? skillCommands.filter((skill) => {
        if (!commandQuery) {
          return true
        }

        return skill.mention.toLowerCase().includes(commandQuery) || skill.label.toLowerCase().includes(commandQuery)
      })
    : []
  const closeFloatingControls = () => {
    setSelectorOpen(null)
    setIsAttachmentMenuOpen(false)
    setIsCommandMenuOpen(false)
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeFloatingControls()
      }
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (
        !(target instanceof Element)
        || target.closest('.composer-area')
        || target.closest('.plugin-filter')
        || target.closest('.selector-menu')
      ) {
        return
      }

      closeFloatingControls()
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  useEffect(() => {
    if (!queuedInputText) {
      return
    }

    setComposerText(queuedInputText)
    setIsCommandMenuOpen(false)
    onQueuedInputTextConsumed?.()
  }, [onQueuedInputTextConsumed, queuedInputText])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFloatingControls()
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    event.preventDefault()
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    if (items.length === 0) {
      return
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement)
    const fallbackIndex = event.key === 'ArrowDown' ? -1 : 0
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (currentIndex === -1 ? fallbackIndex : currentIndex) + direction
    items[(nextIndex + items.length) % items.length]?.focus()
  }

  const submitDraft = () => {
    const message = composerText.trim()
    if (!message) {
      return
    }

    onSendMessage(message)
    setComposerText('')
    setIsCommandMenuOpen(false)
  }

  const updateComposerText = (value: string) => {
    setComposerText(value)
    setIsCommandMenuOpen(value.startsWith('/') || value.startsWith('@'))
  }

  const addMediaComposerMessage = (mediaType: 'image' | 'video') => {
    onAddMediaMessage({
      items: [
        {
          detail: mediaType === 'image' ? '待选择本地图片' : '待选择本地视频',
          id: mediaType === 'image' ? 'composer-image' : 'composer-video',
          kind: mediaType,
          label: mediaType === 'image' ? '图片预览' : '视频预览',
        },
      ],
      mediaType,
      title: mediaType === 'image' ? '图片消息' : '视频消息',
    })
    setIsAttachmentMenuOpen(false)
  }

  const addWorkflowComposerMessage = (workflowKind: 'comfyui' | 'n8n' | 'schedule') => {
    const workflowCopy = {
      comfyui: {
        detail: '图像生成工作流已加入本轮对话',
        steps: [
          { id: 'prompt', label: 'Prompt', status: 'done' },
          { id: 'queue', label: 'Queue', status: 'active' },
          { id: 'render', label: 'Render', status: 'pending' },
        ],
        title: 'ComfyUI 图像工作流',
      },
      n8n: {
        detail: '自动化工作流已加入本轮对话',
        steps: [
          { id: 'webhook', label: 'Webhook', status: 'done' },
          { id: 'agent', label: 'Agent', status: 'active' },
          { id: 'notify', label: 'Notify', status: 'pending' },
        ],
        title: 'n8n 自动化',
      },
      schedule: {
        detail: '定时执行已加入本轮对话',
        steps: [
          { id: 'plan', label: 'Plan', status: 'done' },
          { id: 'schedule', label: 'Schedule', status: 'active' },
          { id: 'run', label: 'Run', status: 'pending' },
        ],
        title: '定时任务',
      },
    }[workflowKind]

    onAddWorkflowMessage({
      detail: workflowCopy.detail,
      status: 'running',
      steps: workflowCopy.steps,
      title: workflowCopy.title,
      workflowKind,
    })
    setIsAttachmentMenuOpen(false)
  }

  const toggleVoiceInput = () => {
    if (isListening) {
      onAddVoiceMessage({
        direction: 'input',
        durationLabel: '00:03',
        title: '语音输入',
        transcript: composerText.trim() || '语音消息待转写',
      })
    }
    setIsListening((value) => !value)
  }

  return (
    <>
      <ChatThread
        conversation={conversation}
        onDecidePermission={onDecidePermission}
        permissionRequest={permissionRequest}
      />

      <Composer
        approvalNotice={hasPermissionRequest
          ? (
          <>
            <div className={`permission-review is-${approvalState}`} aria-label="权限审核">
              <div className="permission-review__icon">
                <ShieldCheck aria-hidden="true" size={15} strokeWidth={2.1} />
              </div>
              <div className="permission-review__body">
                <strong>{approvalState === 'pending' ? '权限审核' : approvalState === 'approved' ? '已允许一次' : '已拒绝'}</strong>
                <span>
                  {approvalState === 'pending'
                    ? 'CrawClaw 请求读取当前窗口内容，用于继续本轮 UI 调整。'
                    : approvalState === 'approved'
                      ? '这次操作已通过，继续保持本地静态 UI 演示。'
                      : '这次权限请求已拒绝，界面停留在本地预览状态。'}
                </span>
              </div>
              {approvalState === 'pending' ? (
                <div className="permission-review__actions">
                  <button onClick={() => onDecidePermission(permissionRequest.id, 'denied')} type="button">
                    拒绝
                  </button>
                  <button className="permission-review__allow" onClick={() => onDecidePermission(permissionRequest.id, 'approved')} type="button">
                    允许一次
                  </button>
                </div>
              ) : null}
            </div>
          </>
            )
          : null}
        commandMenu={
          visibleSlashCommands.length > 0 ? (
            <div aria-label="命令菜单" className="command-menu" onKeyDown={handleMenuKeyDown} role="menu">
              <p>命令</p>
              {visibleSlashCommands.map((command) => (
                <button
                  aria-label={command.label}
                  key={command.command}
                  onClick={() => {
                    setComposerText(command.command)
                    setIsCommandMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="command-menu__icon">
                    {renderDesktopIcon(command.icon)}
                  </span>
                  <span className="command-menu__body">
                    <strong>{command.label}</strong>
                    <small>{command.detail}</small>
                  </span>
                  <span className="command-menu__shortcut">{command.command.trim()}</span>
                </button>
              ))}
            </div>
          ) : visibleSkillCommands.length > 0 ? (
            <div aria-label="Skill 菜单" className="command-menu command-menu--skills" onKeyDown={handleMenuKeyDown} role="menu">
              <p>Skill</p>
              {visibleSkillCommands.map((skill) => (
                <button
                  aria-label={skill.label}
                  key={skill.mention}
                  onClick={() => {
                    setComposerText(skill.mention)
                    onAddSkillCallMessage({
                      detail: skill.detail,
                      skillId: skill.id,
                      status: 'ready',
                      title: skill.label,
                    })
                    setIsCommandMenuOpen(false)
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="command-menu__icon">
                    {renderDesktopIcon(skill.icon)}
                  </span>
                  <span className="command-menu__body">
                    <strong>{skill.label}</strong>
                    <small>{skill.detail}</small>
                  </span>
                  <span className="command-menu__shortcut">{skill.mention.trim()}</span>
                </button>
              ))}
            </div>
          ) : null
        }
        leftControls={
          <>
            <IconButton
              icon={Plus}
              label="添加"
              onClick={() => {
                setIsAttachmentMenuOpen((open) => !open)
                setSelectorOpen(null)
              }}
            />
            {isAttachmentMenuOpen ? (
              <div aria-label="添加内容菜单" className="selector-menu selector-menu--attach" onKeyDown={handleMenuKeyDown} role="menu">
                {[
                  { label: '添加图片', icon: ImageIcon, onClick: () => addMediaComposerMessage('image') },
                  { label: '添加视频', icon: Play, onClick: () => addMediaComposerMessage('video') },
                  {
                    label: '添加文件',
                    icon: FileText,
                    onClick: () => {
                      onAddAttachmentMessage({
                        detail: '本地文件附件',
                        fileName: '未命名文件',
                        mediaType: 'application/octet-stream',
                        title: '文件附件',
                      })
                      setIsAttachmentMenuOpen(false)
                    },
                  },
                  { label: '添加工作流', icon: Blocks, onClick: () => addWorkflowComposerMessage('n8n') },
                  { label: '添加图像工作流', icon: ImageIcon, onClick: () => addWorkflowComposerMessage('comfyui') },
                  { label: '添加定时任务', icon: Clock3, onClick: () => addWorkflowComposerMessage('schedule') },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.onClick}
                    role="menuitem"
                    type="button"
                  >
                    <item.icon aria-hidden="true" size={14} strokeWidth={2} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <button
              aria-expanded={selectorOpen === 'agent'}
              aria-haspopup="menu"
              aria-label={`对话模式 ${selectedAgent?.name ?? '本机默认'}`}
              className="agent-mode-pill"
              onClick={() => {
                setSelectorOpen(selectorOpen === 'agent' ? null : 'agent')
                setIsAttachmentMenuOpen(false)
              }}
              type="button"
            >
              <Bot aria-hidden="true" size={14} strokeWidth={2} />
              <span>{selectedAgent?.name ?? '本机默认'}</span>
              <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
            </button>
            {selectorOpen === 'agent' ? (
              <div aria-label="对话模式选择" className="selector-menu selector-menu--agent" onKeyDown={handleMenuKeyDown} role="menu">
                <button
                  className={!selectedAgent ? 'is-selected' : ''}
                  onClick={() => {
                    onSelectedChatAgentChange('')
                    setSelectorOpen(null)
                  }}
                  role="menuitem"
                  type="button"
                >
                  本机默认
                </button>
                {agents.map((agent) => (
                  <button
                    className={agent.id === selectedAgent?.id ? 'is-selected' : ''}
                    key={agent.id}
                    onClick={() => {
                      onSelectedChatAgentChange(agent.id)
                      setSelectorOpen(null)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {agent.name}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              aria-expanded={selectorOpen === 'thinking'}
              aria-haspopup="menu"
              aria-label={`思考等级 ${selectedThinking}`}
              className="thinking-level-pill"
              onClick={() => {
                if (!isAgentMode) {
                  setSelectorOpen(selectorOpen === 'thinking' ? null : 'thinking')
                }
              }}
              type="button"
            >
              <Brain aria-hidden="true" size={14} strokeWidth={2} />
              <span>思考 {selectedThinking}</span>
              <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
            </button>
            {selectorOpen === 'thinking' && !isAgentMode ? (
              <div aria-label="思考等级选择" className="selector-menu selector-menu--thinking" onKeyDown={handleMenuKeyDown} role="menu">
                {preferences.thinkingOptions.map((level) => (
                  <button
                    className={level === selectedThinking ? 'is-selected' : ''}
                    key={level}
                    onClick={() => {
                      onPreferenceUpdate({ selectedThinking: level })
                      setSelectorOpen(null)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {level}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              aria-expanded={selectorOpen === 'model'}
              aria-haspopup="menu"
              aria-label={`模型 ${selectedModel}`}
              className="model-pill"
              onClick={() => {
                if (!isAgentMode) {
                  setSelectorOpen(selectorOpen === 'model' ? null : 'model')
                }
              }}
              type="button"
            >
              <span>{selectedModel}</span>
              <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
            </button>
            {selectorOpen === 'model' && !isAgentMode ? (
              <div aria-label="模型选择" className="selector-menu selector-menu--model" onKeyDown={handleMenuKeyDown} role="menu">
                {modelOptions.map((model) => (
                  <button
                    className={model === selectedModel ? 'is-selected' : ''}
                    key={model}
                    onClick={() => {
                      onPreferenceUpdate({ selectedModel: model })
                      setSelectorOpen(null)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {model}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        }
        onInputChange={updateComposerText}
        onSubmit={submitDraft}
        metaControls={
          <>
            <PermissionModeButton
              expanded={selectorOpen === 'permission'}
              label={permissionMode}
              onClick={() => {
                if (!isAgentMode) {
                  setSelectorOpen(selectorOpen === 'permission' ? null : 'permission')
                }
              }}
            />
            {selectorOpen === 'permission' && !isAgentMode ? (
              <div aria-label="权限模式选择" className="selector-menu selector-menu--permission" onKeyDown={handleMenuKeyDown} role="menu">
                {preferences.permissionModeOptions.map((mode) => (
                  <button
                    className={mode === permissionMode ? 'is-selected' : ''}
                    key={mode}
                    onClick={() => {
                      onPreferenceUpdate({ permissionMode: mode })
                      setSelectorOpen(null)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {mode}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        }
        placeholder="告诉 CrawClaw 要做什么..."
        rightControls={
          <>
            {isListening ? (
              <span aria-label="正在收声" className="listening-meter" data-tone="active">
                <span />
                <span />
                <span />
              </span>
            ) : null}
            <IconButton
              className={isListening ? 'composer-voice is-listening' : 'composer-voice'}
              icon={Mic}
              label={isListening ? '停止收声' : '语音输入'}
              onClick={toggleVoiceInput}
            />
            <IconButton className="composer-send" icon={ArrowUp} label="发送" onClick={submitDraft} />
          </>
        }
        value={composerText}
      />
    </>
  )
}

function agentSkillSuggestion(skill: AgentProfile['skills'][number]): SkillSuggestion {
  const mention = skill.trigger.startsWith('@') ? skill.trigger : `@${skill.trigger}`
  return {
    detail: skill.description,
    icon: skill.icon,
    id: skill.id,
    label: skill.name,
    mention,
  }
}

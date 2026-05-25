import {
  ArrowUp,
  Blocks,
  Bot,
  Brain,
  ChevronDown,
  CircleStop,
  Clock3,
  CornerDownRight,
  FileText,
  Image as ImageIcon,
  Mic,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
} from 'lucide-react'
import {
  useEffect,
  useRef,
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
import type { ConfirmationRequestInput } from '../ui/confirmation-dialog'
import { IconButton } from '../ui/icon-button'
import { ChatThread } from './chat-thread'
import type { PreferencePatch } from './chat-workspace-model'
import { modelSupportsConfigurableThinking } from './model-capabilities'
import { normalizeReplyMode } from './reply-mode'

type ChatWorkspaceProps = {
  agents: AgentProfile[]
  conversation: ConversationState
  modelOptions: string[]
  onAddAttachmentMessage: (input: AddAttachmentMessageInput) => void
  onAddMediaMessage: (input: AddMediaMessageInput) => void
  onAddSkillCallMessage: (input: AddSkillCallMessageInput) => void
  onAddVoiceMessage: (input: AddVoiceMessageInput) => void
  onAddWorkflowMessage: (input: AddWorkflowMessageInput) => void
  onAbortMessage: () => void
  onDecidePermission: (requestId: string, status: 'approved' | 'denied') => void
  onOpenAsset: (assetId: string) => void
  onPreferenceUpdate: (patch: Partial<PreferencePatch>) => void
  onQueuedInputTextConsumed?: () => void
  onRevealAsset: (assetId: string) => void
  onRequestConfirmation: (input: ConfirmationRequestInput) => Promise<boolean>
  onSendMessage: (message: string) => void
  onSelectedChatAgentChange: (agentId: string) => void
  onSteerMessage: (text: string, mode: 'restart' | 'followUp') => void
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
  onAbortMessage,
  onDecidePermission,
  onOpenAsset,
  onPreferenceUpdate,
  onQueuedInputTextConsumed,
  onRevealAsset,
  onRequestConfirmation,
  onSendMessage,
  onSelectedChatAgentChange,
  onSteerMessage,
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
  const [steerText, setSteerText] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStartedAtRef = useRef<number>(0)
  const [selectorOpen, setSelectorOpen] = useState<'agent' | 'thinking' | 'model' | 'permission' | null>(null)
  const slashCommands = conversation.slashCommands
  const selectedAgent = agents.find((agent) => agent.id === selectedChatAgentId) ?? null
  const isAgentMode = Boolean(selectedAgent)
  const skillCommands = selectedAgent
    ? selectedAgent.skills.filter((skill) => skill.enabled).map(agentSkillSuggestion)
    : conversation.skillCommands
  const approvalState = permissionRequest.status
  const hasPermissionRequest = Boolean(permissionRequest.id)
  const hasRunningGeneration = conversation.messages.some((message) => (
    message.kind === 'assistant' && message.status === 'running'
  ))
  const permissionMode = selectedAgent?.permissionMode ?? preferences.permissionMode
  const selectedModel = selectedAgent?.model ?? preferences.selectedModel
  const selectedThinking = selectedAgent?.thinking ?? preferences.selectedThinking
  const replyMode = normalizeReplyMode(preferences.taskDefaults.responseSpeed)
  const selectedThinkingSupported = modelSupportsConfigurableThinking(
    selectedModel,
    preferences.modelProfiles,
  )
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
    if (!message || hasRunningGeneration) {
      return
    }

    onSendMessage(message)
    setComposerText('')
    setIsCommandMenuOpen(false)
  }

  const submitSteer = (mode: 'restart' | 'followUp') => {
    const text = steerText.trim()
    if (!text) {
      return
    }
    onSteerMessage(text, mode)
    setSteerText('')
  }

  const updateComposerText = (value: string) => {
    setComposerText(value)
    setIsCommandMenuOpen(value.startsWith('/') || value.startsWith('@'))
  }

  const addMediaComposerMessage = (mediaType: 'image' | 'video') => {
    void pickDesktopFile(mediaType === 'image' ? 'image/*' : 'video/*', async (file) => {
      if (preferences.confirmationDefaults.confirmFileChanges) {
        const confirmed = await onRequestConfirmation({
          title: mediaType === 'image' ? '保存图片媒体' : '保存视频媒体',
          detail: '会把所选媒体保存到 CrawClaw 桌面资源目录，用于本轮对话引用。',
          confirmLabel: '保存',
        })
        if (!confirmed) {
          setIsAttachmentMenuOpen(false)
          return
        }
      }
      const dataBase64 = await fileToBase64(file)
      onAddMediaMessage({
        confirm: preferences.confirmationDefaults.confirmFileChanges ? true : undefined,
        items: [
          {
            detail: file.type || mediaType,
            id: `${mediaType}-${Date.now()}`,
            kind: mediaType,
            label: file.name,
            mimeType: file.type || undefined,
            sizeBytes: file.size,
            status: 'done',
          },
        ],
        mediaType,
        source: {
          dataBase64,
          fileName: file.name,
          kind: 'browserFile',
          mimeType: file.type || mediaType,
        },
        title: mediaType === 'image' ? '图片消息' : '视频消息',
      })
      setIsAttachmentMenuOpen(false)
    })
  }

  const addAttachmentComposerMessage = () => {
    void pickDesktopFile('', async (file) => {
      if (preferences.confirmationDefaults.confirmFileChanges) {
        const confirmed = await onRequestConfirmation({
          title: '保存文件附件',
          detail: '会把所选文件保存到 CrawClaw 桌面资源目录，用于本轮对话引用。',
          confirmLabel: '保存',
        })
        if (!confirmed) {
          setIsAttachmentMenuOpen(false)
          return
        }
      }
      const dataBase64 = await fileToBase64(file)
      onAddAttachmentMessage({
        confirm: preferences.confirmationDefaults.confirmFileChanges ? true : undefined,
        detail: '本地文件附件',
        fileName: file.name,
        mediaType: file.type || 'application/octet-stream',
        source: {
          dataBase64,
          fileName: file.name,
          kind: 'browserFile',
          mimeType: file.type || 'application/octet-stream',
        },
        title: '文件附件',
      })
      setIsAttachmentMenuOpen(false)
    })
  }

  const addWorkflowComposerMessage = (workflowKind: 'comfyui' | 'n8n' | 'schedule') => {
    const workflowCopy = {
      comfyui: {
        action: 'status',
        detail: '图像生成工作流已加入本轮对话',
        input: { baseUrl: 'http://127.0.0.1:8188' },
        steps: [
          { id: 'prompt', label: 'Prompt', status: 'done' },
          { id: 'queue', label: 'Queue', status: 'active' },
          { id: 'render', label: 'Render', status: 'pending' },
        ],
        title: 'ComfyUI 图像工作流',
      },
      n8n: {
        action: 'list',
        detail: '自动化工作流已加入本轮对话',
        input: { limit: 10 },
        steps: [
          { id: 'webhook', label: 'Webhook', status: 'done' },
          { id: 'agent', label: 'Agent', status: 'active' },
          { id: 'notify', label: 'Notify', status: 'pending' },
        ],
        title: 'n8n 自动化',
      },
      schedule: {
        action: 'cron.status',
        detail: '定时执行已加入本轮对话',
        input: {},
        steps: [
          { id: 'plan', label: 'Plan', status: 'done' },
          { id: 'schedule', label: 'Schedule', status: 'active' },
          { id: 'run', label: 'Run', status: 'pending' },
        ],
        title: '定时任务',
      },
    }[workflowKind]

    const requiresHighRiskConfirm = preferences.confirmationDefaults.confirmHighRisk
      && isHighRiskWorkflowAction(workflowKind, workflowCopy.action)
    void (async () => {
      if (requiresHighRiskConfirm) {
        const confirmed = await onRequestConfirmation({
          title: '执行工作流',
          detail: '该工作流可能调用外部服务或修改本地状态。确认后才会加入本轮对话执行。',
          confirmLabel: '继续',
          tone: 'danger',
        })
        if (!confirmed) {
          setIsAttachmentMenuOpen(false)
          return
        }
      }
      onAddWorkflowMessage({
        action: workflowCopy.action,
        confirm: requiresHighRiskConfirm ? true : undefined,
        detail: workflowCopy.detail,
        input: workflowCopy.input,
        status: 'running',
        steps: workflowCopy.steps,
        title: workflowCopy.title,
        workflowKind,
      })
      setIsAttachmentMenuOpen(false)
    })()
  }

  const toggleVoiceInput = () => {
    if (isListening) {
      mediaRecorderRef.current?.stop()
      setIsListening(false)
      return
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onAddVoiceMessage({
        direction: 'input',
        durationLabel: '00:00',
        title: '语音输入不可用',
        transcript: composerText.trim() || '当前浏览器不支持录音。',
      })
      return
    }

    void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const recorder = new MediaRecorder(stream)
      voiceChunksRef.current = []
      voiceStartedAtRef.current = Date.now()
      mediaRecorderRef.current = recorder
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data)
        }
      })
      recorder.addEventListener('stop', () => {
        const durationSeconds = Math.max(1, Math.round((Date.now() - voiceStartedAtRef.current) / 1000))
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        stream.getTracks().forEach((track) => track.stop())
        mediaRecorderRef.current = null
        voiceChunksRef.current = []
        void blobToBase64(blob).then((dataBase64) => {
          onAddVoiceMessage({
            direction: 'input',
            durationLabel: formatDurationLabel(durationSeconds),
            source: {
              dataBase64,
              fileName: `voice-${Date.now()}.webm`,
              kind: 'browserFile',
              mimeType: blob.type || 'audio/webm',
            },
            title: '语音输入',
            transcript: composerText.trim() || '语音消息待转写',
          })
        })
      })
      recorder.start()
      setIsListening(true)
    }).catch((error: unknown) => {
      onAddVoiceMessage({
        direction: 'input',
        durationLabel: '00:00',
        title: '语音输入失败',
        transcript: error instanceof Error ? error.message : '无法访问麦克风。',
      })
    })
  }

  return (
    <>
      <ChatThread
        conversation={conversation}
        onDecidePermission={onDecidePermission}
        onOpenAsset={onOpenAsset}
        onRevealAsset={onRevealAsset}
        permissionRequest={permissionRequest}
        replyMode={replyMode}
      />

      <Composer
        approvalNotice={hasRunningGeneration || hasPermissionRequest
          ? (
          <>
            {hasRunningGeneration ? (
              <div className="generation-control" aria-label="当前生成控制">
                <input
                  aria-label="修正当前回复"
                  onChange={(event) => setSteerText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitSteer('followUp')
                    }
                  }}
                  placeholder="修正当前回复..."
                  type="text"
                  value={steerText}
                />
                <button disabled={!steerText.trim()} onClick={() => submitSteer('restart')} type="button">
                  <RefreshCcw aria-hidden="true" size={14} strokeWidth={2} />
                  重启生成
                </button>
                <button disabled={!steerText.trim()} onClick={() => submitSteer('followUp')} type="button">
                  <CornerDownRight aria-hidden="true" size={14} strokeWidth={2} />
                  排队追问
                </button>
              </div>
            ) : null}
            {hasPermissionRequest ? (
            <div className={`permission-review is-${approvalState}`} aria-label="权限审核">
              <div className="permission-review__icon">
                <ShieldCheck aria-hidden="true" size={15} strokeWidth={2.1} />
              </div>
              <div className="permission-review__body">
                <strong>
                  {approvalState === 'pending'
                    ? permissionRequest.title || '权限审核'
                    : approvalState === 'approved'
                      ? '已允许一次'
                      : '已拒绝'}
                </strong>
                <span>
                  {approvalState === 'pending'
                    ? permissionRequest.detail || 'CrawClaw 请求执行需要确认的操作。'
                    : approvalState === 'approved'
                      ? `这次操作已通过。${permissionRequest.detail || ''}`
                      : `这次权限请求已拒绝。${permissionRequest.detail || ''}`}
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
            ) : null}
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
                    onClick: addAttachmentComposerMessage,
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
              disabled={!selectedThinkingSupported}
              onClick={() => {
                if (!isAgentMode && selectedThinkingSupported) {
                  setSelectorOpen(selectorOpen === 'thinking' ? null : 'thinking')
                }
              }}
              title={selectedThinkingSupported ? undefined : '当前模型不支持可调思考等级，将按模型默认策略运行'}
              type="button"
            >
              <Brain aria-hidden="true" size={14} strokeWidth={2} />
              <span>{selectedThinkingSupported ? `思考 ${selectedThinking}` : '思考 默认'}</span>
              <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
            </button>
            {selectorOpen === 'thinking' && !isAgentMode && selectedThinkingSupported ? (
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
            {hasRunningGeneration ? (
              <IconButton className="composer-send is-stopping" icon={CircleStop} label="停止" onClick={onAbortMessage} />
            ) : (
              <IconButton className="composer-send" icon={ArrowUp} label="发送" onClick={submitDraft} />
            )}
          </>
        }
        value={composerText}
      />
    </>
  )
}

function isHighRiskWorkflowAction(workflowKind: 'comfyui' | 'n8n' | 'schedule', action: string) {
  const normalized = action.trim().toLowerCase()
  if (workflowKind === 'comfyui') {
    return ['run', 'workflow.run', 'queue', 'enqueue', 'submit'].includes(normalized)
  }
  if (workflowKind === 'n8n') {
    return ['run', 'execute', 'trigger', 'workflow.run', 'workflow.execute'].includes(normalized)
  }
  return !['', 'status', 'list', 'cron.status', 'cron.list'].includes(normalized)
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

async function pickDesktopFile(accept: string, onFile: (file: File) => Promise<void>) {
  const input = document.createElement('input')
  input.type = 'file'
  if (accept) {
    input.accept = accept
  }
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) {
      void onFile(file)
    }
  }, { once: true })
  input.click()
}

async function fileToBase64(file: File): Promise<string> {
  return blobToBase64(file)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Unable to read file.'))
      }
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Unable to read file.')))
    reader.readAsDataURL(blob)
  })
  return dataUrl.split(',', 2)[1] ?? ''
}

function formatDurationLabel(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

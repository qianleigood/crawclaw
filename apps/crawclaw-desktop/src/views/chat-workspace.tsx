import {
  ArrowUp,
  Brain,
  ChevronDown,
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
  ConversationState,
  DesktopIconKey,
  DesktopPreferences,
  PermissionRequest,
} from '../desktop-api'
import { Composer, PermissionModeButton } from '../ui/composer'
import { IconButton } from '../ui/icon-button'
import { ChatMediaPreviews } from './chat-media-preview'
import { ChatThread } from './chat-thread'
import {
  batchImagePageSize,
  batchImageTiles,
  videoDurationSeconds,
  videoPreviewStartSeconds,
  type ImagePreview,
  type PreferencePatch,
} from './chat-workspace-model'

type ChatWorkspaceProps = {
  conversation: ConversationState
  modelOptions: string[]
  onDecidePermission: (requestId: string, status: 'approved' | 'denied') => void
  onPreferenceUpdate: (patch: Partial<PreferencePatch>) => void
  onQueuedInputTextConsumed?: () => void
  onSendMessage: (message: string) => void
  permissionRequest: PermissionRequest
  preferences: DesktopPreferences
  queuedInputText?: string
  renderDesktopIcon: (icon: DesktopIconKey) => ReactNode
}

export function ChatWorkspace({
  conversation,
  modelOptions,
  onDecidePermission,
  onPreferenceUpdate,
  onQueuedInputTextConsumed,
  onSendMessage,
  permissionRequest,
  preferences,
  queuedInputText,
  renderDesktopIcon,
}: ChatWorkspaceProps) {
  const [batchImagePage, setBatchImagePage] = useState(0)
  const [composerText, setComposerText] = useState('')
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false)
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null)
  const [videoCurrentSeconds, setVideoCurrentSeconds] = useState(videoPreviewStartSeconds)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [isVideoPreviewOpen, setIsVideoPreviewOpen] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState<'thinking' | 'model' | 'permission' | null>(null)
  const runtimeChecks = conversation.runtimeChecks
  const resultItems = conversation.resultItems
  const slashCommands = conversation.slashCommands
  const skillCommands = conversation.skillCommands
  const approvalState = permissionRequest.status
  const hasPermissionRequest = Boolean(permissionRequest.id)
  const permissionMode = preferences.permissionMode
  const selectedModel = preferences.selectedModel
  const selectedThinking = preferences.selectedThinking
  const batchImagePageCount = Math.ceil(batchImageTiles.length / batchImagePageSize)
  const visibleBatchImageTiles = batchImageTiles.slice(
    batchImagePage * batchImagePageSize,
    batchImagePage * batchImagePageSize + batchImagePageSize,
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

  const closeVideoPreview = () => {
    setIsVideoPreviewOpen(false)
    setIsVideoPlaying(false)
  }

  const closeImagePreview = () => {
    setImagePreview(null)
  }

  const stepImagePreview = (delta: number) => {
    setImagePreview((preview) => {
      if (!preview) {
        return preview
      }

      const count = preview.kind === 'batch' ? batchImageTiles.length : 1
      return {
        ...preview,
        index: Math.min(count - 1, Math.max(0, preview.index + delta)),
      }
    })
  }

  const stepVideoTime = (delta: number) => {
    setVideoCurrentSeconds((seconds) => Math.min(videoDurationSeconds, Math.max(0, seconds + delta)))
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeFloatingControls()
        closeVideoPreview()
        closeImagePreview()
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

  return (
    <>
      <ChatMediaPreviews
        imagePreview={imagePreview}
        isVideoPlaying={isVideoPlaying}
        isVideoPreviewOpen={isVideoPreviewOpen}
        onCloseImagePreview={closeImagePreview}
        onCloseVideoPreview={closeVideoPreview}
        onImagePreviewStep={stepImagePreview}
        onVideoPlayingChange={setIsVideoPlaying}
        onVideoSecondChange={setVideoCurrentSeconds}
        onVideoStep={stepVideoTime}
        videoCurrentSeconds={videoCurrentSeconds}
      />

      <ChatThread
        batchImagePage={batchImagePage}
        batchImagePageCount={batchImagePageCount}
        conversation={conversation}
        resultItems={resultItems}
        runtimeChecks={runtimeChecks}
        setBatchImagePage={setBatchImagePage}
        setImagePreview={setImagePreview}
        setIsVideoPlaying={setIsVideoPlaying}
        setIsVideoPreviewOpen={setIsVideoPreviewOpen}
        setVideoCurrentSeconds={setVideoCurrentSeconds}
        visibleBatchImageTiles={visibleBatchImageTiles}
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
                  { label: '添加图片', icon: ImageIcon },
                  { label: '添加视频', icon: Play },
                  { label: '添加文件', icon: FileText },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setIsAttachmentMenuOpen(false)
                    }}
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
              aria-expanded={selectorOpen === 'thinking'}
              aria-haspopup="menu"
              aria-label={`思考等级 ${selectedThinking}`}
              className="thinking-level-pill"
              onClick={() => setSelectorOpen(selectorOpen === 'thinking' ? null : 'thinking')}
              type="button"
            >
              <Brain aria-hidden="true" size={14} strokeWidth={2} />
              <span>思考 {selectedThinking}</span>
              <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
            </button>
            {selectorOpen === 'thinking' ? (
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
              onClick={() => setSelectorOpen(selectorOpen === 'model' ? null : 'model')}
              type="button"
            >
              <span>{selectedModel}</span>
              <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
            </button>
            {selectorOpen === 'model' ? (
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
              onClick={() => setSelectorOpen(selectorOpen === 'permission' ? null : 'permission')}
            />
            {selectorOpen === 'permission' ? (
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
              onClick={() => setIsListening((value) => !value)}
            />
            <IconButton className="composer-send" icon={ArrowUp} label="发送" onClick={submitDraft} />
          </>
        }
        value={composerText}
      />
    </>
  )
}

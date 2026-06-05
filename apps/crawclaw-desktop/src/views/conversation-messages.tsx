import {
  AlertTriangle,
  Blocks,
  CheckCircle2,
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Mic,
  Play,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react'
import { memo, useMemo } from 'react'
import {
  desktopAssetContentUrl,
  type BadgeTone,
  type ConversationMediaItem,
  type ConversationMessage,
  type PermissionRequest,
  type PermissionStatus,
} from '../desktop-api'
import { Badge } from '../ui/badge'
import { normalizeReplyMode, type ReplyMode } from './reply-mode'

type ConversationMessageListProps = {
  messages: ConversationMessage[]
  onDecidePermission: (requestId: string, status: 'approved' | 'denied') => void
  onOpenAsset: (assetId: string) => void
  onRevealAsset: (assetId: string) => void
  permissionRequest: PermissionRequest
  replyMode: string
}

export const ConversationMessageList = memo(function ConversationMessageList({
  messages,
  onDecidePermission,
  onOpenAsset,
  onRevealAsset,
  permissionRequest,
  replyMode: replyModeValue,
}: ConversationMessageListProps) {
  const replyMode = normalizeReplyMode(replyModeValue)
  const visibleMessages = useMemo(
    () => messages.filter((message) => shouldShowMessage(message, replyMode)),
    [messages, replyMode],
  )

  if (messages.length === 0) {
    return (
      <div className="conversation-empty">
        <Sparkles aria-hidden="true" size={18} strokeWidth={2.1} />
        <strong>开始一个本机任务</strong>
        <p>发送任务后，这里会显示模型回复、工具调用、权限确认和执行结果。</p>
      </div>
    )
  }

  return (
    <ol className="chat-thread">
      {visibleMessages.map((message) => (
        <li
          className={`chat-row chat-row--${message.kind}`}
          data-message-kind={message.kind}
          data-testid="conversation-message"
          key={message.id}
        >
          <MessageBubble
            message={message}
            onDecidePermission={onDecidePermission}
            onOpenAsset={onOpenAsset}
            onRevealAsset={onRevealAsset}
            permissionRequest={permissionRequest}
            replyMode={replyMode}
          />
        </li>
      ))}
    </ol>
  )
})

const MessageBubble = memo(function MessageBubble({
  message,
  onDecidePermission,
  onOpenAsset,
  onRevealAsset,
  permissionRequest,
  replyMode,
}: {
  message: ConversationMessage
  onDecidePermission: (requestId: string, status: 'approved' | 'denied') => void
  onOpenAsset: (assetId: string) => void
  onRevealAsset: (assetId: string) => void
  permissionRequest: PermissionRequest
  replyMode: ReplyMode
}) {
  switch (message.kind) {
    case 'user':
      return (
        <>
          <article className="chat-message conversation-message conversation-message--user">
            <p>{message.text}</p>
            <small>{message.createdAt}</small>
          </article>
          <MessageAvatar kind="user" />
        </>
      )
    case 'assistant':
      return (
        <>
          <MessageAvatar kind="assistant" />
          <article className="chat-message conversation-message">
            <p className="chat-message__speaker">CrawClaw</p>
            {message.status && message.status !== 'done' ? (
              <Badge tone={assistantStatusTone(message.status)}>{assistantStatusLabel(message.status)}</Badge>
            ) : null}
            <p>{message.text || assistantFallbackText(message.status)}</p>
            {message.errorCode ? <small>{message.errorCode}</small> : null}
            <small>{message.createdAt}</small>
          </article>
        </>
      )
    case 'toolCall':
      return (
        <>
          <MessageAvatar kind="tool" />
          <article className="chat-message conversation-message conversation-message--tool">
            <header>
              <Wrench aria-hidden="true" size={15} strokeWidth={2.1} />
              <strong>{message.title}</strong>
              <Badge tone="neutral">调用中</Badge>
            </header>
            {message.detail ? <p>{message.detail}</p> : <p>{message.toolId}</p>}
            <small>{message.createdAt}</small>
          </article>
        </>
      )
    case 'toolResult': {
      const showToolOutput = replyMode === '详细'
      return (
        <>
          <MessageAvatar kind="tool" />
          <article className="chat-message conversation-message conversation-message--tool">
            <header>
              {message.ok
                ? <CheckCircle2 aria-hidden="true" size={15} strokeWidth={2.1} />
                : <AlertTriangle aria-hidden="true" size={15} strokeWidth={2.1} />}
              <strong>{message.title}</strong>
              <Badge tone={message.ok ? 'ok' : 'danger'}>{message.ok ? '完成' : '失败'}</Badge>
            </header>
            {showToolOutput
              ? <pre>{message.text}</pre>
              : <p>{message.ok ? '工具执行完成。详细模式会显示完整输出。' : '工具执行失败。切换详细模式查看完整错误输出。'}</p>}
            <small>{message.createdAt}</small>
          </article>
        </>
      )
    }
    case 'permission': {
      const canDecide = message.status === 'pending' && permissionRequest.id === message.requestId
      return (
        <>
          <MessageAvatar kind="permission" />
          <article className="chat-message conversation-message conversation-message--permission">
            <header>
              <ShieldCheck aria-hidden="true" size={15} strokeWidth={2.1} />
              <strong>{message.title}</strong>
              <Badge tone={permissionTone(message.status)}>{permissionLabel(message.status)}</Badge>
            </header>
            <p>{message.detail}</p>
            {canDecide ? (
              <div className="conversation-message__actions">
                <button onClick={() => onDecidePermission(message.requestId, 'denied')} type="button">
                  拒绝
                </button>
                <button onClick={() => onDecidePermission(message.requestId, 'approved')} type="button">
                  允许一次
                </button>
              </div>
            ) : null}
            <small>{message.createdAt}</small>
          </article>
        </>
      )
    }
    case 'status':
      return (
        <>
          <MessageAvatar kind="status" />
          <article className="chat-message conversation-message conversation-message--status">
            <header>
              <Sparkles aria-hidden="true" size={15} strokeWidth={2.1} />
              <strong>{message.title}</strong>
              <Badge tone={message.tone}>{statusToneLabel(message.tone)}</Badge>
            </header>
            <p>{message.detail}</p>
            <small>{message.createdAt}</small>
          </article>
        </>
      )
    case 'attachment':
      return (
        <>
          <MessageAvatar kind="media" />
          <article className="attachment-bubble" aria-label={message.title}>
            <FileText aria-hidden="true" size={18} strokeWidth={2.1} />
            <div className="attachment-bubble__body">
              <strong>{message.title}</strong>
              <span>{message.fileName} · {message.mediaType}</span>
              {message.status ? <span>{workflowStatusLabel(message.status)}{message.errorCode ? ` · ${message.errorCode}` : ''}</span> : null}
              {message.assetId ? <span>{message.assetId}{message.sizeBytes ? ` · ${formatBytes(message.sizeBytes)}` : ''}</span> : null}
              {message.detail ? <span>{message.detail}</span> : null}
              {message.assetId ? (
                <AssetActionButtons
                  assetId={message.assetId}
                  onOpenAsset={onOpenAsset}
                  onRevealAsset={onRevealAsset}
                />
              ) : null}
            </div>
          </article>
        </>
      )
    case 'media':
      return (
        <>
          <MessageAvatar kind="media" />
          <article className="chat-message conversation-message conversation-message--media">
            <header>
              <ImageIcon aria-hidden="true" size={15} strokeWidth={2.1} />
              <strong>{message.title}</strong>
              <Badge tone="neutral">{message.mediaType}</Badge>
              {message.status ? <Badge tone={message.status === 'failed' ? 'danger' : message.status === 'done' ? 'ok' : 'neutral'}>{workflowStatusLabel(message.status)}</Badge> : null}
            </header>
            <div className="media-stack">
              {message.items.length > 0
                ? message.items.map((item) => (
                  <figure className={`media-bubble media-bubble--${item.kind}`} key={item.id}>
                    <AssetMediaPreview item={item} />
                    <figcaption>
                      <span className="media-caption__label">{item.label}</span>
                      <span className="media-caption__meta">
                        <small>{item.detail ?? item.mimeType ?? item.kind}{item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ''}</small>
                        {item.assetId ? (
                          <AssetActionButtons
                            assetId={item.assetId}
                            onOpenAsset={onOpenAsset}
                            onRevealAsset={onRevealAsset}
                          />
                        ) : null}
                      </span>
                    </figcaption>
                  </figure>
                ))
                : <p>暂无媒体条目</p>}
            </div>
            {message.errorCode ? <p>{message.errorCode}</p> : null}
            <small>{message.createdAt}</small>
          </article>
        </>
      )
    case 'workflow': {
      const activeStep = message.steps.find((step) => step.status === 'active') ?? message.steps[0]
      return (
        <>
          <MessageAvatar kind="workflow" />
          <article className={`workflow-bubble workflow-bubble--${message.workflowKind}`}>
            <header className="workflow-bubble__header">
              <div className="workflow-bubble__title">
                <span className="workflow-bubble__icon">
                  <Blocks aria-hidden="true" size={16} strokeWidth={2.1} />
                </span>
                <div>
                  <strong>{message.title}</strong>
                  <p>{message.detail}</p>
                </div>
              </div>
              <Badge tone={message.status === 'failed' ? 'danger' : message.status === 'done' ? 'ok' : 'neutral'}>{workflowStatusLabel(message.status)}</Badge>
            </header>
            {message.steps.length > 0 ? (
              <div className="workflow-nodes" aria-label="工作流节点状态">
                {message.steps.map((step) => (
                  <span className={`workflow-node--${step.status}`} key={step.id}>
                    {step.label}
                  </span>
                ))}
              </div>
            ) : null}
            {activeStep ? (
              <div className="workflow-current" aria-label="当前执行节点">
                <span>当前节点</span>
                <strong>{activeStep.label}</strong>
              </div>
            ) : null}
            <div className="workflow-meta">
              <span>{message.workflowKind}</span>
              {message.workflowId ? <span>{message.workflowId}</span> : null}
              {message.runId ? <span>{message.runId}</span> : null}
              <span>{message.createdAt}</span>
            </div>
          </article>
        </>
      )
    }
    case 'voice':
      return (
        <>
          <MessageAvatar kind="voice" />
          <article className="chat-message voice-message" aria-label={message.title}>
            <div className="voice-message__icon">
              <Mic aria-hidden="true" size={16} strokeWidth={2.1} />
            </div>
            <div className="voice-message__body">
              <div className="voice-wave" aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => <span key={index} />)}
              </div>
              <p>{message.title} · {message.durationLabel} · {message.direction}</p>
              {message.status ? <p>{workflowStatusLabel(message.status)}{message.errorCode ? ` · ${message.errorCode}` : ''}</p> : null}
              {message.assetId ? <p>{message.assetId}{message.sizeBytes ? ` · ${formatBytes(message.sizeBytes)}` : ''}</p> : null}
              {message.assetId ? (
                <>
                  <audio controls src={desktopAssetContentUrl(message.assetId) ?? undefined} />
                  <AssetActionButtons
                    assetId={message.assetId}
                    onOpenAsset={onOpenAsset}
                    onRevealAsset={onRevealAsset}
                  />
                </>
              ) : null}
              {message.transcript ? <p>{message.transcript}</p> : null}
              <small>{message.createdAt}</small>
            </div>
          </article>
        </>
      )
    case 'skillCall':
      return (
        <>
          <MessageAvatar kind="skill" />
          <article className="call-bubble call-bubble--skill">
            <span className="call-bubble__icon">
              <Sparkles aria-hidden="true" size={16} strokeWidth={2.1} />
            </span>
            <div className="call-bubble__body">
              <div className="call-bubble__header">
                <strong>{message.title}</strong>
                <Badge tone={message.status === 'failed' ? 'danger' : message.status === 'done' ? 'ok' : 'neutral'}>{workflowStatusLabel(message.status)}</Badge>
              </div>
              <p>{message.detail ?? message.skillId}</p>
              <span>{message.createdAt}</span>
            </div>
          </article>
        </>
      )
    case 'error':
      return (
        <>
          <MessageAvatar kind="error" />
          <article className="chat-message conversation-message conversation-message--error">
            <header>
              <AlertTriangle aria-hidden="true" size={15} strokeWidth={2.1} />
              <strong>{message.title}</strong>
              <Badge tone="danger">错误</Badge>
            </header>
            <p>{message.detail}</p>
            <small>{message.createdAt}</small>
          </article>
        </>
      )
  }

  return null
})

function AssetMediaPreview({ item }: { item: ConversationMediaItem }) {
  const assetUrl = item.assetId ? desktopAssetContentUrl(item.assetId) : null
  if (assetUrl && (item.kind === 'image' || item.mimeType?.startsWith('image/'))) {
    return (
      <div className="media-visual media-visual--image has-asset">
        <img alt={item.label} src={assetUrl} />
      </div>
    )
  }
  if (assetUrl && (item.kind === 'video' || item.mimeType?.startsWith('video/'))) {
    return (
      <div className="media-visual media-visual--video has-asset">
        <video controls src={assetUrl} />
      </div>
    )
  }
  return (
    <div className={`media-visual media-visual--${item.kind === 'video' ? 'video' : 'image'}`}>
      <span className="media-loading" aria-hidden="true" />
      {item.kind === 'video' ? (
        <span className="video-play is-playing" aria-hidden="true">
          <Play size={16} fill="currentColor" strokeWidth={0} />
        </span>
      ) : null}
    </div>
  )
}

function AssetActionButtons({
  assetId,
  onOpenAsset,
  onRevealAsset,
}: {
  assetId: string
  onOpenAsset: (assetId: string) => void
  onRevealAsset: (assetId: string) => void
}) {
  return (
    <span className="asset-actions">
      <button aria-label="打开资源" onClick={() => onOpenAsset(assetId)} type="button">
        <ExternalLink aria-hidden="true" size={13} strokeWidth={2} />
      </button>
      <button aria-label="在访达中显示资源" onClick={() => onRevealAsset(assetId)} type="button">
        <FolderOpen aria-hidden="true" size={13} strokeWidth={2} />
      </button>
    </span>
  )
}

function shouldShowMessage(message: ConversationMessage, replyMode: ReplyMode): boolean {
  if (replyMode !== '简洁') {
    return true
  }

  if (message.kind === 'toolCall') {
    return false
  }

  if (message.kind === 'toolResult') {
    return !message.ok
  }

  if (message.kind === 'status') {
    return message.tone === 'danger'
  }

  return true
}

function MessageAvatar({
  kind,
}: {
  kind: 'assistant' | 'error' | 'media' | 'permission' | 'skill' | 'status' | 'tool' | 'user' | 'voice' | 'workflow'
}) {
  const icon = {
    assistant: <Sparkles aria-hidden="true" size={14} strokeWidth={2.1} />,
    error: <AlertTriangle aria-hidden="true" size={14} strokeWidth={2.1} />,
    media: <ImageIcon aria-hidden="true" size={14} strokeWidth={2.1} />,
    permission: <ShieldCheck aria-hidden="true" size={14} strokeWidth={2.1} />,
    skill: <Sparkles aria-hidden="true" size={14} strokeWidth={2.1} />,
    status: <Sparkles aria-hidden="true" size={14} strokeWidth={2.1} />,
    tool: <Wrench aria-hidden="true" size={14} strokeWidth={2.1} />,
    user: <UserRound aria-hidden="true" size={14} strokeWidth={2.1} />,
    voice: <Mic aria-hidden="true" size={14} strokeWidth={2.1} />,
    workflow: <Blocks aria-hidden="true" size={14} strokeWidth={2.1} />,
  }[kind]

  return (
    <span className={`chat-avatar chat-avatar--${kind}`} aria-hidden="true">
      {icon}
    </span>
  )
}

function permissionLabel(status: PermissionStatus) {
  if (status === 'approved') {
    return '已允许'
  }
  if (status === 'denied') {
    return '已拒绝'
  }
  return '待确认'
}

function permissionTone(status: PermissionStatus) {
  if (status === 'approved') {
    return 'ok'
  }
  if (status === 'denied') {
    return 'danger'
  }
  return 'neutral'
}

function statusToneLabel(tone: BadgeTone) {
  if (tone === 'ok') {
    return '正常'
  }
  if (tone === 'danger') {
    return '异常'
  }
  if (tone === 'idle') {
    return '等待'
  }
  return '状态'
}

type AssistantMessageStatus = Extract<ConversationMessage, { kind: 'assistant' }>['status']

function assistantStatusLabel(status: AssistantMessageStatus) {
  if (status === 'running') {
    return '生成中'
  }
  if (status === 'cancelled') {
    return '已取消'
  }
  if (status === 'failed') {
    return '失败'
  }
  return '完成'
}

function assistantStatusTone(status: AssistantMessageStatus): BadgeTone {
  if (status === 'failed') {
    return 'danger'
  }
  if (status === 'cancelled') {
    return 'idle'
  }
  return 'neutral'
}

function assistantFallbackText(status: AssistantMessageStatus) {
  if (status === 'running') {
    return '正在生成回复...'
  }
  if (status === 'cancelled') {
    return '已停止本次生成。'
  }
  if (status === 'failed') {
    return '生成失败。'
  }
  return ''
}

function workflowStatusLabel(status: string) {
  if (status === 'done') {
    return '完成'
  }
  if (status === 'failed') {
    return '失败'
  }
  if (status === 'ready') {
    return '就绪'
  }
  if (status === 'pending') {
    return '等待'
  }
  if (status === 'context') {
    return '上下文'
  }
  return '运行中'
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
}

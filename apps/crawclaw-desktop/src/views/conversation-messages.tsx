import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react'
import type { BadgeTone, ConversationMessage, PermissionRequest, PermissionStatus } from '../desktop-api'
import { Badge } from '../ui/badge'

type ConversationMessageListProps = {
  messages: ConversationMessage[]
  onDecidePermission: (requestId: string, status: 'approved' | 'denied') => void
  permissionRequest: PermissionRequest
}

export function ConversationMessageList({
  messages,
  onDecidePermission,
  permissionRequest,
}: ConversationMessageListProps) {
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
      {messages.map((message) => (
        <li className={`chat-row chat-row--${message.kind}`} key={message.id}>
          <MessageBubble
            message={message}
            onDecidePermission={onDecidePermission}
            permissionRequest={permissionRequest}
          />
        </li>
      ))}
    </ol>
  )
}

function MessageBubble({
  message,
  onDecidePermission,
  permissionRequest,
}: {
  message: ConversationMessage
  onDecidePermission: (requestId: string, status: 'approved' | 'denied') => void
  permissionRequest: PermissionRequest
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
            <p>{message.text}</p>
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
    case 'toolResult':
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
            <pre>{message.text}</pre>
            <small>{message.createdAt}</small>
          </article>
        </>
      )
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
}

function MessageAvatar({
  kind,
}: {
  kind: 'assistant' | 'error' | 'permission' | 'status' | 'tool' | 'user'
}) {
  const icon = kind === 'user'
    ? <UserRound aria-hidden="true" size={14} strokeWidth={2.1} />
    : kind === 'tool'
      ? <Wrench aria-hidden="true" size={14} strokeWidth={2.1} />
      : kind === 'permission'
        ? <ShieldCheck aria-hidden="true" size={14} strokeWidth={2.1} />
        : kind === 'error'
          ? <AlertTriangle aria-hidden="true" size={14} strokeWidth={2.1} />
          : <Sparkles aria-hidden="true" size={14} strokeWidth={2.1} />

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

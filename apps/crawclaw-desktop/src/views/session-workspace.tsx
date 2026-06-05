import {
  Bot,
} from 'lucide-react'
import type { DesktopSessionSummary } from '../desktop-api'

type SessionWorkspaceProps = {
  subagents: DesktopSessionSummary[]
}

export function SessionWorkspace({
  subagents,
}: SessionWorkspaceProps) {
  return (
    <aside className="session-workspace" aria-label="子 agent 活动" data-testid="subagent-activity-panel">
      <header className="session-workspace__header">
        <div>
          <p className="panel-kicker">Subagents</p>
          <h2>子 agent</h2>
        </div>
      </header>

      <section className="session-activity-panel" aria-label="子 agent 活动列表">
        <div className="session-list">
          {subagents.map((session) => (
            <article
              className="session-list-item"
              data-session-key={session.key}
              data-testid="subagent-activity-item"
              key={session.key}
            >
              <Bot aria-hidden="true" size={15} strokeWidth={2.1} />
              <span>
                <strong>{session.title}</strong>
              </span>
              <StatusBadge session={session} />
            </article>
          ))}
        </div>
      </section>
    </aside>
  )
}

function StatusBadge({ session }: { session: DesktopSessionSummary }) {
  const tone = statusTone(session)
  return <small className={`session-status-badge is-${tone}`}>{formatStatusLabel(session)}</small>
}

function formatStatusLabel(session: DesktopSessionSummary) {
  if (session.yielded) {
    return '已 yield'
  }
  const status = session.status.trim().toLowerCase()
  if (status === 'idle') {
    return '空闲'
  }
  if (status === 'failed' || status === 'error') {
    return '失败'
  }
  if (isWorkingSession(session)) {
    return '工作中'
  }
  return session.status || '未知'
}

function statusTone(session: DesktopSessionSummary) {
  if (session.yielded) {
    return 'done'
  }
  const status = session.status.trim().toLowerCase()
  if (status === 'failed' || status === 'error') {
    return 'danger'
  }
  if (isWorkingSession(session)) {
    return 'working'
  }
  return 'idle'
}

function isWorkingSession(session: DesktopSessionSummary) {
  if (session.yielded) {
    return false
  }
  const status = session.status.trim().toLowerCase()
  return status === 'running'
    || status === 'working'
    || status === 'active'
    || status === 'busy'
    || status === 'pending'
}

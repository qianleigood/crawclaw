import { Activity, Database, Plus, Search, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type {
  AgentProfile,
  CreateMemoryItemInput,
  DesktopPreferences,
  MemoryItem,
  MemoryCategory,
  MemoryFilter,
  MemoryWorkspaceState,
  UpdateMemoryItemPatch,
} from '../desktop-api'
import { Badge } from '../ui/badge'
import type { ConfirmationRequestInput } from '../ui/confirmation-dialog'
import { Panel } from '../ui/panel'

type MemoryDraft = {
  category: MemoryCategory
  content: string
  source: string
  summary: string
  tags: string
  title: string
}

type MemoryRuntimeStatus = {
  hindsight?: {
    lifecycle?: {
      managed?: boolean
      mode?: string
      reason?: string | null
      status?: string
    }
    ready?: boolean
  }
  outbox?: {
    statusCounts?: Record<string, number>
    total?: number
  }
  recentActivity?: unknown[]
  status?: string
  worker?: {
    enabled?: boolean
    lastError?: string | null
    lastProcessedCount?: number
    lastRunStatus?: string
  }
}

export const memoryCategories: MemoryFilter[] = ['全部', '偏好', '项目', '经验', '其他']

const editableMemoryCategories = memoryCategories.filter((category): category is MemoryCategory => category !== '全部')

const blankMemoryDraft = (): MemoryDraft => ({
  category: '其他',
  content: '',
  source: '手动',
  summary: '',
  tags: '',
  title: '',
})

function parseMemoryTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

type MemoryWorkspaceProps = {
  agents: AgentProfile[]
  memoryCleanupConfirmation: DesktopPreferences['memoryDefaults']['memoryCleanupConfirmation']
  memoryWorkspace: MemoryWorkspaceState
  onArchiveMemory: (memoryId: string, confirmed?: boolean) => void
  onCreateMemory: (input: CreateMemoryItemInput) => void
  onRequestConfirmation: (input: ConfirmationRequestInput) => Promise<boolean>
  onRunMemoryDream: (agentId: string) => void
  onSelectAgent: (agentId: string) => void
  onSelectMemory: (memoryId: string) => void
  onSetFilter: (filter: MemoryFilter) => void
  onSetQuery: (query: string) => void
  onUpdateMemory: (memoryId: string, patch: UpdateMemoryItemPatch) => void
}

export function MemoryWorkspace({
  agents,
  memoryCleanupConfirmation,
  memoryWorkspace,
  onArchiveMemory,
  onCreateMemory,
  onRequestConfirmation,
  onRunMemoryDream,
  onSelectAgent,
  onSelectMemory,
  onSetFilter,
  onSetQuery,
  onUpdateMemory,
}: MemoryWorkspaceProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>(() => blankMemoryDraft())
  const memoryFilter = memoryWorkspace.filter
  const memorySearchQuery = memoryWorkspace.query
  const normalizedMemorySearch = memorySearchQuery.trim().toLowerCase()
  const visibleMemories = memoryWorkspace.items.filter((memory) => {
    if (memory.archived || memory.agentId !== memoryWorkspace.selectedAgentId) {
      return false
    }

    const matchesFilter = memoryFilter === '全部' || memory.category === memoryFilter
    const matchesSearch = !normalizedMemorySearch
      || `${memory.title} ${memory.summary} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase().includes(normalizedMemorySearch)
    return matchesFilter && matchesSearch
  })
  const selectedMemory = visibleMemories.find((memory) => memory.id === memoryWorkspace.selectedItemId)
    ?? visibleMemories[0]
  const selectedMemoryAgent = agents.find((agent) => agent.id === memoryWorkspace.selectedAgentId)
  const isMemoryDreaming = memoryWorkspace.dream.status === 'running'
  const runtimeStatus = normalizeMemoryRuntimeStatus(memoryWorkspace.runtimeStatus)
  const hindsightLifecycle = runtimeStatus.hindsight?.lifecycle
  const workerStatus = runtimeStatus.worker
  const outboxStatus = runtimeStatus.outbox
  const pendingOutboxCount = outboxStatus?.statusCounts?.pending ?? 0
  const onSetFormOpen = setIsFormOpen
  const updateMemoryDraft = <Key extends keyof MemoryDraft>(key: Key, value: MemoryDraft[Key]) => {
    setMemoryDraft((draft) => ({ ...draft, [key]: value }))
  }

  const onSubmitMemory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = memoryDraft.title.trim()
    const summary = memoryDraft.summary.trim()
    const content = memoryDraft.content.trim()
    if (!title || !summary || !content) {
      return
    }

    onCreateMemory({
      agentId: memoryWorkspace.selectedAgentId,
      category: memoryDraft.category,
      content,
      source: memoryDraft.source.trim() || undefined,
      summary,
      tags: parseMemoryTags(memoryDraft.tags),
      title,
    })
    setMemoryDraft(blankMemoryDraft())
    setIsFormOpen(false)
  }

  const onStartEdit = () => {
    if (!selectedMemory) {
      return
    }

    setMemoryDraft({
      category: selectedMemory.category,
      content: selectedMemory.content,
      source: selectedMemory.source,
      summary: selectedMemory.summary,
      tags: selectedMemory.tags.join(', '),
      title: selectedMemory.title,
    })
    setIsEditing(true)
    setIsFormOpen(false)
  }

  const onSaveMemoryEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedMemory) {
      return
    }

    const title = memoryDraft.title.trim()
    const summary = memoryDraft.summary.trim()
    if (!title || !summary) {
      return
    }

    const patch: UpdateMemoryItemPatch = {
      category: memoryDraft.category,
      content: memoryDraft.content.trim(),
      source: memoryDraft.source.trim() || undefined,
      summary,
      tags: parseMemoryTags(memoryDraft.tags),
      title,
    }
    onUpdateMemory(selectedMemory.id, patch)
    setIsEditing(false)
  }

  const onArchiveSelectedMemory = () => {
    if (!selectedMemory) {
      return
    }

    void (async () => {
      const needsConfirmation = shouldConfirmMemoryCleanup(memoryCleanupConfirmation, selectedMemory)
      if (needsConfirmation) {
        const confirmed = await onRequestConfirmation({
          title: '清理记忆',
          detail: '这条记忆会从当前记忆列表移除。',
          confirmLabel: '清理',
          tone: 'danger',
        })
        if (!confirmed) {
          return
        }
      }
      onArchiveMemory(selectedMemory.id, needsConfirmation)
      setIsEditing(false)
    })()
  }

  const onStartMemoryDream = () => {
    if (isMemoryDreaming) {
      return
    }

    onRunMemoryDream(memoryWorkspace.selectedAgentId)
    setIsEditing(false)
    setIsFormOpen(false)
  }

  return (
    <div className="memory-workspace">
      <header className="config-workspace__header memory-workspace__header">
        <h1>记忆</h1>
        <div className="memory-workspace__top-actions">
          <label className="memory-agent-select">
            <span>智能体</span>
            <select
              aria-label="选择智能体"
              onChange={(event) => onSelectAgent(event.currentTarget.value)}
              value={memoryWorkspace.selectedAgentId}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label className="memory-search">
            <span className="sr-only">搜索记忆</span>
            <Search aria-hidden="true" size={15} strokeWidth={2} />
            <input
              aria-label="搜索记忆"
              onChange={(event) => onSetQuery(event.currentTarget.value)}
              placeholder="搜索 CrawClaw 记住了什么"
              role="searchbox"
              value={memorySearchQuery}
            />
          </label>
          <button className="workspace-secondary-button" disabled={isMemoryDreaming} onClick={onStartMemoryDream} type="button">
            <Sparkles aria-hidden="true" size={15} strokeWidth={2.1} />
            {isMemoryDreaming ? '做梦中' : '做梦'}
          </button>
          <button className="workspace-primary-button" onClick={() => onSetFormOpen((open) => !open)} type="button">
            <Plus aria-hidden="true" size={15} strokeWidth={2.2} />
            添加记忆
          </button>
        </div>
      </header>

      <div className="memory-filter" role="radiogroup" aria-label="分类筛选">
        {memoryCategories.map((category) => (
          <button
            aria-checked={memoryFilter === category}
            className={memoryFilter === category ? 'is-active' : undefined}
            key={category}
            onClick={() => onSetFilter(category)}
            role="radio"
            type="button"
          >
            {category}
          </button>
        ))}
      </div>

      <div className="memory-runtime-strip" aria-label="记忆运行状态">
        <div className="memory-runtime-strip__item">
          <Database aria-hidden="true" size={15} strokeWidth={2.1} />
          <span>Hindsight</span>
          <strong>{formatRuntimeStatus(hindsightLifecycle?.status ?? runtimeStatus.status)}</strong>
          <small>{formatHindsightMode(hindsightLifecycle?.mode, hindsightLifecycle?.managed)}</small>
        </div>
        <div className="memory-runtime-strip__item">
          <Activity aria-hidden="true" size={15} strokeWidth={2.1} />
          <span>Worker</span>
          <strong>{workerStatus?.enabled === false ? '关闭' : formatRuntimeStatus(workerStatus?.lastRunStatus)}</strong>
          <small>{workerStatus?.lastProcessedCount ?? 0} processed</small>
        </div>
        <div className="memory-runtime-strip__item">
          <Sparkles aria-hidden="true" size={15} strokeWidth={2.1} />
          <span>Outbox</span>
          <strong>{outboxStatus?.total ?? 0}</strong>
          <small>{pendingOutboxCount} pending</small>
        </div>
      </div>

      {isMemoryDreaming ? (
        <div aria-busy="true" aria-label="做梦状态" className="memory-dream-status memory-dream-status--running" role="status">
          <span aria-hidden="true" className="memory-dream-status__orb">
            <Sparkles size={15} strokeWidth={2.1} />
          </span>
          <span className="memory-dream-status__copy">
            <strong>正在整理记忆</strong>
            <span>{memoryWorkspace.dream.message}</span>
          </span>
          <span aria-hidden="true" className="memory-dream-status__zzz">
            <i>z</i>
            <i>z</i>
            <i>z</i>
          </span>
        </div>
      ) : null}

      {isFormOpen ? (
        <form aria-label="添加记忆" className="workspace-form memory-form" onSubmit={onSubmitMemory}>
          <label>
            标题
            <input
              onChange={(event) => updateMemoryDraft('title', event.currentTarget.value)}
              value={memoryDraft.title}
            />
          </label>
          <label>
            一句话摘要
            <input
              onChange={(event) => updateMemoryDraft('summary', event.currentTarget.value)}
              value={memoryDraft.summary}
            />
          </label>
          <label>
            内容
            <textarea
              onChange={(event) => updateMemoryDraft('content', event.currentTarget.value)}
              value={memoryDraft.content}
            />
          </label>
          <label>
            分类
            <select
              onChange={(event) => {
                const value = event.currentTarget.value as MemoryCategory
                updateMemoryDraft('category', value)
              }}
              value={memoryDraft.category}
            >
              {editableMemoryCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            标签
            <input
              onChange={(event) => updateMemoryDraft('tags', event.currentTarget.value)}
              value={memoryDraft.tags}
            />
          </label>
          <label>
            来源
            <input
              onChange={(event) => updateMemoryDraft('source', event.currentTarget.value)}
              value={memoryDraft.source}
            />
          </label>
          <button className="workspace-primary-button" type="submit">保存记忆</button>
        </form>
      ) : null}

      <div className="memory-workspace__body">
        <Panel className="memory-list" label="记忆列表">
          {visibleMemories.length > 0 ? (
            visibleMemories.map((memory) => (
              <button
                aria-pressed={selectedMemory?.id === memory.id}
                className={selectedMemory?.id === memory.id ? 'memory-list__item is-active' : 'memory-list__item'}
                key={memory.id}
                onClick={() => {
                  setIsEditing(false)
                  setIsFormOpen(false)
                  onSelectMemory(memory.id)
                }}
                type="button"
              >
                <strong>{memory.title}</strong>
                <span>{memory.summary}</span>
                <small>{memory.category} · {memory.source} · {memory.layer} · {formatMemorySyncStatus(memory.syncStatus)}</small>
                {memory.tags.length > 0 ? (
                  <small className="memory-list__tags">{memory.tags.join(' / ')}</small>
                ) : null}
              </button>
            ))
          ) : (
            <div className="memory-list__empty">没有匹配记忆</div>
          )}
        </Panel>
        {selectedMemory ? (
          <Panel className="memory-detail" label="记忆详情">
            {isEditing ? (
              <form aria-label="编辑记忆" className="workspace-form" onSubmit={onSaveMemoryEdit}>
                <label>
                  详情标题
                  <input
                    onChange={(event) => updateMemoryDraft('title', event.currentTarget.value)}
                    value={memoryDraft.title}
                  />
                </label>
                <label>
                  详情摘要
                  <input
                    onChange={(event) => updateMemoryDraft('summary', event.currentTarget.value)}
                    value={memoryDraft.summary}
                  />
                </label>
                <label>
                  详情内容
                  <textarea
                    onChange={(event) => updateMemoryDraft('content', event.currentTarget.value)}
                    value={memoryDraft.content}
                  />
                </label>
                <label>
                  详情分类
                  <select
                    onChange={(event) => {
                      const value = event.currentTarget.value as MemoryCategory
                      updateMemoryDraft('category', value)
                    }}
                    value={memoryDraft.category}
                  >
                    {editableMemoryCategories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label>
                  详情标签
                  <input
                    onChange={(event) => updateMemoryDraft('tags', event.currentTarget.value)}
                    value={memoryDraft.tags}
                  />
                </label>
                <label>
                  详情来源
                  <input
                    onChange={(event) => updateMemoryDraft('source', event.currentTarget.value)}
                    value={memoryDraft.source}
                  />
                </label>
                <button className="workspace-primary-button" type="submit">保存修改</button>
              </form>
            ) : (
              <>
                <div className="memory-detail__header">
                  <div>
                    <div className="memory-detail__meta">
                      {selectedMemoryAgent ? <Badge tone="neutral">{selectedMemoryAgent.name}</Badge> : null}
                      <Badge tone="neutral">{selectedMemory.category}</Badge>
                      <Badge tone="neutral">{selectedMemory.source}</Badge>
                      <Badge tone={memorySyncTone(selectedMemory.syncStatus)}>{formatMemorySyncStatus(selectedMemory.syncStatus)}</Badge>
                      <span>{selectedMemory.updatedAt}</span>
                    </div>
                    <h2>{selectedMemory.title}</h2>
                  </div>
                  <div className="memory-detail__actions">
                    <button className="workspace-secondary-button" onClick={onStartEdit} type="button">编辑记忆</button>
                    <button className="workspace-secondary-button" onClick={onArchiveSelectedMemory} type="button">清理记忆</button>
                  </div>
                </div>
                <p>{selectedMemory.summary}</p>
                <p>{selectedMemory.content}</p>
                <div className="memory-sync-detail">
                  <span>{selectedMemory.provider}</span>
                  <span>{selectedMemory.layer}</span>
                  {selectedMemory.bankId ? <span>{selectedMemory.bankId}</span> : null}
                  {selectedMemory.syncError ? <span>{selectedMemory.syncError}</span> : null}
                </div>
                <div className="memory-tags">
                  {selectedMemory.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </>
            )}
          </Panel>
        ) : (
          <Panel className="memory-detail" label="记忆详情">
            <div className="memory-detail__empty">
              <strong>{selectedMemoryAgent ? selectedMemoryAgent.name : '当前智能体'} 还没有匹配记忆</strong>
              <p>可以调整搜索和分类，或者添加一条新记忆。</p>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}

function normalizeMemoryRuntimeStatus(value: unknown): MemoryRuntimeStatus {
  if (!isRecord(value)) {
    return { status: 'unknown' }
  }
  return {
    hindsight: readHindsightStatus(value.hindsight),
    outbox: readOutboxStatus(value.outbox),
    recentActivity: Array.isArray(value.recentActivity) ? value.recentActivity : [],
    status: readString(value.status),
    worker: readWorkerStatus(value.worker),
  }
}

function readHindsightStatus(value: unknown): MemoryRuntimeStatus['hindsight'] {
  if (!isRecord(value)) {
    return undefined
  }
  const lifecycle = isRecord(value.lifecycle)
    ? {
      managed: readBoolean(value.lifecycle.managed),
      mode: readString(value.lifecycle.mode),
      reason: readNullableString(value.lifecycle.reason),
      status: readString(value.lifecycle.status),
    }
    : undefined
  return {
    lifecycle,
    ready: readBoolean(value.ready),
  }
}

function readOutboxStatus(value: unknown): MemoryRuntimeStatus['outbox'] {
  if (!isRecord(value)) {
    return undefined
  }
  return {
    statusCounts: readNumberRecord(value.statusCounts),
    total: readNumber(value.total),
  }
}

function readWorkerStatus(value: unknown): MemoryRuntimeStatus['worker'] {
  if (!isRecord(value)) {
    return undefined
  }
  return {
    enabled: readBoolean(value.enabled),
    lastError: readNullableString(value.lastError),
    lastProcessedCount: readNumber(value.lastProcessedCount),
    lastRunStatus: readString(value.lastRunStatus),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readNullableString(value: unknown) {
  if (value === null) {
    return null
  }
  return readString(value)
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function readNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function readNumberRecord(value: unknown) {
  if (!isRecord(value)) {
    return undefined
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  )
}

function formatRuntimeStatus(value: string | undefined) {
  switch (value) {
    case 'ready':
      return '正常'
    case 'starting':
      return '启动中'
    case 'degraded':
      return '降级'
    case 'unavailable':
      return '不可用'
    case 'completed':
      return '完成'
    case 'failed':
      return '失败'
    case 'idle':
      return '空闲'
    case 'never_run':
      return '未运行'
    default:
      return value || '未知'
  }
}

function formatHindsightMode(mode: string | undefined, managed: boolean | undefined) {
  const modeLabel = mode === 'remote' ? 'remote' : mode === 'local' ? 'local' : mode || 'off'
  return managed ? `${modeLabel} managed` : modeLabel
}

function formatMemorySyncStatus(value: string) {
  switch (value) {
    case 'pending':
      return '待同步'
    case 'pending_delete':
      return '待删除'
    case 'local_only':
      return '本地'
    case 'local_delete_only':
      return '本地删除'
    case 'failed':
    case 'delete_failed':
      return '失败'
    default:
      return value
  }
}

function memorySyncTone(value: string): 'danger' | 'neutral' {
  return value === 'failed' || value === 'delete_failed' ? 'danger' : 'neutral'
}

function shouldConfirmMemoryCleanup(
  policy: DesktopPreferences['memoryDefaults']['memoryCleanupConfirmation'],
  memory: MemoryItem,
) {
  if (policy === '不自动清理') {
    return false
  }
  if (policy !== '仅重要记忆') {
    return true
  }
  const searchable = [
    memory.title,
    memory.summary,
    memory.category,
    memory.source,
    ...memory.tags,
  ].join(' ').toLowerCase()
  return ['偏好', '项目', '决策', '流程', '长期', '重要', 'preference', 'project', 'decision', 'procedure', 'long-term', 'important']
    .some((keyword) => searchable.includes(keyword))
}

import { Plus, Search, Sparkles } from 'lucide-react'
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
  summary: string
  tags: string
  title: string
}

export const memoryCategories: MemoryFilter[] = ['全部', '偏好', '项目', '经验', '其他']

const editableMemoryCategories = memoryCategories.filter((category): category is MemoryCategory => category !== '全部')

const blankMemoryDraft = (): MemoryDraft => ({
  category: '其他',
  content: '',
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
  const onSetFormOpen = setIsFormOpen
  const onSetMemoryDraft = setMemoryDraft

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
              onChange={(event) => onSetMemoryDraft((draft) => ({ ...draft, title: event.currentTarget.value }))}
              value={memoryDraft.title}
            />
          </label>
          <label>
            一句话摘要
            <input
              onChange={(event) => onSetMemoryDraft((draft) => ({ ...draft, summary: event.currentTarget.value }))}
              value={memoryDraft.summary}
            />
          </label>
          <label>
            内容
            <textarea
              onChange={(event) => onSetMemoryDraft((draft) => ({ ...draft, content: event.currentTarget.value }))}
              value={memoryDraft.content}
            />
          </label>
          <label>
            分类
            <select
              onChange={(event) => {
                const value = event.currentTarget.value as MemoryCategory
                onSetMemoryDraft((draft) => ({ ...draft, category: value }))
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
              onChange={(event) => onSetMemoryDraft((draft) => ({ ...draft, tags: event.currentTarget.value }))}
              value={memoryDraft.tags}
            />
          </label>
          <button className="workspace-primary-button" type="submit">保存记忆</button>
        </form>
      ) : null}

      <div className="memory-workspace__body">
        {selectedMemory ? (
          <Panel className="memory-detail" label="记忆详情">
            {isEditing ? (
              <form aria-label="编辑记忆" className="workspace-form" onSubmit={onSaveMemoryEdit}>
                <label>
                  详情标题
                  <input
                    onChange={(event) => onSetMemoryDraft((draft) => ({ ...draft, title: event.currentTarget.value }))}
                    value={memoryDraft.title}
                  />
                </label>
                <label>
                  详情摘要
                  <input
                    onChange={(event) => onSetMemoryDraft((draft) => ({ ...draft, summary: event.currentTarget.value }))}
                    value={memoryDraft.summary}
                  />
                </label>
                <label>
                  详情内容
                  <textarea
                    onChange={(event) => onSetMemoryDraft((draft) => ({ ...draft, content: event.currentTarget.value }))}
                    value={memoryDraft.content}
                  />
                </label>
                <label>
                  详情分类
                  <select
                    onChange={(event) => {
                      const value = event.currentTarget.value as MemoryCategory
                      onSetMemoryDraft((draft) => ({ ...draft, category: value }))
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
                    onChange={(event) => onSetMemoryDraft((draft) => ({ ...draft, tags: event.currentTarget.value }))}
                    value={memoryDraft.tags}
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

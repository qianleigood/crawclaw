import type { LucideIcon } from 'lucide-react'
import { Archive, Copy, Pencil, Pin, Settings, Sparkles } from 'lucide-react'
import { useState, type FormEvent, type MouseEvent } from 'react'
import { Button } from './button'

export type SidebarNavItem = {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
}

export type SidebarThread = {
  id: string
  title: string
  time: string
  active?: boolean
  agentAvatar?: boolean
}

type SidebarProps = {
  activeNavLabel?: string
  discussionThreads: SidebarThread[]
  navItems: SidebarNavItem[]
  onNavItemClick?: (item: SidebarNavItem) => void
  onSettingsClick?: () => void
  onThreadArchive?: (item: SidebarThread) => void
  onThreadPin?: (item: SidebarThread) => void
  onThreadRename?: (item: SidebarThread, title: string) => void
  onThreadSelect?: (item: SidebarThread) => void
  onThreadUnpin?: (item: SidebarThread) => void
  pinnedThreads: SidebarThread[]
  threads: SidebarThread[]
}

export function Sidebar({
  activeNavLabel,
  discussionThreads,
  navItems,
  onNavItemClick,
  onSettingsClick,
  onThreadArchive,
  onThreadPin,
  onThreadRename,
  onThreadSelect,
  onThreadUnpin,
  pinnedThreads,
  threads,
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    item: SidebarThread
    x: number
    y: number
  } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{
    item: SidebarThread
    x: number
    y: number
  } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const hasActiveThread = [...pinnedThreads, ...threads, ...discussionThreads].some((thread) => thread.active)
  const activePrimaryNavLabel = activeNavLabel ?? navItems.find((item) => item.active)?.label
  const isNavItemActive = (item: SidebarNavItem) => (
    activePrimaryNavLabel === item.label && !(item.id === 'new-chat' && hasActiveThread)
  )

  const pinThread = (item: SidebarThread) => {
    onThreadPin?.(item)
    setContextMenu(null)
  }

  const unpinThread = (item: SidebarThread) => {
    onThreadUnpin?.(item)
  }

  const openThreadMenu = (event: MouseEvent, item: SidebarThread) => {
    event.preventDefault()
    setContextMenu({
      item,
      x: Math.min(event.clientX, 170),
      y: event.clientY,
    })
  }

  const beginRename = (item: SidebarThread) => {
    setRenameTarget({
      item,
      x: contextMenu?.x ?? 12,
      y: contextMenu?.y ?? 220,
    })
    setRenameDraft(item.title)
    setContextMenu(null)
  }

  const saveRename = (event: FormEvent) => {
    event.preventDefault()
    const title = renameDraft.trim()
    if (!renameTarget || !title) {
      return
    }

    onThreadRename?.(renameTarget.item, title)
    setRenameTarget(null)
  }

  const copyThreadLink = (item: SidebarThread) => {
    const threadLink = `crawclaw://desktop/threads/${encodeURIComponent(item.id)}`
    void writeClipboardText(threadLink).catch(() => undefined)
    setContextMenu(null)
  }

  const archiveThread = (item: SidebarThread) => {
    setContextMenu(null)
    onThreadArchive?.(item)
  }

  return (
    <aside
      className="desktop-sidebar"
      aria-label="CrawClaw navigation"
      onClick={() => {
        setContextMenu(null)
      }}
    >
      <nav className="sidebar-nav" aria-label="Primary">
        {navItems.map((item) => (
          <Button
            className={isNavItemActive(item) ? 'sidebar-nav__item is-active' : 'sidebar-nav__item'}
            data-nav-id={item.id}
            data-testid="sidebar-nav-item"
            key={item.label}
            onClick={() => onNavItemClick?.(item)}
          >
            <item.icon aria-hidden="true" size={15} strokeWidth={2} />
            <span>{item.label}</span>
          </Button>
        ))}
      </nav>

      <ThreadGroup
        id="pinned-title"
        items={pinnedThreads}
        onThreadPin={unpinThread}
        onThreadSelect={onThreadSelect}
        pinAction="unpin"
        title="置顶"
      />
      <ThreadGroup
        className="thread-group--scroll"
        id="threads-title"
        items={threads}
        onThreadContextMenu={openThreadMenu}
        onThreadPin={pinThread}
        onThreadSelect={onThreadSelect}
        pinAction="pin"
        title="对话"
      />
      <ThreadGroup id="discussion-title" items={discussionThreads} onThreadSelect={onThreadSelect} title="讨论群" />

      <Button
        className={activeNavLabel === '设置' ? 'sidebar-settings is-active' : 'sidebar-settings'}
        data-testid="sidebar-settings"
        onClick={onSettingsClick}
      >
        <Settings aria-hidden="true" size={15} strokeWidth={2} />
        <span>设置</span>
      </Button>

      {contextMenu ? (
        <div
          aria-label="对话操作菜单"
          className="thread-context-menu"
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <p>{contextMenu.item.title}</p>
          <button onClick={() => pinThread(contextMenu.item)} role="menuitem" type="button">
            <Pin aria-hidden="true" size={14} strokeWidth={2.1} />
            <span>置顶</span>
          </button>
          <button onClick={() => beginRename(contextMenu.item)} role="menuitem" type="button">
            <Pencil aria-hidden="true" size={14} strokeWidth={2.1} />
            <span>重命名</span>
          </button>
          <button onClick={() => copyThreadLink(contextMenu.item)} role="menuitem" type="button">
            <Copy aria-hidden="true" size={14} strokeWidth={2.1} />
            <span>复制链接</span>
          </button>
          <button onClick={() => archiveThread(contextMenu.item)} role="menuitem" type="button">
            <Archive aria-hidden="true" size={14} strokeWidth={2.1} />
            <span>归档</span>
          </button>
        </div>
      ) : null}

      {renameTarget ? (
        <form
          aria-label="重命名对话"
          className="thread-rename-popover"
          onClick={(event) => event.stopPropagation()}
          onSubmit={saveRename}
          role="dialog"
          style={{ left: renameTarget.x, top: renameTarget.y }}
        >
          <label>
            <span>重命名</span>
            <input
              aria-label="重命名对话"
              autoFocus
              onChange={(event) => setRenameDraft(event.target.value)}
              value={renameDraft}
            />
          </label>
          <div>
            <button onClick={() => setRenameTarget(null)} type="button">
              取消
            </button>
            <button aria-label="保存重命名" type="submit">
              保存
            </button>
          </div>
        </form>
      ) : null}
    </aside>
  )
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function ThreadGroup({
  className = '',
  id,
  items,
  onThreadContextMenu,
  onThreadPin,
  onThreadSelect,
  pinAction,
  title,
}: {
  className?: string
  id: string
  items: SidebarThread[]
  onThreadContextMenu?: (event: MouseEvent, item: SidebarThread) => void
  onThreadPin?: (item: SidebarThread) => void
  onThreadSelect?: (item: SidebarThread) => void
  pinAction?: 'pin' | 'unpin'
  title: string
}) {
  return (
    <section aria-labelledby={id} className={['thread-group', className].filter(Boolean).join(' ')}>
      <h2 id={id}>{title}</h2>
      {items.map((item) => (
        <div
          className={[item.active ? 'thread-row is-active' : 'thread-row', item.agentAvatar ? 'thread-row--with-avatar' : '']
            .filter(Boolean)
            .join(' ')}
          data-thread-id={item.id}
          data-testid="sidebar-thread"
          key={item.id}
          onContextMenu={(event) => onThreadContextMenu?.(event, item)}
        >
          {item.agentAvatar ? (
            <span className="thread-row__avatar" aria-hidden="true">
              <Sparkles size={12} strokeWidth={2.2} />
            </span>
          ) : null}
          <button className="thread-row__main" onClick={() => onThreadSelect?.(item)} type="button">
            <span className="thread-row__title">{item.title}</span>
          </button>
          <span className="thread-row__trailing">
            <time>{item.time}</time>
            {pinAction ? (
              <button
                aria-label={`${pinAction === 'pin' ? '置顶' : '取消置顶'}对话：${item.title}`}
                className={`thread-row__pin thread-row__pin--${pinAction}`}
                onClick={() => onThreadPin?.(item)}
                type="button"
              >
                <Pin aria-hidden="true" size={13} strokeWidth={2.2} />
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </section>
  )
}

import { ChevronDown, MessageCircle, Plus, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { AddPluginSkillInput, DesktopIconKey, PluginSkill } from '../desktop-api'

export type PluginSourceFilter = 'Built by CrawClaw' | '全部来源' | '自定义'
export type PluginStatusFilter = '全部' | '已启用' | '草稿' | '本地'
export type PluginSelectorId = 'plugin-source' | 'plugin-status'
type PluginSkillDialogPhase = 'idle' | 'checking'
type PluginSkillInstallStatus = '检查中' | '本地'

const pluginSourceFilters: PluginSourceFilter[] = ['Built by CrawClaw', '全部来源', '自定义']
const pluginStatusFilters: PluginStatusFilter[] = ['全部', '已启用', '草稿', '本地']
const pluginSkillInstallSteps = ['解析地址', '读取 Skill 信息', '校验入口文件']
const pluginSkillCheckDelayMs = 1_200
const pluginSkillReadyDelayMs = 880

function deriveSkillFromAddress(address: string): AddPluginSkillInput | null {
  const trimmedAddress = address.trim()
  if (!trimmedAddress) {
    return null
  }

  const pathLike = trimmedAddress.replace(/\/+$/, '')
  let rawName = ''
  try {
    const parsed = new URL(pathLike)
    const parts = parsed.pathname.split('/').filter(Boolean)
    rawName = parts.at(-1) ?? parsed.hostname
  } catch {
    rawName = pathLike.split(/[/:?#]+/).filter(Boolean).at(-1) ?? ''
  }

  const name = rawName
    .replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!name) {
    return null
  }

  return {
    description: `来自 ${formatSkillAddressSource(trimmedAddress)}`,
    name,
    trigger: `@${name}`,
  }
}

function formatSkillAddressSource(address: string) {
  try {
    const parsed = new URL(address)
    if (parsed.hostname === 'github.com') {
      const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
      return owner && repo ? `${parsed.hostname}/${owner}/${repo}` : parsed.hostname
    }
    return parsed.hostname || address
  } catch {
    return address
  }
}

type PluginsWorkspaceProps = {
  onFeaturedPlugin: () => void
  onInstallSkill: (input: AddPluginSkillInput) => Promise<void>
  onTogglePluginSkill: (skillId: string) => void
  renderSkillIcon: (icon: DesktopIconKey) => ReactNode
  skills: PluginSkill[]
}

export function PluginsWorkspace({
  onFeaturedPlugin,
  onInstallSkill,
  onTogglePluginSkill,
  renderSkillIcon,
  skills,
}: PluginsWorkspaceProps) {
  const [isPluginSkillDialogOpen, setIsPluginSkillDialogOpen] = useState(false)
  const [pluginSearchQuery, setPluginSearchQuery] = useState('')
  const [pluginSelectorOpen, setPluginSelectorOpen] = useState<PluginSelectorId | null>(null)
  const [pluginSkillAddress, setPluginSkillAddress] = useState('')
  const [pluginSkillDialogPhase, setPluginSkillDialogPhase] = useState<PluginSkillDialogPhase>('idle')
  const [pluginSkillInstallStatuses, setPluginSkillInstallStatuses] = useState<Record<string, PluginSkillInstallStatus>>({})
  const [pluginSourceFilter, setPluginSourceFilter] = useState<PluginSourceFilter>('Built by CrawClaw')
  const [pluginStatusFilter, setPluginStatusFilter] = useState<PluginStatusFilter>('全部')
  const normalizedPluginSearch = pluginSearchQuery.trim().toLowerCase()
  const isPluginSkillChecking = pluginSkillDialogPhase === 'checking'
  const canSubmitPluginSkill = pluginSkillAddress.trim().length > 0 && !isPluginSkillChecking
  const getPluginSkillDisplayStatus = (skill: PluginSkill) => pluginSkillInstallStatuses[skill.trigger] ?? skill.status
  const visiblePluginSkills = skills.filter((skill) => {
    const matchesSearch = !normalizedPluginSearch
      || `${skill.name} ${skill.trigger} ${skill.description}`.toLowerCase().includes(normalizedPluginSearch)
    const matchesSource = pluginSourceFilter === '全部来源'
      || (pluginSourceFilter === 'Built by CrawClaw' ? skill.source === '内置' : skill.source === '自定义')
    const matchesStatus = pluginStatusFilter === '全部' || getPluginSkillDisplayStatus(skill) === pluginStatusFilter
    return matchesSearch && matchesSource && matchesStatus
  })

  const closeSkillDialog = () => {
    if (!isPluginSkillChecking) {
      setIsPluginSkillDialogOpen(false)
    }
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setPluginSelectorOpen(null)
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

  const submitPluginSkill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPluginSkillChecking) {
      return
    }

    const nextSkill = deriveSkillFromAddress(pluginSkillAddress)
    if (!nextSkill) {
      return
    }

    setPluginSkillDialogPhase('checking')
    void (async () => {
      await new Promise((resolve) => window.setTimeout(resolve, pluginSkillCheckDelayMs))

      try {
        await onInstallSkill(nextSkill)
      } finally {
        setPluginSkillInstallStatuses((statuses) => ({
          ...statuses,
          [nextSkill.trigger]: '检查中',
        }))
        setPluginSkillAddress('')
        setPluginSearchQuery('')
        setPluginSourceFilter('自定义')
        setPluginStatusFilter('全部')
        setIsPluginSkillDialogOpen(false)
        setPluginSkillDialogPhase('idle')

        window.setTimeout(() => {
          setPluginSkillInstallStatuses((statuses) => (
            statuses[nextSkill.trigger] === '检查中'
              ? { ...statuses, [nextSkill.trigger]: '本地' }
              : statuses
          ))
        }, pluginSkillReadyDelayMs)
      }
    })()
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setPluginSelectorOpen(null)
      closeSkillDialog()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isPluginSkillChecking])

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || target.closest('.plugin-filter') || target.closest('.selector-menu')) {
        return
      }

      setPluginSelectorOpen(null)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  return (
    <div className="plugin-catalog">
      <h1>让 CrawClaw 按你的方式工作</h1>

      <div className="plugin-catalog__toolbar" aria-label="插件筛选">
        <label>
          <Search aria-hidden="true" size={15} strokeWidth={2} />
          <span className="sr-only">搜索插件</span>
          <input
            onChange={(event) => setPluginSearchQuery(event.currentTarget.value)}
            placeholder="搜索插件"
            value={pluginSearchQuery}
          />
        </label>
        <div className="plugin-filter">
          <button
            aria-expanded={pluginSelectorOpen === 'plugin-source'}
            aria-haspopup="menu"
            className="plugin-filter-pill"
            onClick={() => setPluginSelectorOpen(pluginSelectorOpen === 'plugin-source' ? null : 'plugin-source')}
            type="button"
          >
            {pluginSourceFilter}
            <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
          </button>
          {pluginSelectorOpen === 'plugin-source' ? (
            <div aria-label="插件来源选择" className="selector-menu plugin-filter-menu" onKeyDown={handleMenuKeyDown} role="menu">
              {pluginSourceFilters.map((filter) => (
                <button
                  className={filter === pluginSourceFilter ? 'is-selected' : ''}
                  key={filter}
                  onClick={() => {
                    setPluginSourceFilter(filter)
                    setPluginSelectorOpen(null)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {filter}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="plugin-filter">
          <button
            aria-expanded={pluginSelectorOpen === 'plugin-status'}
            aria-haspopup="menu"
            className="plugin-filter-pill"
            onClick={() => setPluginSelectorOpen(pluginSelectorOpen === 'plugin-status' ? null : 'plugin-status')}
            type="button"
          >
            {pluginStatusFilter}
            <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
          </button>
          {pluginSelectorOpen === 'plugin-status' ? (
            <div aria-label="插件状态选择" className="selector-menu plugin-filter-menu" onKeyDown={handleMenuKeyDown} role="menu">
              {pluginStatusFilters.map((filter) => (
                <button
                  className={filter === pluginStatusFilter ? 'is-selected' : ''}
                  key={filter}
                  onClick={() => {
                    setPluginStatusFilter(filter)
                    setPluginSelectorOpen(null)
                  }}
                  role="menuitem"
                  type="button"
                >
                  {filter}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {!normalizedPluginSearch ? (
        <section className="plugin-hero" aria-label="推荐插件">
          <div className="plugin-hero__card">
            <span className="plugin-hero__icon">
              <Sparkles aria-hidden="true" size={15} strokeWidth={2.2} />
            </span>
            <strong>macOS UI polish</strong>
            <span>打磨桌面端气泡、动效和输入体验</span>
          </div>
          <button className="plugin-hero__action" onClick={onFeaturedPlugin} type="button">
            <MessageCircle aria-hidden="true" size={15} strokeWidth={2.2} />
            在对话中试用
          </button>
          <div className="plugin-hero__dots" aria-hidden="true">
            <span className="is-active" />
            <span />
            <span />
            <span />
            <span />
          </div>
        </section>
      ) : null}

      <section className="plugin-featured" aria-labelledby="plugin-featured-title">
        <div className="plugin-featured__header">
          <h2 id="plugin-featured-title">Featured</h2>
          <button
            className="workspace-secondary-button"
            onClick={() => {
              setPluginSkillAddress('')
              setIsPluginSkillDialogOpen(true)
            }}
            type="button"
          >
            <Plus aria-hidden="true" size={15} strokeWidth={2.2} />
            添加技能
          </button>
        </div>

        <div className="plugin-featured__list">
          {visiblePluginSkills.length > 0 ? (
            visiblePluginSkills.map((skill) => (
              <PluginSkillRow
                key={skill.id}
                onToggle={() => onTogglePluginSkill(skill.id)}
                renderSkillIcon={renderSkillIcon}
                skill={skill}
                status={getPluginSkillDisplayStatus(skill)}
              />
            ))
          ) : (
            <p className="plugin-featured__empty">没有找到匹配的插件。</p>
          )}
        </div>
      </section>

      {isPluginSkillDialogOpen ? (
        <div
          className="plugin-skill-dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPluginSkillChecking) {
              closeSkillDialog()
            }
          }}
        >
          <form
            aria-labelledby="plugin-skill-dialog-title"
            aria-modal="true"
            className="plugin-skill-dialog"
            onSubmit={submitPluginSkill}
            role="dialog"
          >
            <header className="plugin-skill-dialog__header">
              <span className="plugin-skill-dialog__icon">
                <Sparkles aria-hidden="true" size={17} strokeWidth={2.2} />
              </span>
              <div>
                <h2 id="plugin-skill-dialog-title">添加技能</h2>
                <p>粘贴 GitHub 地址或技能地址，后续安装流程会接到这里。</p>
              </div>
              <button
                aria-label="关闭添加技能"
                disabled={isPluginSkillChecking}
                onClick={closeSkillDialog}
                type="button"
              >
                <X aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            </header>

            <label className="plugin-skill-dialog__field">
              <span>技能地址</span>
              <input
                autoFocus
                disabled={isPluginSkillChecking}
                onChange={(event) => setPluginSkillAddress(event.currentTarget.value)}
                placeholder="GitHub 地址或技能地址"
                value={pluginSkillAddress}
              />
            </label>

            {isPluginSkillChecking ? (
              <ol aria-label="添加技能进度" className="plugin-skill-dialog__steps">
                {pluginSkillInstallSteps.map((step) => (
                  <li key={step}>
                    <span aria-hidden="true" />
                    {step}
                  </li>
                ))}
              </ol>
            ) : null}

            <div className="plugin-skill-dialog__examples" aria-label="地址格式示例">
              <span>支持</span>
              <code>github.com/owner/repo/skills/name</code>
              <code>crawclaw://skills/name</code>
            </div>

            <footer className="plugin-skill-dialog__footer">
              <button disabled={isPluginSkillChecking} onClick={closeSkillDialog} type="button">取消</button>
              <button className="plugin-skill-dialog__submit" disabled={!canSubmitPluginSkill} type="submit">
                {isPluginSkillChecking ? '正在检查...' : '添加'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  )
}

function PluginSkillRow({
  onToggle,
  renderSkillIcon,
  skill,
  status,
}: {
  onToggle: () => void
  renderSkillIcon: (icon: DesktopIconKey) => ReactNode
  skill: PluginSkill
  status: string
}) {
  const statusClass = status === '检查中'
    ? 'plugin-market-row__status is-checking'
    : status === '本地'
    ? 'plugin-market-row__status is-local'
    : status === '已启用'
    ? 'plugin-market-row__status is-enabled'
    : 'plugin-market-row__status'

  return (
    <article className={skill.open ? 'plugin-market-row is-open' : 'plugin-market-row'}>
      <button aria-label={`${skill.open ? '收起' : '打开'} Skill：${skill.name}`} className="plugin-market-row__main" onClick={onToggle} type="button">
        <span className="plugin-market-row__icon">
          {renderSkillIcon(skill.icon)}
        </span>
        <span className="plugin-market-row__body">
          <strong>{skill.name}</strong>
          <small>{skill.description}</small>
          <code>{skill.trigger}</code>
        </span>
        <span className={statusClass}>{status}</span>
      </button>
      {skill.open ? (
        <div className="plugin-market-row__detail">
          <p>触发词 {skill.trigger}</p>
          <span>{skill.source}</span>
        </div>
      ) : null}
    </article>
  )
}

import { Search, Sparkles, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from './icon-button'

export type SearchSuggestionView = {
  icon: LucideIcon
  id: string
  label: string
  meta: string
  targetItemId?: string
  targetNavId: string
}

export function SearchOverlay({
  onClose,
  onQueryChange,
  onSelect,
  open,
  suggestions,
}: {
  onClose: () => void
  onQueryChange?: (query: string) => void
  onSelect?: (item: SearchSuggestionView) => void
  open: boolean
  suggestions: SearchSuggestionView[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }

    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  useEffect(() => {
    if (open) {
      onQueryChange?.(query)
    }
  }, [onQueryChange, open, query])

  if (!open) {
    return null
  }

  return (
    <div
      className="search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        aria-label="全局搜索"
        aria-modal="true"
        className="search-modal search-modal--liquid"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose()
          }
        }}
        role="dialog"
      >
        <span aria-hidden="true" className="search-modal__lens search-modal__lens--top" />
        <span aria-hidden="true" className="search-modal__lens search-modal__lens--bottom" />

        <header className="search-modal__header">
          <div>
            <p>全局搜索</p>
            <span>搜索对话、智能体、工具或工作流</span>
          </div>
          <IconButton className="search-modal__close" icon={X} label="关闭搜索" onClick={onClose} />
        </header>

        <label className="search-modal__input">
          <Search aria-hidden="true" size={19} strokeWidth={2} />
          <input
            ref={inputRef}
            aria-label="搜索"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话、智能体、工具或工作流"
            value={query}
          />
          <kbd>Esc</kbd>
        </label>

        <section className="search-modal__results" aria-label="最近搜索">
          <p>最近搜索</p>
          {suggestions.length > 0 ? (
            suggestions.map((item) => (
              <button
                aria-label={item.label}
                key={item.id}
                onClick={() => {
                  onSelect?.(item)
                  onClose()
                }}
                type="button"
              >
                <span className="search-modal__result-icon">
                  <item.icon aria-hidden="true" size={16} strokeWidth={2} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.meta}</small>
                </span>
                <Sparkles aria-hidden="true" size={14} strokeWidth={2} />
              </button>
            ))
          ) : (
            <div className="search-modal__empty">没有匹配结果</div>
          )}
        </section>
      </div>
    </div>
  )
}

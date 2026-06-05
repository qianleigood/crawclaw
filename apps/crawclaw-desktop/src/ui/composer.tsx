import { ChevronDown, Monitor } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'

type ComposerProps = {
  approvalNotice?: ReactNode
  commandMenu?: ReactNode
  leftControls?: ReactNode
  metaControls?: ReactNode
  onInputChange?: (value: string) => void
  onSubmit?: () => void
  placeholder: string
  rightControls: ReactNode
  value?: string
}

export function Composer({
  approvalNotice,
  commandMenu,
  leftControls,
  metaControls,
  onInputChange,
  onSubmit,
  placeholder,
  rightControls,
  value,
}: ComposerProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }

    event.preventDefault()
    onSubmit?.()
  }

  return (
    <footer className="composer-area">
      {approvalNotice}
      <div className="composer">
        {commandMenu}
        <textarea
          aria-label={placeholder}
          data-testid="composer-input"
          onChange={(event) => onInputChange?.(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          value={value}
        />
        <div className="composer__toolbar">
          <div className="composer__leading">{leftControls}</div>
          <div className="composer__actions">{rightControls}</div>
        </div>
      </div>
      <div className="composer-meta">
        {metaControls}
      </div>
    </footer>
  )
}

export function PermissionModeButton({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button aria-expanded={expanded} aria-haspopup="menu" aria-label={`权限模式 ${label}`} className="composer-meta__mode" onClick={onClick} type="button">
      <Monitor aria-hidden="true" size={14} strokeWidth={2} />
      <span>{label}</span>
      <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
    </button>
  )
}

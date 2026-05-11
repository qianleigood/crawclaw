import { Tooltip } from '@base-ui/react/tooltip'
import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
}

export function IconButton({ className = '', icon: Icon, label, type = 'button', ...props }: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        aria-label={label}
        className={['cc-icon-button', className].filter(Boolean).join(' ')}
        delay={450}
        type={type}
        {...props}
      >
        <Icon aria-hidden="true" size={16} strokeWidth={2} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" sideOffset={7}>
          <Tooltip.Popup className="cc-tooltip">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

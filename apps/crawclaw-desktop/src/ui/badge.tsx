import type { HTMLAttributes } from 'react'

export type BadgeTone = 'neutral' | 'idle' | 'ok' | 'danger'

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
}

export function Badge({ className = '', tone = 'neutral', ...props }: BadgeProps) {
  return <span className={['cc-badge', `cc-badge--${tone}`, className].filter(Boolean).join(' ')} {...props} />
}

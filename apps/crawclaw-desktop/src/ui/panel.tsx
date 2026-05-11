import type { HTMLAttributes } from 'react'

export type PanelProps = HTMLAttributes<HTMLElement> & {
  label?: string
}

export function Panel({ className = '', label, ...props }: PanelProps) {
  return <section aria-label={label} className={['cc-panel', className].filter(Boolean).join(' ')} {...props} />
}

import type { ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'ghost' | 'subtle' | 'primary'
type ButtonSize = 'sm' | 'md' | 'icon'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ className = '', size = 'md', type = 'button', variant = 'ghost', ...props }: ButtonProps) {
  return (
    <button
      className={['cc-button', `cc-button--${variant}`, `cc-button--${size}`, className].filter(Boolean).join(' ')}
      type={type}
      {...props}
    />
  )
}

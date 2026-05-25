import { AlertTriangle, X } from 'lucide-react'

export type ConfirmationDialogTone = 'danger' | 'default'

export type ConfirmationRequestInput = {
  cancelLabel?: string
  confirmLabel?: string
  detail: string
  title: string
  tone?: ConfirmationDialogTone
}

type ConfirmationDialogProps = ConfirmationRequestInput & {
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmationDialog({
  cancelLabel = '取消',
  confirmLabel = '确认',
  detail,
  onCancel,
  onConfirm,
  title,
  tone = 'default',
}: ConfirmationDialogProps) {
  return (
    <div
      className="confirmation-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <section
        aria-labelledby="confirmation-dialog-title"
        aria-modal="true"
        className={tone === 'danger' ? 'confirmation-dialog is-danger' : 'confirmation-dialog'}
        role="dialog"
      >
        <header className="confirmation-dialog__header">
          <span className="confirmation-dialog__icon" aria-hidden="true">
            <AlertTriangle size={17} strokeWidth={2.2} />
          </span>
          <div>
            <h2 id="confirmation-dialog-title">{title}</h2>
            <p>{detail}</p>
          </div>
          <button aria-label="关闭确认" onClick={onCancel} type="button">
            <X aria-hidden="true" size={15} strokeWidth={2} />
          </button>
        </header>
        <footer className="confirmation-dialog__footer">
          <button onClick={onCancel} type="button">{cancelLabel}</button>
          <button className="confirmation-dialog__confirm" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}

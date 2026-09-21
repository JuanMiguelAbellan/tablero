import { useEffect, useRef } from 'react'

/** In-app confirmation (native <dialog>: focus trap, Escape to cancel). Replaces window.confirm, which is blocking, unstyled
 *  and impossible to test reliably. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} className="dialog" onClose={onCancel} aria-labelledby="confirm-title">
      <h2 id="confirm-title">{title}</h2>
      <p>{message}</p>
      <div className="dialog-actions">
        <span className="spacer" />
        <button type="button" className="secondary" autoFocus onClick={() => ref.current?.close()}>Cancelar</button>
        <button type="button" className="danger" onClick={() => { onConfirm(); ref.current?.close() }}>{confirmLabel}</button>
      </div>
    </dialog>
  )
}

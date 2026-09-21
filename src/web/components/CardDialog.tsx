import { useEffect, useRef, useState } from 'react'
import type { Card } from '../../shared/types'

/** Uses the native <dialog>: focus is trapped, Escape closes it and everything behind it is inert, with no extra code. */
export function CardDialog({ card, canEdit, onSave, onDelete, onClose }: { card: Card; canEdit: boolean; onSave: (title: string, description: string) => void; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description)
  useEffect(() => { ref.current?.showModal() }, [])

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="card-dialog-title">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canEdit && title.trim()) onSave(title.trim(), description)
          ref.current?.close()
        }}
      >
        <h2 id="card-dialog-title">{canEdit ? 'Editar tarjeta' : 'Tarjeta'}</h2>
        <label htmlFor="card-title">Título</label>
        <input id="card-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required readOnly={!canEdit} />
        <label htmlFor="card-desc">Descripción</label>
        <textarea id="card-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={6} readOnly={!canEdit} />
        <div className="dialog-actions">
          {canEdit && <button type="button" className="danger" onClick={() => { onDelete(); ref.current?.close() }}>Eliminar</button>}
          <span className="spacer" />
          <button type="button" className="secondary" onClick={() => ref.current?.close()}>{canEdit ? 'Cancelar' : 'Cerrar'}</button>
          {canEdit && <button type="submit">Guardar</button>}
        </div>
      </form>
    </dialog>
  )
}

import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import type { Card, Column } from '../../shared/types'
import { CardView } from './CardView'
import { ConfirmDialog } from './ConfirmDialog'

export function ColumnView({ column, cards, canEdit, onRename, onDelete, onAddCard, onEditCard }: {
  column: Column
  cards: Card[]
  canEdit: boolean
  onRename: (name: string) => void
  onDelete: () => void
  onAddCard: (title: string) => void
  onEditCard: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, data: { type: 'column' }, disabled: !canEdit })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(column.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const submitCard = () => {
    if (draft.trim()) onAddCard(draft.trim())
    setDraft('')
  }

  return (
    <section ref={setNodeRef} className={`column${isDragging ? ' dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} aria-label={`Columna ${column.name}`} data-testid="column">
      <header className="column-head">
        {canEdit && (
          <button ref={setActivatorNodeRef} type="button" className="icon-btn grip" aria-label={`Mover columna ${column.name}`} {...attributes} {...listeners}>⠿</button>
        )}
        {renaming ? (
          <input
            className="column-name-input"
            aria-label="Nombre de la columna"
            value={name}
            autoFocus
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setRenaming(false); if (name.trim() && name.trim() !== column.name) onRename(name.trim()); else setName(column.name) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(column.name); setRenaming(false) } }}
          />
        ) : (
          <h2 className="column-name" onDoubleClick={() => canEdit && setRenaming(true)}>
            {column.name} <span className="count" aria-label={`${cards.length} tarjetas`}>{cards.length}</span>
          </h2>
        )}
        {canEdit && !renaming && (
          <span className="column-tools">
            <button type="button" className="icon-btn" aria-label={`Renombrar columna ${column.name}`} onClick={() => { setName(column.name); setRenaming(true) }}>✎</button>
            <button type="button" className="icon-btn" aria-label={`Eliminar columna ${column.name}`} onClick={() => setConfirmingDelete(true)}>🗑</button>
          </span>
        )}
      </header>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="cards">
          {cards.map((c) => <CardView key={c.id} card={c} canEdit={canEdit} onEdit={onEditCard} />)}
        </ul>
      </SortableContext>

      {canEdit && (adding ? (
        <form className="add-card" onSubmit={(e) => { e.preventDefault(); submitCard() }}>
          <input
            aria-label={`Título de la nueva tarjeta en ${column.name}`}
            value={draft}
            autoFocus
            maxLength={200}
            placeholder="Título de la tarjeta"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setDraft('') } }}
          />
          <div className="row">
            <button type="submit">Añadir</button>
            <button type="button" className="secondary" onClick={() => { setAdding(false); setDraft('') }}>Cerrar</button>
          </div>
        </form>
      ) : (
        <button type="button" className="add-card-btn" onClick={() => setAdding(true)}>+ Añadir tarjeta<span className="sr-only"> en {column.name}</span></button>
      ))}
      {confirmingDelete && (
        <ConfirmDialog
          title={`Eliminar «${column.name}»`}
          message={cards.length ? `Se eliminarán también sus ${cards.length} ${cards.length === 1 ? 'tarjeta' : 'tarjetas'}. No se puede deshacer.` : 'La columna está vacía.'}
          confirmLabel="Eliminar columna"
          onConfirm={onDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </section>
  )
}

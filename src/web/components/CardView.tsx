import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Card } from '../../shared/types'

export function CardBody({ card }: { card: Card }) {
  return (
    <>
      <span className="card-title">{card.title}</span>
      {card.description && <span className="card-note" aria-label="Tiene descripción">≡</span>}
    </>
  )
}

export function CardView({ card, canEdit, onEdit }: { card: Card; canEdit: boolean; onEdit: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { type: 'card', columnId: card.columnId }, disabled: !canEdit })
  return (
    <li
      ref={setNodeRef}
      className={`card${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="card"
      {...attributes}
      {...listeners}
      aria-label={card.title}
    >
      <CardBody card={card} />
      <button type="button" className="icon-btn edit-btn" aria-label={`Abrir tarjeta: ${card.title}`} onClick={() => onEdit(card.id)}>
        {canEdit ? '✎' : '👁'}
      </button>
    </li>
  )
}

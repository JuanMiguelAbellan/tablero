import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useRef, useState } from 'react'
import { cardsOf, predict, type BoardState } from '../../shared/state'
import type { Op } from '../../shared/types'
import { newId } from '../api'
import { CardBody } from './CardView'
import { CardDialog } from './CardDialog'
import { ColumnView } from './ColumnView'

const ES_INSTRUCTIONS = {
  draggable:
    'Para mover un elemento: pulsa Espacio o Intro para cogerlo, usa las flechas para desplazarlo, y pulsa Espacio o Intro para soltarlo. Escape cancela.',
}

/** Where would this drag put the item? Expressed as the operation the server understands ("after that sibling"). */
function operationFor(e: DragOverEvent | DragEndEvent, state: BoardState): Op | null {
  const { active, over } = e
  if (!over || over.id === active.id) return null
  const a = active.data.current as { type: string } | undefined
  const o = over.data.current as { type: string; columnId?: string } | undefined

  if (a?.type === 'card') {
    let columnId: string
    let afterId: string | null
    if (o?.type === 'card' && o.columnId) {
      columnId = o.columnId
      const siblings = cardsOf(state, columnId).filter((c) => c.id !== active.id)
      const i = siblings.findIndex((c) => c.id === over.id)
      const activeTop = active.rect.current.translated?.top ?? 0
      const lower = activeTop > over.rect.top + over.rect.height / 2 // dragged past the middle of the card underneath
      afterId = lower ? String(over.id) : i > 0 ? siblings[i - 1]!.id : null
    } else if (o?.type === 'column') {
      columnId = String(over.id)
      afterId = cardsOf(state, columnId).filter((c) => c.id !== active.id).at(-1)?.id ?? null // dropped on a column: to the end
    } else return null
    return { type: 'card.move', id: String(active.id), columnId, afterId }
  }

  if (a?.type === 'column') {
    const overColumn = o?.type === 'card' ? o.columnId : String(over.id)
    if (!overColumn || overColumn === active.id) return null
    const others = state.columns.filter((c) => c.id !== active.id)
    const at = others.findIndex((c) => c.id === overColumn)
    const movingRight = state.columns.findIndex((c) => c.id === overColumn) > state.columns.findIndex((c) => c.id === active.id)
    return { type: 'column.move', id: String(active.id), afterId: movingRight ? others[at]!.id : at > 0 ? others[at - 1]!.id : null }
  }
  return null
}

const layoutKey = (s: BoardState) => JSON.stringify([s.columns.map((c) => c.id), s.cards.map((c) => [c.id, c.columnId, c.position])])

export function BoardView({ state, canEdit, send }: { state: BoardState; canEdit: boolean; send: (op: Op) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a click is not a drag
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }), // keyboard users can move things too
  )
  const [active, setActive] = useState<{ type: 'card' | 'column'; id: string } | null>(null)
  const [drag, setDrag] = useState<{ op: Op; preview: BoardState } | null>(null)
  const current = useRef<Op | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [newColumn, setNewColumn] = useState('')

  // While dragging, show the tentative result; nothing is sent until the drop.
  const shown = drag?.preview ?? state

  function onDragStart(e: DragStartEvent) {
    const t = (e.active.data.current as { type: 'card' | 'column' }).type
    setActive({ type: t, id: String(e.active.id) })
  }
  function onDragOver(e: DragOverEvent) {
    const op = operationFor(e, state)
    if (!op) return
    current.current = op
    setDrag({ op, preview: predict(state, op) })
  }
  function onDragEnd(e: DragEndEvent) {
    const op = operationFor(e, state) ?? current.current
    if (op && layoutKey(predict(state, op)) !== layoutKey(state)) send(op)
    reset()
  }
  function reset() {
    current.current = null
    setDrag(null)
    setActive(null)
  }

  const editingCard = editing ? state.cards.find((c) => c.id === editing) : undefined
  const overlayCard = active?.type === 'card' ? shown.cards.find((c) => c.id === active.id) : undefined
  const lastColumn = state.columns.at(-1)?.id ?? null

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={reset} accessibility={{ screenReaderInstructions: ES_INSTRUCTIONS }}>
        <SortableContext items={shown.columns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          <div className="board" data-testid="board">
            {shown.columns.map((col) => (
              <ColumnView
                key={col.id}
                column={col}
                cards={cardsOf(shown, col.id)}
                canEdit={canEdit}
                onRename={(name) => send({ type: 'column.rename', id: col.id, name })}
                onDelete={() => send({ type: 'column.delete', id: col.id })}
                onAddCard={(title) => send({ type: 'card.add', id: newId(), columnId: col.id, title, afterId: cardsOf(state, col.id).at(-1)?.id ?? null })}
                onEditCard={setEditing}
              />
            ))}
            {canEdit && (
              <form className="new-column" onSubmit={(e) => { e.preventDefault(); if (newColumn.trim()) { send({ type: 'column.add', id: newId(), name: newColumn.trim(), afterId: lastColumn }); setNewColumn('') } }}>
                <label className="sr-only" htmlFor="new-column-name">Nombre de la nueva columna</label>
                <input id="new-column-name" value={newColumn} onChange={(e) => setNewColumn(e.target.value)} maxLength={80} placeholder="+ Nueva columna" />
                {newColumn.trim() && <button type="submit">Añadir columna</button>}
              </form>
            )}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {overlayCard && <div className="card overlay"><CardBody card={overlayCard} /></div>}
          {active?.type === 'column' && <div className="column overlay">{shown.columns.find((c) => c.id === active.id)?.name}</div>}
        </DragOverlay>
      </DndContext>

      {editingCard && (
        <CardDialog
          key={editingCard.id}
          card={editingCard}
          canEdit={canEdit}
          onSave={(title, description) => {
            // Send only what this person actually changed, so editing the description never overwrites someone else's new title.
            const changes = { ...(title !== editingCard.title ? { title } : {}), ...(description !== editingCard.description ? { description } : {}) }
            if (Object.keys(changes).length) send({ type: 'card.update', id: editingCard.id, ...changes })
          }}
          onDelete={() => send({ type: 'card.delete', id: editingCard.id })}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

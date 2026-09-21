import { generateKeyBetween } from 'fractional-indexing'

export interface Positioned {
  id: string
  position: string
}

/** Byte-wise comparison — the ordering fractional-indexing keys are designed for (NOT localeCompare). */
export const byPosition = (a: Positioned, b: Positioned) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)

/**
 * The key for an item placed right after `afterId` among `siblings` (null = at the very top), ignoring `excludeId`
 * (the item being moved, which is about to leave its old spot). If `afterId` is not among the siblings any more —
 * someone deleted or moved it while this request was in flight — the item goes to the end instead of failing:
 * a concurrent edit should never turn a drag into an error.
 *
 * Client and server both call this, so an optimistic move and the authoritative one land in the same place.
 */
export function keyAfter(siblings: Positioned[], afterId: string | null, excludeId?: string): string {
  const list = siblings.filter((s) => s.id !== excludeId).sort(byPosition)
  if (afterId === null) return generateKeyBetween(null, list[0]?.position ?? null)
  const i = list.findIndex((s) => s.id === afterId)
  if (i < 0) return generateKeyBetween(list.at(-1)?.position ?? null, null)
  return generateKeyBetween(list[i]!.position, list[i + 1]?.position ?? null)
}

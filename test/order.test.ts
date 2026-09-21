import { describe, expect, it } from 'vitest'
import { byPosition, keyAfter, type Positioned } from '../src/shared/order'

const build = (n: number): Positioned[] => {
  const items: Positioned[] = []
  for (let i = 0; i < n; i++) items.push({ id: `i${i}`, position: keyAfter(items, items.at(-1)?.id ?? null) })
  return items
}
const order = (items: Positioned[]) => [...items].sort(byPosition).map((i) => i.id)

describe('keyAfter', () => {
  it('inserts at the top, the middle and the end without touching other items', () => {
    const items = build(3) // i0 i1 i2
    const top = { id: 'top', position: keyAfter(items, null) }
    const mid = { id: 'mid', position: keyAfter(items, 'i0') }
    const end = { id: 'end', position: keyAfter(items, 'i2') }
    expect(order([...items, top, mid, end])).toEqual(['top', 'i0', 'mid', 'i1', 'i2', 'end'])
  })

  it('moving an item ignores its own old position', () => {
    const items = build(4) // i0..i3
    const moved = { id: 'i0', position: keyAfter(items, 'i2', 'i0') }
    expect(order(items.map((i) => (i.id === 'i0' ? moved : i)))).toEqual(['i1', 'i2', 'i0', 'i3'])
  })

  it('an unknown or vanished neighbour sends the item to the end instead of throwing', () => {
    const items = build(3)
    const key = keyAfter(items, 'deleted-meanwhile')
    expect(order([...items, { id: 'x', position: key }]).at(-1)).toBe('x')
  })

  it('an empty list works', () => {
    expect(typeof keyAfter([], null)).toBe('string')
    expect(typeof keyAfter([], 'nobody')).toBe('string')
  })

  it('always yields a key strictly between its neighbours, even after 500 insertions at the same spot', () => {
    let items = build(2)
    for (let n = 0; n < 500; n++) items = [...items, { id: `n${n}`, position: keyAfter(items, 'i0') }]
    const sorted = [...items].sort(byPosition)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1]!.position < sorted[i]!.position).toBe(true) // strictly increasing, no duplicates
    expect(sorted[0]!.id).toBe('i0')
    expect(sorted.at(-1)!.id).toBe('i1')
  })

  it('keys compare byte-wise: uppercase sorts before lowercase, unlike localeCompare', () => {
    expect('B' < 'a').toBe(true)
    expect('B'.localeCompare('a')).toBeGreaterThan(0) // this is exactly why the database column uses COLLATE "C"
  })
})

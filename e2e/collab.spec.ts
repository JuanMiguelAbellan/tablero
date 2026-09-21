import { expect, test } from '@playwright/test'
import { addCard, cardsIn, createBoard, drag, joinAs, signUp, titlesIn, column } from './helpers'

test('two people see each other\'s changes live, without reloading', async ({ page: a, browser }) => {
  await signUp(a, 'Ana')
  await createBoard(a)
  await addCard(a, 'Por hacer', 'Inicial')
  const { page: b } = await joinAs(browser, a, 'Puede editar', 'Beto')
  await expect.poll(() => titlesIn(b, 'Por hacer')).toEqual(['Inicial'])

  await addCard(a, 'Por hacer', 'De Ana')
  await expect.poll(() => titlesIn(b, 'Por hacer')).toEqual(['Inicial', 'De Ana']) // arrives by itself

  await drag(b, cardsIn(b, 'Por hacer').filter({ hasText: 'Inicial' }), column(b, 'Hecho').locator('.cards'))
  await expect.poll(() => titlesIn(a, 'Hecho')).toEqual(['Inicial'])
  await expect.poll(() => titlesIn(a, 'Por hacer')).toEqual(['De Ana'])

  await expect(a.locator('.avatar')).toHaveCount(2) // Beto joined and Ana's header noticed without reloading
})

test('both edit at the same moment: nothing is lost and both screens converge', async ({ page: a, browser }) => {
  await signUp(a, 'Ana')
  await createBoard(a)
  const { page: b } = await joinAs(browser, a, 'Puede editar', 'Beto')
  await Promise.all([addCard(a, 'Por hacer', 'Uno de Ana'), addCard(b, 'Por hacer', 'Uno de Beto')])
  await Promise.all([addCard(a, 'Por hacer', 'Dos de Ana'), addCard(b, 'Por hacer', 'Dos de Beto')])
  await expect.poll(async () => (await titlesIn(a, 'Por hacer')).length).toBe(4)
  await expect.poll(async () => (await titlesIn(b, 'Por hacer')).length).toBe(4)
  const onA = await titlesIn(a, 'Por hacer')
  expect(await titlesIn(b, 'Por hacer')).toEqual(onA) // same cards, same order on both screens
  expect([...onA].sort()).toEqual(['Dos de Ana', 'Dos de Beto', 'Uno de Ana', 'Uno de Beto'])
})

test('a read-only member can watch but not change anything', async ({ page: a, browser }) => {
  await signUp(a, 'Ana')
  await createBoard(a)
  await addCard(a, 'Por hacer', 'Solo se mira')
  const { page: v } = await joinAs(browser, a, 'Solo lectura', 'Vera')
  await expect(v.getByText('solo lectura').first()).toBeVisible()
  await expect(v.getByRole('button', { name: /Añadir tarjeta/ })).toHaveCount(0)
  await expect(v.getByPlaceholder('+ Nueva columna')).toHaveCount(0)
  await drag(v, cardsIn(v, 'Por hacer').first(), column(v, 'Hecho').locator('.cards')).catch(() => {})
  expect(await titlesIn(v, 'Por hacer')).toEqual(['Solo se mira'])
  await addCard(a, 'Por hacer', 'Pero sí ve lo de Ana')
  await expect.poll(() => titlesIn(v, 'Por hacer')).toEqual(['Solo se mira', 'Pero sí ve lo de Ana'])
})

test('working without a connection: edits appear at once, are retried, and are applied exactly once when the connection returns', async ({ page: a, browser }) => {
  await signUp(a, 'Ana')
  await createBoard(a)
  const { page: b } = await joinAs(browser, a, 'Puede editar', 'Beto')
  await addCard(a, 'Por hacer', 'Antes del corte')
  await expect.poll(() => titlesIn(b, 'Por hacer')).toEqual(['Antes del corte'])

  // Beto's requests that change data fail (as if his network dropped); Ana keeps working, and Beto still receives her changes.
  let blocked = 0
  await b.route('**/api/boards/*/ops', (route) => { blocked++; return route.abort('internetdisconnected') })
  await addCard(b, 'Por hacer', 'Escrita sin conexión') // appears immediately although nothing can be sent
  await addCard(b, 'Hecho', 'Otra sin conexión')
  expect(await titlesIn(b, 'Por hacer')).toContain('Escrita sin conexión')
  await expect.poll(() => blocked).toBeGreaterThan(0) // it really tried, and failed
  await addCard(a, 'Por hacer', 'De Ana mientras tanto')
  await expect.poll(() => titlesIn(b, 'Por hacer')).toContain('De Ana mientras tanto') // events keep flowing
  expect(await titlesIn(a, 'Por hacer')).not.toContain('Escrita sin conexión') // Ana cannot see Beto's unsent card
  await expect(b.getByTestId('connection')).toContainText('Guardando') // and Beto is told it is not saved yet

  await b.unroute('**/api/boards/*/ops') // connection restored: the retry (same operation id) goes through
  await expect.poll(async () => (await titlesIn(a, 'Por hacer')).sort(), { timeout: 30_000 }).toEqual(['Antes del corte', 'De Ana mientras tanto', 'Escrita sin conexión'])
  await expect.poll(() => titlesIn(a, 'Hecho'), { timeout: 30_000 }).toEqual(['Otra sin conexión'])
  await expect(b.getByTestId('connection')).toContainText('En vivo', { timeout: 30_000 })
  expect((await titlesIn(b, 'Por hacer')).filter((t) => t === 'Escrita sin conexión')).toHaveLength(1) // once, despite the retries
})

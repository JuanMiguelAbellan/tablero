import { expect, test } from '@playwright/test'
import { addCard, cardsIn, column, createBoard, drag, signUp, titlesIn } from './helpers'

test('create a board, add and edit cards; everything survives a reload', async ({ page }) => {
  await signUp(page)
  await createBoard(page)
  await addCard(page, 'Por hacer', 'Escribir la memoria')
  await addCard(page, 'Por hacer', 'Preparar la demo')
  expect(await titlesIn(page, 'Por hacer')).toEqual(['Escribir la memoria', 'Preparar la demo'])

  await cardsIn(page, 'Por hacer').first().getByRole('button', { name: /Abrir tarjeta/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Título').fill('Escribir la memoria (borrador)')
  await dialog.getByLabel('Descripción').fill('Solo el capítulo 3')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(cardsIn(page, 'Por hacer').first()).toContainText('borrador')

  await page.reload()
  await expect(page.getByTestId('connection')).toContainText('En vivo')
  expect(await titlesIn(page, 'Por hacer')).toEqual(['Escribir la memoria (borrador)', 'Preparar la demo'])
  await cardsIn(page, 'Por hacer').first().getByRole('button', { name: /Abrir tarjeta/ }).click()
  await expect(page.getByRole('dialog').getByLabel('Descripción')).toHaveValue('Solo el capítulo 3')
})

test('drag a card with the mouse between and within columns, and the order persists', async ({ page }) => {
  await signUp(page)
  await createBoard(page)
  for (const t of ['A', 'B', 'C']) await addCard(page, 'Por hacer', t)

  await drag(page, cardsIn(page, 'Por hacer').filter({ hasText: 'A' }), column(page, 'En curso').locator('.cards'))
  await expect.poll(() => titlesIn(page, 'En curso')).toEqual(['A'])
  expect(await titlesIn(page, 'Por hacer')).toEqual(['B', 'C'])

  await drag(page, cardsIn(page, 'Por hacer').filter({ hasText: 'C' }), cardsIn(page, 'Por hacer').filter({ hasText: 'B' }), 'top')
  await expect.poll(() => titlesIn(page, 'Por hacer')).toEqual(['C', 'B'])

  await expect(page.getByTestId('connection')).toContainText('En vivo') // saved
  await page.reload()
  await expect.poll(() => titlesIn(page, 'Por hacer')).toEqual(['C', 'B'])
  expect(await titlesIn(page, 'En curso')).toEqual(['A'])
})

test('keyboard users can move cards too (Space to pick up, arrows to move, Space to drop)', async ({ page }) => {
  await signUp(page)
  await createBoard(page)
  await addCard(page, 'Por hacer', 'Teclado')
  const card = cardsIn(page, 'Por hacer').first()
  await card.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await expect.poll(() => titlesIn(page, 'En curso')).toEqual(['Teclado'])
  await page.reload()
  await expect.poll(() => titlesIn(page, 'En curso')).toEqual(['Teclado'])
})

test('reorder and rename columns, and delete one with its cards', async ({ page }) => {
  await signUp(page)
  await createBoard(page)
  await page.getByPlaceholder('+ Nueva columna').fill('Revisión')
  await page.getByRole('button', { name: 'Añadir columna' }).click()
  await expect(column(page, 'Revisión')).toBeVisible()
  await addCard(page, 'Revisión', 'Lo revisa Ana')

  await column(page, 'Revisión').getByRole('button', { name: /Renombrar columna/ }).click()
  await page.getByLabel('Nombre de la columna').fill('QA')
  await page.getByLabel('Nombre de la columna').press('Enter')
  await expect(column(page, 'QA')).toBeVisible()

  const names = () => page.locator('[data-testid="column"] .column-name').evaluateAll((els) => els.map((e) => e.childNodes[0]!.textContent!.trim()))
  expect(await names()).toEqual(['Por hacer', 'En curso', 'Hecho', 'QA'])
  await drag(page, column(page, 'QA').getByRole('button', { name: /Mover columna/ }), column(page, 'Por hacer').locator('.column-head'))
  await expect.poll(names).toEqual(['QA', 'Por hacer', 'En curso', 'Hecho'])

  page.once('dialog', (d) => d.accept())
  await column(page, 'QA').getByRole('button', { name: /Eliminar columna/ }).click()
  await expect(column(page, 'QA')).toHaveCount(0)
  await page.reload()
  expect(await names()).toEqual(['Por hacer', 'En curso', 'Hecho'])
})

test('access: anonymous visitors are sent to login; a stranger gets "not found" for someone else\'s board', async ({ page, browser }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await signUp(page)
  const name = await createBoard(page)
  const url = page.url()

  const stranger = await (await browser.newContext()).newPage()
  await signUp(stranger, 'Intrusa')
  await stranger.goto(url)
  await expect(stranger.getByRole('heading', { name: 'Tablero no encontrado' })).toBeVisible()
  await expect(stranger.getByText(name)).toHaveCount(0)
})

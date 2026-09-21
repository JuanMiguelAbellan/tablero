import { expect, type Browser, type Locator, type Page } from '@playwright/test'

export const rnd = () => Math.random().toString(36).slice(2, 8)

export async function signUp(page: Page, name = 'Ana') {
  const email = `e2e-${rnd()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel(/^Contraseña/).fill('contraseña-larga')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(page.getByRole('heading', { name: 'Mis tableros' })).toBeVisible()
  return email
}

export async function createBoard(page: Page, name = `Tablero ${rnd()}`) {
  await page.getByPlaceholder('Nombre del nuevo tablero').fill(name)
  await page.getByRole('button', { name: 'Crear tablero' }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  await expect(page.getByTestId('connection')).toContainText('En vivo')
  return name
}

export const column = (page: Page, name: string) => page.getByRole('region', { name: `Columna ${name}` })
export const cardsIn = (page: Page, columnName: string) => column(page, columnName).getByTestId('card')
export const titlesIn = async (page: Page, columnName: string) => (await cardsIn(page, columnName).locator('.card-title').allTextContents())

export async function addCard(page: Page, columnName: string, title: string) {
  const col = column(page, columnName)
  if (!(await col.getByLabel(/^Título de la nueva tarjeta/).isVisible())) await col.getByRole('button', { name: /Añadir tarjeta/ }).click()
  await col.getByLabel(/^Título de la nueva tarjeta/).fill(title)
  await col.getByLabel(/^Título de la nueva tarjeta/).press('Enter')
  await expect(col.getByTestId('card').filter({ hasText: title })).toBeVisible()
}

/** A real pointer drag, in small steps (drag-and-drop libraries listen to pointer moves, not to a teleporting cursor). */
export async function drag(page: Page, from: Locator, to: Locator, where: 'top' | 'bottom' | 'middle' = 'middle') {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  const y = where === 'top' ? b.y + 4 : where === 'bottom' ? b.y + b.height - 4 : b.y + b.height / 2
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, y, { steps: 20 })
  await page.mouse.up()
}

/** Second browser context signed up as another user, joined to the board through a real invite link. */
export async function joinAs(browser: Browser, owner: Page, role: 'Puede editar' | 'Solo lectura', name: string) {
  await owner.getByRole('button', { name: 'Compartir' }).click()
  const dialog = owner.getByRole('dialog')
  await dialog.getByLabel('Permiso').selectOption({ label: role })
  await dialog.getByRole('button', { name: 'Crear enlace' }).click()
  const link = await dialog.getByLabel('Enlace de invitación').inputValue()
  await dialog.getByRole('button', { name: 'Cerrar' }).click()
  await expect(dialog).toHaveCount(0)

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(link)
  await page.getByRole('link', { name: 'Crear cuenta' }).click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Email').fill(`e2e-${rnd()}@example.com`)
  await page.getByLabel(/^Contraseña/).fill('contraseña-larga')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.getByRole('button', { name: 'Unirme al tablero' }).click()
  await expect(page.getByTestId('connection')).toContainText(/En vivo|Guardando/)
  return { page, ctx }
}

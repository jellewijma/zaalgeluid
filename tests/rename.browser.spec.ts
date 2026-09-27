import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAppServer } from '../server/app'
import type { Setup, Track } from '../shared/protocol'

declare global {
  interface Window {
    __renameAudio: HTMLAudioElement[]
    __renameLoads: number[]
  }
}

const test = base.extend<{ room: { player: Page; controller: Page; setup: Setup } }>({
  room: async ({ browser }, use) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'zaalgeluid-rename-e2e-'))
    const server = await createAppServer({ dataDir, port: 0, host: '127.0.0.1', dev: false })
    const { port } = await server.listen()
    const baseURL = `http://127.0.0.1:${port}`
    const playerContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
    const controllerContext = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 }, hasTouch: true })
    try {
      await playerContext.addInitScript(() => {
        // Observe native audio without changing playback or media events.
        window.__renameAudio = []
        window.__renameLoads = []
        window.Audio = new Proxy(window.Audio, {
          construct(target, args) {
            const audio = Reflect.construct(target, args) as HTMLAudioElement
            const index = window.__renameAudio.length
            window.__renameAudio.push(audio)
            window.__renameLoads.push(0)
            audio.addEventListener('loadstart', () => { window.__renameLoads[index]++ })
            return audio
          },
        })
      })
      const player = await playerContext.newPage()
      const controller = await controllerContext.newPage()
      const setupResponse = await player.request.get('/api/setup')
      expect(setupResponse.ok()).toBe(true)
      const setup = await setupResponse.json() as Setup
      await player.goto('/player')
      await player.getByRole('button', { name: 'Audio activeren', exact: true }).click()
      await expect(player.getByRole('slider', { name: 'Muziekvolume', exact: true })).toBeEnabled()
      await controller.goto('/control')
      await controller.getByLabel('Koppelcode', { exact: true }).fill(setup.pin)
      await controller.getByRole('button', { name: 'Verbind met de afspeler', exact: true }).click()
      await expect(controller.getByRole('heading', { name: 'Bediening', exact: true })).toBeVisible()
      await use({ player, controller, setup })
    } finally {
      await controllerContext.close()
      await playerContext.close()
      await server.close()
      const resolved = path.resolve(dataDir)
      if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('zaalgeluid-rename-e2e-')) {
        await rm(resolved, { recursive: true, force: true })
      }
    }
  },
})

function audioFile(name: string) {
  const rate = 8000
  const seconds = 60
  const buffer = Buffer.alloc(44 + rate * seconds * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(buffer.length - 44, 40)
  for (let index = 0; index < rate * seconds; index++) {
    buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / rate) * 16), 44 + index * 2)
  }
  return { name: `${name}.wav`, mimeType: 'audio/wav', buffer }
}

async function upload(player: Page, name: string, effects = false) {
  const response = player.waitForResponse(candidate => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/tracks')
  await player.getByLabel(effects ? 'Geluidseffecten toevoegen' : 'Audiobestanden toevoegen', { exact: true }).setInputFiles(audioFile(name))
  expect((await response).status()).toBe(201)
  await expect(player.getByRole('button', { name: `${name} hernoemen`, exact: true })).toBeEnabled()
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 70; count++) {
    if (await target.evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target, 'Rename must be reachable using only Tab').toBeFocused()
}

async function rename(player: Page, currentName: string, newName: string) {
  await player.getByRole('button', { name: `${currentName} hernoemen`, exact: true }).click()
  const dialog = player.getByRole('dialog', { name: 'Naam wijzigen', exact: true })
  await dialog.getByRole('textbox', { name: 'Naam', exact: true }).fill(newName)
  await dialog.getByRole('button', { name: 'Opslaan', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(player.getByRole('button', { name: `${newName} hernoemen`, exact: true })).toBeVisible()
}

async function media(player: Page) {
  return player.evaluate(() => window.__renameAudio.map((audio, index) => ({
    paused: audio.paused,
    time: audio.currentTime,
    src: audio.currentSrc,
    loads: window.__renameLoads[index],
  })))
}

async function tracks(player: Page, setup: Setup) {
  const response = await player.request.get('/api/tracks', { headers: { Authorization: `Bearer ${setup.token}` } })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<Track[]>
}

async function expectNoHorizontalOverflow(player: Page) {
  await expect.poll(() => player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('song names can be edited with the keyboard, while blank names and cancellation preserve the original', async ({ room: { player, controller } }, testInfo) => {
  await upload(player, 'Bestand 001')
  const edit = player.getByRole('button', { name: 'Bestand 001 hernoemen', exact: true })
  await tabTo(player, edit)
  await player.keyboard.press('Enter')
  const dialog = player.getByRole('dialog', { name: 'Naam wijzigen', exact: true })
  const field = dialog.getByRole('textbox', { name: 'Naam', exact: true })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('Bestand 001')
  await expect(field).toHaveAttribute('maxlength', '200')
  expect(await field.evaluate(input => {
    const element = input as HTMLInputElement
    return [element.selectionStart, element.selectionEnd]
  })).toEqual([0, 'Bestand 001'.length])
  await field.fill('   ')
  await expect(dialog.getByRole('button', { name: 'Opslaan', exact: true })).toBeDisabled()
  await player.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await field.fill('Niet bewaren')
  await player.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(edit).toBeVisible()
  await edit.click()
  await expect(field).toHaveValue('Bestand 001')
  await field.fill('Ook niet bewaren')
  await dialog.getByRole('button', { name: 'Annuleren', exact: true }).click()
  await expect(edit).toBeVisible()
  await edit.click()
  await field.fill('Welkom in de zaal')
  await expectNoHorizontalOverflow(player)
  const screenshot = testInfo.outputPath('rename-desktop-dialog.png')
  await player.screenshot({ path: screenshot })
  await testInfo.attach('Desktop rename dialog', { path: screenshot, contentType: 'image/png' })
  await player.keyboard.press('Enter')
  await expect(dialog).not.toBeVisible()
  await expect(player.getByRole('button', { name: 'Welkom in de zaal hernoemen', exact: true })).toBeVisible()
  await expect(controller.getByRole('button', { name: 'Welkom in de zaal aan afspeellijst toevoegen', exact: true })).toBeVisible()
})

test('a failed save keeps the draft for retry and a pending save allows dismissal without duplicate submission', async ({ room: { player, controller } }) => {
  await upload(player, 'Opname')
  let attempts = 0
  let releaseSave: () => void = () => {}
  const pendingSave = new Promise<void>(resolve => { releaseSave = resolve })
  await player.route('**/api/tracks/*', async route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts++
    expect(route.request().postDataJSON()).toEqual({ name: 'Openingsmuziek' })
    if (attempts === 1) {
      await route.fulfill({ status: 500, json: { error: 'Opslaan mislukt. Probeer opnieuw.' } })
    } else {
      await pendingSave
      await route.continue()
    }
  })
  try {
    await player.getByRole('button', { name: 'Opname hernoemen', exact: true }).click()
    const dialog = player.getByRole('dialog', { name: 'Naam wijzigen', exact: true })
    const field = dialog.getByRole('textbox', { name: 'Naam', exact: true })
    await field.fill('Openingsmuziek')
    await dialog.getByRole('button', { name: 'Opslaan', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Opslaan mislukt. Probeer opnieuw.')
    await expect(field).toHaveValue('Openingsmuziek')
    await expect(controller.getByRole('button', { name: 'Opname aan afspeellijst toevoegen', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Opslaan', exact: true }).click()
    await expect.poll(() => attempts).toBe(2)
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled()
    await player.keyboard.press('Enter')
    await player.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(player.getByRole('button', { name: 'Opname hernoemen', exact: true })).toBeDisabled()
    releaseSave()
    await expect(player.getByRole('button', { name: 'Openingsmuziek hernoemen', exact: true })).toBeVisible()
    expect(attempts).toBe(2)
  } finally {
    releaseSave()
    await player.unroute('**/api/tracks/*')
  }
})

test('renaming queued playing music and effects updates the controller without interrupting audio and survives refresh', async ({ room: { player, controller, setup } }, testInfo) => {
  await upload(player, 'Song 01')
  await upload(player, 'Effect 01', true)
  const original = await tracks(player, setup)
  await controller.getByRole('button', { name: 'Song 01 aan afspeellijst toevoegen', exact: true }).tap()
  await controller.getByRole('button', { name: 'Afspelen', exact: true }).tap()
  await expect.poll(async () => (await media(player))[0].time).toBeGreaterThan(0.2)
  await player.getByRole('button', { name: 'Afspeellijst (1)', exact: true }).click()
  const musicBefore = (await media(player))[0]
  await rename(player, 'Song 01', 'Binnenkomst')
  await expect(controller.getByRole('heading', { name: 'Binnenkomst', exact: true })).toBeVisible()
  await controller.getByRole('tab', { name: 'Afspeellijst', exact: true }).tap()
  await expect(controller.locator('.tablet-fragment-name')).toHaveText(['Binnenkomst'])
  const musicAfter = (await media(player))[0]
  expect(musicAfter.paused).toBe(false)
  expect(musicAfter.src).toBe(musicBefore.src)
  expect(musicAfter.loads).toBe(musicBefore.loads)
  expect(musicAfter.time).toBeGreaterThan(musicBefore.time)

  await controller.getByRole('button', { name: 'Effect 01 effect afspelen', exact: true }).tap()
  await expect.poll(async () => (await media(player))[1].time).toBeGreaterThan(0.2)
  const effectBefore = (await media(player))[1]
  await player.setViewportSize({ width: 390, height: 844 })
  await player.getByRole('button', { name: 'Effect 01 hernoemen', exact: true }).click()
  const dialog = player.getByRole('dialog', { name: 'Naam wijzigen', exact: true })
  await dialog.getByRole('textbox', { name: 'Naam', exact: true }).fill('Applaus van het publiek')
  await expectNoHorizontalOverflow(player)
  const dialogBounds = await dialog.boundingBox()
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(390)
  expect(dialogBounds!.y).toBeGreaterThanOrEqual(0)
  expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(844)
  const screenshot = testInfo.outputPath('rename-mobile-dialog.png')
  await player.screenshot({ path: screenshot })
  await testInfo.attach('Mobile rename dialog', { path: screenshot, contentType: 'image/png' })
  await dialog.getByRole('button', { name: 'Opslaan', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(controller.getByRole('button', { name: 'Applaus van het publiek effect afspelen', exact: true })).toBeVisible()
  const effectAfter = (await media(player))[1]
  expect(effectAfter.paused).toBe(false)
  expect(effectAfter.src).toBe(effectBefore.src)
  expect(effectAfter.loads).toBe(effectBefore.loads)
  expect(effectAfter.time).toBeGreaterThan(effectBefore.time)
  expect((await media(player))[0].paused).toBe(false)
  const updated = await tracks(player, setup)
  expect(updated.map(track => ({ ...track, name: '' }))).toEqual(original.map(track => ({ ...track, name: '' })))
  expect(updated.map(track => track.name)).toEqual(['Binnenkomst', 'Applaus van het publiek'])

  await player.reload()
  await expect(player.getByRole('button', { name: 'Binnenkomst hernoemen', exact: true })).toBeVisible()
  await expect(player.getByRole('button', { name: 'Applaus van het publiek hernoemen', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(player)
  const libraryScreenshot = testInfo.outputPath('rename-mobile-library.png')
  await player.screenshot({ path: libraryScreenshot, fullPage: true })
  await testInfo.attach('Mobile renamed library', { path: libraryScreenshot, contentType: 'image/png' })
})

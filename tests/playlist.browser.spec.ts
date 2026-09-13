import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAppServer } from '../server/app'
import type { Setup } from '../shared/protocol'

declare global {
  interface Window {
    __playlistAudio: HTMLAudioElement[]
    __playlistGains: GainNode[]
  }
}

const test = base.extend<{ room: { player: Page; controller: Page } }>({
  room: async ({ browser }, use) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'zaalgeluid-playlist-e2e-'))
    const server = await createAppServer({ dataDir, port: 0, host: '127.0.0.1', dev: process.env.E2E_DEV === '1' })
    const { port } = await server.listen()
    const baseURL = `http://127.0.0.1:${port}`
    const playerContext = await browser.newContext({ baseURL })
    const controllerContext = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 }, hasTouch: true })
    try {
      await playerContext.addInitScript(() => {
        // Observe real native media and Web Audio objects without replacing their behavior.
        window.__playlistAudio = []
        window.__playlistGains = []
        window.Audio = new Proxy(window.Audio, {
          construct(target, args) {
            const audio = Reflect.construct(target, args) as HTMLAudioElement
            window.__playlistAudio.push(audio)
            return audio
          },
        })
        const createGain = AudioContext.prototype.createGain
        AudioContext.prototype.createGain = function () {
          const gain = createGain.call(this)
          window.__playlistGains.push(gain)
          return gain
        }
      })
      const player = await playerContext.newPage()
      const controller = await controllerContext.newPage()
      const setupResponse = await player.request.get('/api/setup')
      expect(setupResponse.ok()).toBe(true)
      const setup = await setupResponse.json() as Setup
      await player.goto('/player')
      await player.getByRole('button', { name: 'Audio activeren', exact: true }).click()
      await expect(player.getByText('Afspeler verbonden en audio geactiveerd', { exact: true })).toBeVisible()
      await controller.goto('/control')
      await controller.getByLabel('Koppelcode', { exact: true }).fill(setup.pin)
      await controller.getByRole('button', { name: 'Verbind met de afspeler', exact: true }).click()
      await expect(controller.getByRole('heading', { name: 'Bediening', exact: true })).toBeVisible()
      await use({ player, controller })
    } finally {
      await controllerContext.close()
      await playerContext.close()
      await server.close()
      const resolved = path.resolve(dataDir)
      if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('zaalgeluid-playlist-e2e-')) {
        await rm(resolved, { recursive: true, force: true })
      }
    }
  },
})

function audioFile(name: string, seconds = 30) {
  const rate = 8000
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

async function upload(player: Page, files: ReturnType<typeof audioFile>[], effects = false) {
  const response = player.waitForResponse(candidate => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/tracks')
  await player.getByLabel(effects ? 'Geluidseffecten toevoegen' : 'Audiobestanden toevoegen', { exact: true }).setInputFiles(files)
  expect((await response).status()).toBe(201)
}

async function nativeMedia(player: Page) {
  return player.evaluate(() => ({
    music: { paused: window.__playlistAudio[0].paused, time: window.__playlistAudio[0].currentTime, duration: window.__playlistAudio[0].duration },
    effect: { paused: window.__playlistAudio[1].paused, time: window.__playlistAudio[1].currentTime },
    gains: window.__playlistGains.map(gain => gain.gain.value),
  }))
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 70; count++) {
    if (await target.evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target, 'The action must be reachable using only Tab').toBeFocused()
}

async function findLibraryButton(controller: Page, name: string) {
  const previous = controller.getByRole('button', { name: 'Vorige fragmenten', exact: true })
  while (await previous.isEnabled()) await previous.tap()
  const target = controller.getByRole('button', { name, exact: true })
  for (let page = 0; page < 50; page++) {
    if (await target.isVisible()) return target
    const next = controller.getByRole('button', { name: 'Volgende fragmenten', exact: true })
    if (!await next.isEnabled()) break
    await next.tap()
  }
  await expect(target).toBeVisible()
  return target
}

async function expectNoScroll(controller: Page) {
  await expect.poll(() => controller.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > innerWidth,
    vertical: document.documentElement.scrollHeight > innerHeight,
    internal: [...document.querySelectorAll('*')].some(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1),
  }))).toEqual({ horizontal: false, vertical: false, internal: false })
  for (const target of await controller.getByRole('button').all()) {
    if (!await target.isVisible()) continue
    const box = await target.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(48)
    expect(box!.y + box!.height).toBeLessThanOrEqual(controller.viewportSize()!.height)
  }
}

test('queued songs advance naturally and effects play with independent volume and stopping', async ({ room: { player, controller } }) => {
  await upload(player, [audioFile('Eerste liedje', 1), audioFile('Tweede liedje', 60)])
  await upload(player, [audioFile('Applaus', 60)], true)
  await controller.getByRole('button', { name: 'Eerste liedje aan afspeellijst toevoegen', exact: true }).tap()
  await controller.getByRole('button', { name: 'Tweede liedje aan afspeellijst toevoegen', exact: true }).tap()
  await expect(controller.getByRole('heading', { name: 'Eerste liedje', exact: true })).toBeVisible()
  expect((await nativeMedia(player)).music.paused).toBe(true)
  await controller.getByRole('tab', { name: 'Afspeellijst', exact: true }).tap()
  await expect(controller.locator('.tablet-fragment-name')).toHaveText(['Eerste liedje', 'Tweede liedje'])
  await controller.getByRole('button', { name: 'Afspelen', exact: true }).tap()
  await expect(controller.getByRole('heading', { name: 'Tweede liedje', exact: true })).toBeVisible()
  await expect.poll(async () => (await nativeMedia(player)).music.time).toBeGreaterThan(0.2)
  await expect(controller.getByRole('button', { name: 'Vorig liedje', exact: true })).toBeEnabled()
  await expect(controller.getByRole('button', { name: 'Volgend liedje', exact: true })).toBeDisabled()

  await controller.getByRole('tab', { name: 'Geluidseffecten', exact: true }).tap()
  await controller.getByRole('button', { name: 'Applaus effect afspelen', exact: true }).tap()
  await expect.poll(async () => (await nativeMedia(player)).effect.time).toBeGreaterThan(0.2)
  expect((await nativeMedia(player)).music.paused).toBe(false)
  const musicBefore = (await nativeMedia(player)).music.time
  const effectVolume = controller.getByRole('slider', { name: 'Effectvolume', exact: true })
  await tabTo(controller, effectVolume)
  await controller.keyboard.press('Home')
  await expect.poll(async () => (await nativeMedia(player)).gains[1]).toBe(0)
  expect((await nativeMedia(player)).gains[0]).toBeCloseTo(0.75)
  const musicVolume = controller.getByRole('slider', { name: 'Muziekvolume', exact: true })
  await tabTo(controller, musicVolume)
  await controller.keyboard.press('End')
  await expect.poll(async () => (await nativeMedia(player)).gains[0]).toBe(1)
  expect((await nativeMedia(player)).gains[1]).toBe(0)
  await controller.getByRole('button', { name: 'Effect stoppen', exact: true }).tap()
  await expect.poll(async () => (await nativeMedia(player)).effect.paused).toBe(true)
  await expect.poll(async () => (await nativeMedia(player)).music.time).toBeGreaterThan(musicBefore)
  expect((await nativeMedia(player)).music.paused).toBe(false)
  await controller.getByRole('button', { name: 'Applaus effect afspelen', exact: true }).tap()
  await expect.poll(async () => (await nativeMedia(player)).effect.paused).toBe(false)
  await controller.getByRole('button', { name: 'Stoppen', exact: true }).tap()
  await expect.poll(async () => {
    const media = await nativeMedia(player)
    return [media.music.paused, media.music.time, media.effect.paused]
  }).toEqual([true, 0, true])
})

test('tablet playlist and effects remain reachable by touch and keyboard without scrolling', async ({ room: { player, controller } }, testInfo) => {
  await upload(player, Array.from({ length: 25 }, (_, index) => audioFile(`Liedje ${String(index + 1).padStart(2, '0')}`, 2)))
  await upload(player, Array.from({ length: 16 }, (_, index) => audioFile(`Effect ${String(index + 1).padStart(2, '0')}`, 30)), true)
  const add = await findLibraryButton(controller, 'Liedje 25 aan afspeellijst toevoegen')
  await tabTo(controller, add)
  await controller.keyboard.press('Enter')
  await expect(controller.getByRole('heading', { name: 'Liedje 25', exact: true })).toBeVisible()
  expect((await nativeMedia(player)).music.paused).toBe(true)
  await controller.getByRole('tab', { name: 'Afspeellijst', exact: true }).tap()
  await expect(controller.getByRole('button', { name: 'Liedje 25 uit afspeellijst verwijderen', exact: true })).toBeVisible()
  await controller.getByRole('tab', { name: 'Geluidseffecten', exact: true }).tap()
  const effect = await findLibraryButton(controller, 'Effect 16 effect afspelen')
  await tabTo(controller, effect)
  await controller.keyboard.press('Space')
  await expect.poll(async () => (await nativeMedia(player)).effect.paused).toBe(false)
  expect((await nativeMedia(player)).music.paused).toBe(true)
  await expect(controller.getByText('Effect speelt', { exact: true })).toBeVisible()

  for (const [width, height] of [[1024, 600], [768, 1024], [390, 844]]) {
    await controller.setViewportSize({ width, height })
    for (const name of ['Liedjes', 'Afspeellijst', 'Geluidseffecten']) {
      await controller.getByRole('tab', { name, exact: true }).tap()
      await expectNoScroll(controller)
    }
    const screenshot = testInfo.outputPath(`playlist-effects-${width}x${height}.png`)
    await controller.screenshot({ path: screenshot, fullPage: true })
    await testInfo.attach(`${width}×${height}`, { path: screenshot, contentType: 'image/png' })
  }
  await controller.getByRole('button', { name: 'Effect stoppen', exact: true }).tap()
  await controller.getByRole('tab', { name: 'Afspeellijst', exact: true }).tap()
  const remove = controller.getByRole('button', { name: 'Liedje 25 uit afspeellijst verwijderen', exact: true })
  await tabTo(controller, remove)
  await controller.keyboard.press('Enter')
  await expect(controller.getByText('Je afspeellijst is leeg', { exact: true })).toBeVisible()
})

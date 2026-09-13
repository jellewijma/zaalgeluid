import { test, expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAppServer } from '../server/app'
import type { Setup } from '../shared/protocol'

declare global {
  interface Window {
    __e2eAudio: HTMLAudioElement[]
    __e2eGains: GainNode[]
    __e2eSockets: WebSocket[]
  }
}

let server: Awaited<ReturnType<typeof createAppServer>>
let dataDir: string
const baseURL = 'http://127.0.0.1:3107'

test.beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'zaalgeluid-e2e-'))
  server = await createAppServer({ dataDir, port: 3107, host: '127.0.0.1', dev: process.env.E2E_DEV === '1' })
  await server.listen()
})

test.afterAll(async () => {
  await server?.close()
  // Only the exact directory returned by mkdtemp is removed, after the server closes.
  if (dataDir && path.dirname(dataDir) === tmpdir() && path.basename(dataDir).startsWith('zaalgeluid-e2e-')) {
    await rm(dataDir, { recursive: true, force: true })
  }
})

function quietWav(seconds = 30) {
  const rate = 8000
  const data = Buffer.alloc(44 + rate * seconds * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(data.length - 8, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24)
  data.writeUInt32LE(rate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(data.length - 44, 40)
  for (let index = 0; index < rate * seconds; index++) {
    data.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / rate) * 16), 44 + index * 2)
  }
  return data
}

async function observeNativeMedia(context: BrowserContext) {
  await context.addInitScript(() => {
    // Observe genuine browser objects. No playback, clock, media events, or network
    // responses are mocked; the real decoder and Web Audio graph run normally.
    window.__e2eAudio = []
    window.__e2eGains = []
    window.__e2eSockets = []
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement
        window.__e2eAudio.push(audio)
        return audio
      },
    })
    const createGain = AudioContext.prototype.createGain
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this)
      window.__e2eGains.push(gain)
      return gain
    }
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket
        if (new URL(String(args[0]), location.href).pathname === '/ws') window.__e2eSockets.push(socket)
        return socket
      },
    })
  })
}

async function media(page: Page) {
  return page.evaluate(() => {
    const audio = window.__e2eAudio.at(-1)
    if (!audio) throw new Error('There is no player audio element')
    return { src: audio.currentSrc, sourceAttribute: audio.getAttribute('src'), paused: audio.paused, currentTime: audio.currentTime, duration: audio.duration, ended: audio.ended }
  })
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 45; count++) {
    if (await target.evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target, 'Critical control must be reachable using Tab').toBeFocused()
}

async function pair(controller: Page, pin: string) {
  await controller.goto('/control')
  await controller.getByLabel('Koppelcode', { exact: true }).fill(pin)
  await controller.keyboard.press('Tab')
  await expect(controller.getByRole('button', { name: 'Verbind met de afspeler' })).toBeFocused()
  await controller.keyboard.press('Enter')
  await expect(controller.getByRole('heading', { name: 'Jij hebt de regie.' })).toBeVisible()
}

async function session(browser: Browser) {
  const playerContext = await browser.newContext({ baseURL })
  const controllerContext = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 } })
  await observeNativeMedia(playerContext)
  await observeNativeMedia(controllerContext)
  const player = await playerContext.newPage()
  const controller = await controllerContext.newPage()
  const setupResponse = await player.request.get('http://127.0.0.1:3107/api/setup')
  expect(setupResponse.ok()).toBe(true)
  const setup = await setupResponse.json() as Setup
  await player.goto('http://127.0.0.1:3107/player')
  await expect(player.getByRole('button', { name: 'Audio activeren', exact: true })).toBeEnabled()
  await pair(controller, setup.pin)
  let controllerClosed = false
  let playerClosed = false
  controllerContext.on('close', () => { controllerClosed = true })
  playerContext.on('close', () => { playerClosed = true })
  return {
    player, controller, setup, playerContext, controllerContext,
    close: async () => {
      if (!controllerClosed) await controllerContext.close()
      if (!playerClosed) await playerContext.close()
    },
  }
}

async function activateAndUpload(player: Page, controller: Page, name: string, buffer = quietWav()) {
  const activate = player.getByRole('button', { name: 'Audio activeren', exact: true })
  await tabTo(player, activate)
  await player.keyboard.press('Enter')
  await expect(player.getByText('Afspeler verbonden en audio geactiveerd', { exact: true })).toBeVisible()
  await player.getByLabel('Audiobestanden toevoegen').setInputFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer })
  await expect(controller.getByRole('button', { name: `${name} klaarzetten`, exact: true })).toBeEnabled()
  await controller.getByRole('button', { name: `${name} klaarzetten`, exact: true }).click()
  await expect(player.getByRole('heading', { name, exact: true })).toBeVisible()
}

async function screenshot(page: Page, name: string, testInfo: TestInfo) {
  const file = testInfo.outputPath(name)
  await page.screenshot({ path: file, fullPage: true })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

test('tablet controls genuine playback, pause, restart, stop, gain and keyboard seeking', async ({ browser }, testInfo) => {
  const pairSession = await session(browser)
  const { player, controller } = pairSession
  try {
    const errors: string[] = []
    player.on('pageerror', error => errors.push(error.message))
    controller.on('pageerror', error => errors.push(error.message))
    await activateAndUpload(player, controller, 'Opening vanuit de zaal')
    await expect.poll(async () => (await media(player)).duration).toBe(30)
    expect((await media(player)).paused).toBe(true)
    expect(await controller.evaluate(() => window.__e2eAudio.length)).toBe(0)

    const play = controller.getByRole('button', { name: 'Afspelen', exact: true })
    await tabTo(controller, play)
    await controller.keyboard.press('Space')
    await expect.poll(async () => (await media(player)).currentTime).toBeGreaterThan(0.3)
    await expect(controller.getByText('Speelt af', { exact: true })).toBeVisible()
    await expect(player.getByText('Speelt af', { exact: true })).toBeVisible()

    const pause = controller.getByRole('button', { name: 'Pauzeren', exact: true })
    await expect(pause).toBeFocused()
    await controller.keyboard.press('Enter')
    await expect.poll(async () => (await media(player)).paused).toBe(true)
    const pausedAt = (await media(player)).currentTime
    await expect(controller.getByText('Gepauzeerd', { exact: true })).toBeVisible()
    await controller.waitForTimeout(350)
    expect((await media(player)).currentTime).toBeCloseTo(pausedAt, 2)

    const seek = controller.getByRole('slider', { name: 'Afspeelpositie', exact: true })
    await tabTo(controller, seek)
    await controller.keyboard.press('End')
    await expect.poll(async () => (await media(player)).currentTime).toBeCloseTo(30, 1)
    await controller.keyboard.press('Home')
    await expect.poll(async () => (await media(player)).currentTime).toBe(0)

    const volume = controller.getByRole('slider', { name: 'Uitvoervolume', exact: true })
    await tabTo(controller, volume)
    await controller.keyboard.press('Home')
    await expect.poll(() => player.evaluate(() => window.__e2eGains.at(-1)!.gain.value)).toBe(0)
    await controller.keyboard.press('ArrowRight')
    await expect.poll(() => player.evaluate(() => window.__e2eGains.at(-1)!.gain.value)).toBeCloseTo(0.01, 5)
    await expect(player.locator('.volume-heading')).toContainText('1%')

    const restart = controller.getByRole('button', { name: 'Opnieuw', exact: true })
    await tabTo(controller, restart)
    await controller.keyboard.press('Enter')
    await expect.poll(async () => (await media(player)).paused).toBe(false)
    await expect.poll(async () => (await media(player)).currentTime).toBeGreaterThan(0.1)
    expect((await media(player)).currentTime).toBeLessThan(2)

    const stop = controller.getByRole('button', { name: 'Stoppen', exact: true })
    await tabTo(controller, stop)
    await controller.keyboard.press('Space')
    await expect.poll(async () => (await media(player)).paused).toBe(true)
    await expect.poll(async () => (await media(player)).currentTime).toBe(0)
    await expect(controller.getByText('Gestopt', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
    await screenshot(player, 'player-desktop.png', testInfo)
    await screenshot(controller, 'controller-tablet.png', testInfo)
  } finally { await pairSession.close() }
})

test('wrong code is rejected and a second player cannot take over', async ({ browser }) => {
  const first = await session(browser)
  const otherContext = await browser.newContext({ baseURL })
  try {
    const wrongController = await otherContext.newPage()
    await wrongController.goto('http://127.0.0.1:3107/control')
    const wrongPin = first.setup.pin === '111111' ? '222222' : '111111'
    await wrongController.getByLabel('Koppelcode', { exact: true }).fill(wrongPin)
    await wrongController.getByRole('button', { name: 'Verbind met de afspeler' }).click()
    await expect(wrongController.getByRole('alert')).toContainText('Deze koppelcode klopt niet.')
    const otherPlayer = await otherContext.newPage()
    await otherPlayer.goto('http://127.0.0.1:3107/player')
    await expect(otherPlayer.getByText('Er is al een afspeler actief.', { exact: true })).toBeVisible()
    await expect(first.player.getByRole('button', { name: 'Audio activeren', exact: true })).toBeEnabled()
  } finally { await otherContext.close(); await first.close() }
})

test('controller disconnect leaves playback running; player connection loss stops it and requires activation', async ({ browser }) => {
  const pairSession = await session(browser)
  const { player, controller, controllerContext } = pairSession
  try {
    await activateAndUpload(player, controller, 'Verbindingstest')
    await controller.getByRole('button', { name: 'Afspelen', exact: true }).click()
    await expect.poll(async () => (await media(player)).currentTime).toBeGreaterThan(0.2)
    const before = (await media(player)).currentTime
    await controllerContext.close()
    await expect.poll(async () => (await media(player)).currentTime).toBeGreaterThan(before + 0.3)
    expect((await media(player)).paused).toBe(false)

    const observerContext = await browser.newContext({ baseURL })
    try {
      const observer = await observerContext.newPage()
      await pair(observer, pairSession.setup.pin)
      await player.evaluate(() => window.__e2eSockets.at(-1)!.close())
      await expect.poll(async () => (await media(player)).paused).toBe(true)
      await expect(observer.getByRole('button', { name: /^(Afspelen|Hervatten)$/ })).toBeDisabled()
      await expect(player.getByRole('button', { name: 'Audio activeren', exact: true })).toBeEnabled()
      expect((await media(player)).paused).toBe(true)
      await player.getByRole('button', { name: 'Audio activeren', exact: true }).click()
      await expect(player.getByText('Afspeler verbonden en audio geactiveerd', { exact: true })).toBeVisible()
      expect((await media(player)).paused).toBe(true)
    } finally { await observerContext.close() }
  } finally { await pairSession.close() }
})

test('rapid play-stop remains stopped and an invalid WAV displays a recoverable error', async ({ browser }) => {
  const pairSession = await session(browser)
  const { player, controller } = pairSession
  try {
    await activateAndUpload(player, controller, 'Snel stoppen')
    await expect.poll(async () => (await media(player)).duration).toBe(30)
    // Two real command messages in one task reproduce fast physical control input.
    await controller.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')]
      buttons.find(button => button.textContent?.trim() === 'Afspelen')!.click()
      buttons.find(button => button.textContent?.trim() === 'Stoppen')!.click()
    })
    await expect(controller.getByText('Gestopt', { exact: true })).toBeVisible()
    await controller.waitForTimeout(400)
    expect((await media(player)).paused).toBe(true)
    expect((await media(player)).currentTime).toBe(0)
    await player.getByLabel('Audiobestanden toevoegen').setInputFiles({ name: 'Beschadigd fragment.wav', mimeType: 'audio/wav', buffer: Buffer.from('not a valid audio file') })
    await controller.getByRole('button', { name: 'Beschadigd fragment klaarzetten', exact: true }).click()
    await expect(controller.getByRole('alert')).toContainText(/niet ondersteund|beschadigd|niet worden afgespeeld/)
    expect((await media(player)).paused).toBe(true)
    await controller.getByRole('button', { name: 'Snel stoppen klaarzetten', exact: true }).click()
    await expect(controller.getByRole('alert')).toHaveCount(0)
    await controller.getByRole('button', { name: 'Afspelen', exact: true }).click()
    await expect.poll(async () => (await media(player)).currentTime).toBeGreaterThan(0.2)
  } finally { await pairSession.close() }
})

test('player and controller fit tablet and phone widths with accessible controls', async ({ browser }, testInfo) => {
  const pairSession = await session(browser)
  const { player, controller } = pairSession
  try {
    await activateAndUpload(player, controller, 'Fragment met een langere duidelijke naam voor de zaal')
    for (const page of [player, controller]) {
      for (const width of [390, 768]) {
        await page.setViewportSize({ width, height: 1024 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await expect(page.getByRole('button', { name: 'Stoppen', exact: true })).toBeVisible()
        await screenshot(page, `${page === player ? 'player' : 'controller'}-${width}.png`, testInfo)
      }
    }
  } finally { await pairSession.close() }
})

test('a fragment ends naturally and clearing its selection allows deletion', async ({ browser }) => {
  const pairSession = await session(browser)
  const { player, controller } = pairSession
  try {
    await activateAndUpload(player, controller, 'Kort einde', quietWav(1))
    await expect.poll(async () => (await media(player)).duration).toBe(1)
    await expect(player.getByRole('button', { name: 'Kort einde verwijderen', exact: true })).toBeDisabled()
    await controller.getByRole('button', { name: 'Afspelen', exact: true }).click()
    await expect(controller.getByText('Afgelopen', { exact: true })).toBeVisible()
    expect((await media(player)).ended).toBe(true)
    await expect(controller.getByRole('button', { name: 'Kort einde klaarzetten', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await player.getByRole('button', { name: 'Selectie wissen', exact: true }).click()
    await expect(player.getByRole('heading', { name: 'Nog even stil.', exact: true })).toBeVisible()
    expect((await media(player)).sourceAttribute).toBe(null)
    expect((await media(player)).paused).toBe(true)
    await expect(player.getByText('Afspeler verbonden en audio geactiveerd', { exact: true })).toBeVisible()
    await player.getByRole('button', { name: 'Kort einde verwijderen', exact: true }).click()
    await player.getByRole('button', { name: 'Kort einde definitief verwijderen', exact: true }).click()
    await expect(controller.getByRole('button', { name: 'Kort einde klaarzetten', exact: true })).toHaveCount(0)
  } finally { await pairSession.close() }
})

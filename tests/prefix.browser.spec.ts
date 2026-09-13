import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAppServer } from '../server/app'
import type { Setup } from '../shared/protocol'

declare global {
  interface Window { __prefixAudio: HTMLAudioElement[] }
}

function audioFile(name: string) {
  const rate = 8000
  const buffer = Buffer.alloc(44 + rate * 30 * 2)
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
  for (let index = 0; index < rate * 30; index++) {
    buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / rate) * 16), 44 + index * 2)
  }
  return { name: `${name}.wav`, mimeType: 'audio/wav', buffer }
}

test('the complete player and controller flow stays below /play-audio', async ({ browser }) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'zaalgeluid-prefix-e2e-'))
  // Root production builds must never affect this independent prefix regression.
  const server = await createAppServer({ dataDir, port: 0, host: '127.0.0.1', dev: true, basePath: '/play-audio' })
  const { port } = await server.listen()
  const origin = `http://127.0.0.1:${port}`
  const playerContext = await browser.newContext()
  const controllerContext = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true })
  const requests: Array<{ role: string; pathname: string; type: string }> = []
  const sockets: Array<{ role: string; pathname: string }> = []
  function observe(page: Page, role: string) {
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin === origin && ['document', 'xhr', 'fetch', 'media'].includes(request.resourceType())) {
        requests.push({ role, pathname: url.pathname, type: request.resourceType() })
      }
    })
    // Keep only pathnames so failing assertions cannot expose pairing or player tokens.
    page.on('websocket', socket => sockets.push({ role, pathname: new URL(socket.url()).pathname }))
  }
  try {
    await playerContext.addInitScript(() => {
      window.__prefixAudio = []
      window.Audio = new Proxy(window.Audio, {
        construct(target, args) {
          const audio = Reflect.construct(target, args) as HTMLAudioElement
          window.__prefixAudio.push(audio)
          return audio
        },
      })
    })
    const player = await playerContext.newPage()
    const controller = await controllerContext.newPage()
    observe(player, 'player')
    observe(controller, 'controller')
    await player.goto(`${origin}/play-audio/`)
    await expect(player.getByRole('link', { name: /Afspeler openen/ })).toHaveAttribute('href', '/play-audio/player')
    const setupResponse = player.waitForResponse(response => new URL(response.url()).pathname === '/play-audio/api/setup')
    await player.getByRole('link', { name: /Afspeler openen/ }).click()
    await expect(player).toHaveURL(`${origin}/play-audio/player`)
    const setupResult = await setupResponse
    expect(setupResult.status()).toBe(200)
    const setup = await setupResult.json() as Setup
    await player.getByRole('button', { name: 'Audio activeren', exact: true }).click()
    await expect(player.getByText('Afspeler verbonden en audio geactiveerd', { exact: true })).toBeVisible()

    for (const [name, label] of [['Prefixlied', 'Audiobestanden toevoegen'], ['Prefixeffect', 'Geluidseffecten toevoegen']]) {
      const uploaded = player.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/play-audio/api/tracks')
      await player.getByLabel(label, { exact: true }).setInputFiles(audioFile(name))
      expect((await uploaded).status()).toBe(201)
    }
    await controller.goto(`${origin}/play-audio/control`)
    await controller.getByLabel('Koppelcode', { exact: true }).fill(setup.pin)
    const paired = controller.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/play-audio/api/pair')
    await controller.getByRole('button', { name: 'Verbind met de afspeler', exact: true }).click()
    expect((await paired).status()).toBe(200)
    await expect(controller.getByRole('heading', { name: 'Bediening', exact: true })).toBeVisible()
    await controller.getByRole('button', { name: 'Prefixlied aan afspeellijst toevoegen', exact: true }).tap()
    await expect(controller.getByRole('heading', { name: 'Prefixlied', exact: true })).toBeVisible()
    await controller.getByRole('button', { name: 'Afspelen', exact: true }).tap()
    await expect.poll(() => player.evaluate(() => window.__prefixAudio[0].currentTime)).toBeGreaterThan(0.1)
    await controller.getByRole('tab', { name: 'Geluidseffecten', exact: true }).tap()
    await controller.getByRole('button', { name: 'Prefixeffect effect afspelen', exact: true }).tap()
    await expect.poll(() => player.evaluate(() => window.__prefixAudio[1].currentTime)).toBeGreaterThan(0.1)
    const media = await player.evaluate(() => window.__prefixAudio.map(audio => ({ pathname: new URL(audio.currentSrc).pathname, paused: audio.paused })))
    expect(media).toHaveLength(2)
    for (const item of media) {
      expect(item.pathname).toMatch(/^\/play-audio\/api\/audio\//)
      expect(item.paused).toBe(false)
    }
    expect(requests.some(item => item.pathname === '/play-audio/api/setup')).toBe(true)
    expect(requests.some(item => item.pathname === '/play-audio/api/pair')).toBe(true)
    expect(requests.filter(item => item.type === 'media').length).toBeGreaterThanOrEqual(2)
    expect(requests.filter(item => !item.pathname.startsWith('/play-audio/'))).toEqual([])
    expect(sockets.filter(item => item.pathname === '/play-audio/ws').map(item => item.role).sort()).toEqual(['controller', 'player'])
    // Vite's development HMR socket lives at the base root rather than /ws.
    expect(sockets.filter(item => !['/play-audio/', '/play-audio/ws'].includes(item.pathname))).toEqual([])
  } finally {
    await controllerContext.close()
    await playerContext.close()
    await server.close()
    const resolved = path.resolve(dataDir)
    expect(path.dirname(resolved)).toBe(path.resolve(tmpdir()))
    expect(path.basename(resolved).startsWith('zaalgeluid-prefix-e2e-')).toBe(true)
    await rm(resolved, { recursive: true, force: true })
  }
})

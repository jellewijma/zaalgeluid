import { test, expect, type BrowserContext, type Page } from '@playwright/test'

declare global {
  interface Window {
    __resilienceAudio: HTMLAudioElement[]
    __resilienceSockets: WebSocket[]
  }
}

const baseURL = (process.env.CLOUD_TEST_BASE_URL || 'http://localhost:4173/play-audio/').replace(/\/?$/, '/')
const password = process.env.CLOUD_TEST_PASSWORD
const username = process.env.CLOUD_TEST_USERNAME || 'jelle'

function quietWav() {
  const rate = 8000
  const buffer = Buffer.alloc(44 + rate * 90 * 2)
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
  return buffer
}

async function observe(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__resilienceAudio = []
    window.__resilienceSockets = []
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement
        window.__resilienceAudio.push(audio)
        return audio
      },
    })
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket
        if (new URL(String(args[0])).hostname.endsWith('.convex.cloud')) window.__resilienceSockets.push(socket)
        return socket
      },
    })
  })
}

async function media(page: Page) {
  return page.evaluate(() => window.__resilienceAudio.slice(-2).map(audio => ({
    paused: audio.paused,
    time: audio.currentTime,
    buffered: audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0,
    duration: audio.duration,
  })))
}

async function offline(context: BrowserContext, page: Page) {
  await context.setOffline(true)
  // Close the actual transport as a real network drop would, while Chrome blocks reconnects.
  await page.evaluate(() => window.__resilienceSockets.forEach(socket => socket.close()))
}

async function login(page: Page) {
  await page.goto('player')
  await page.getByLabel('Gebruikersnaam', { exact: true }).fill(username)
  try { await page.getByLabel('Wachtwoord', { exact: true }).fill(password!) }
  catch { throw new Error('Het wachtwoordveld is niet bereikbaar.') }
  await page.getByRole('button', { name: 'Aanmelden', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Klaar voor jouw moment.' })).toBeVisible()
}

test('DEV: short outage buffers both channels, expired commands stay ignored, long outage stops and old player is fenced', async ({ browser }, info) => {
  test.skip(!password, 'Set CLOUD_TEST_PASSWORD for the provisioned development account.')
  test.skip(!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Network resilience testing is restricted to the development frontend.')
  const firstContext = await browser.newContext({ baseURL })
  const tabletContext = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 }, hasTouch: true })
  const nextContext = await browser.newContext({ baseURL })
  for (const context of [firstContext, tabletContext, nextContext]) await observe(context)
  const first = await firstContext.newPage()
  const tablet = await tabletContext.newPage()
  const next = await nextContext.newPage()
  const prefix = `cloud-resilience-${Date.now()}`
  const song = `${prefix}-music`
  const effect = `${prefix}-effect`
  try {
    await login(first)
    await expect(first.getByRole('button', { name: /^(Audio activeren|Afspeler overnemen)$/ })).toBeEnabled()
    const recover = first.getByRole('button', { name: 'Afspeler overnemen', exact: true })
    if (await recover.isVisible()) await recover.click()
    await expect(first.getByRole('button', { name: 'Audio activeren', exact: true })).toBeEnabled()
    await first.getByRole('button', { name: 'Audio activeren', exact: true }).click()
    await expect(first.getByText('Afspeler verbonden en audio geactiveerd', { exact: true })).toBeVisible()
    await first.getByLabel('Audiobestanden toevoegen', { exact: true }).setInputFiles({ name: `${song}.wav`, mimeType: 'audio/wav', buffer: quietWav() })
    await expect(first.getByRole('button', { name: `${song} klaarzetten`, exact: true })).toBeVisible()
    await first.getByLabel('Geluidseffecten toevoegen', { exact: true }).setInputFiles({ name: `${effect}.wav`, mimeType: 'audio/wav', buffer: quietWav() })
    await expect(first.getByRole('button', { name: `${effect} afspelen`, exact: true })).toBeVisible()
    const pin = (await first.locator('.pairing-code').getAttribute('aria-label'))!.replace(/\D/g, '')
    await tablet.goto('control')
    await tablet.getByLabel('Koppelcode', { exact: true }).fill(pin)
    await tablet.getByRole('button', { name: 'Verbind met de afspeler', exact: true }).click()
    await expect(tablet.getByRole('heading', { name: 'Bediening', exact: true })).toBeVisible()
    await first.getByRole('button', { name: `${song} klaarzetten`, exact: true }).click()
    await expect(tablet.getByRole('button', { name: 'Afspelen', exact: true })).toBeEnabled()
    await tablet.getByRole('button', { name: 'Afspelen', exact: true }).tap()
    await first.getByRole('button', { name: `${effect} afspelen`, exact: true }).click()
    await expect.poll(async () => (await media(first)).map(audio => audio.paused)).toEqual([false, false])
    await expect.poll(async () => (await media(first)).every(audio => audio.buffered >= 89)).toBe(true)
    const before = (await media(first)).map(audio => audio.time)
    await offline(firstContext, first)
    await expect(first.getByText('Verbinding onderbroken', { exact: true })).toBeVisible()
    // The online tablet can enqueue a command while the player lease is still valid.
    // Hold the player offline beyond the five-second command TTL before reconnecting.
    await tablet.getByRole('button', { name: 'Stoppen', exact: true }).tap()
    await first.waitForTimeout(6500)
    const during = await media(first)
    expect(during.map(audio => audio.paused)).toEqual([false, false])
    expect(during[0].time - before[0]).toBeGreaterThan(6)
    expect(during[1].time - before[1]).toBeGreaterThan(6)
    await firstContext.setOffline(false)
    await expect(first.getByText('Afspeler verbonden en audio geactiveerd', { exact: true })).toBeVisible()
    await expect.poll(async () => (await media(first))[0]?.time).toBeGreaterThan(during[0].time + 1)
    expect((await media(first)).map(audio => audio.paused)).toEqual([false, false])
    const reconnected = info.outputPath('cloud-reconnected-no-stale-stop.png')
    await first.screenshot({ path: reconnected, fullPage: true })
    await info.attach('Reconnected without replaying an expired stop', { path: reconnected, contentType: 'image/png' })
    const offlineStart = Date.now()
    await offline(firstContext, first)
    await expect.poll(async () => (await media(first)).every(audio => audio.paused), { timeout: 46_000, intervals: [1000] }).toBe(true)
    expect(Date.now() - offlineStart).toBeLessThan(45_500)
    // The browser intentionally stops before lease expiry; let the server's lease expire too.
    await first.waitForTimeout(Math.max(0, 46_000 - (Date.now() - offlineStart)))
    await login(next)
    await expect(next.getByRole('button', { name: 'Audio activeren', exact: true })).toBeEnabled()
    await next.getByRole('button', { name: 'Audio activeren', exact: true }).click()
    await expect(next.getByRole('button', { name: /^(Afspelen|Hervatten)$/, exact: true })).toBeEnabled()
    await next.getByRole('button', { name: /^(Afspelen|Hervatten)$/, exact: true }).click()
    await expect.poll(async () => (await media(next))[0]?.paused).toBe(false)
    await firstContext.setOffline(false)
    await expect(first.getByRole('button', { name: 'Afspeler overnemen', exact: true })).toBeVisible()
    expect((await media(first)).every(audio => audio.paused)).toBe(true)
    expect((await media(next))[0]?.paused).toBe(false)
    await next.getByRole('button', { name: 'Stoppen', exact: true }).click()
    await expect.poll(async () => (await media(next)).every(audio => audio.paused)).toBe(true)
    await next.getByRole('button', { name: 'Selectie wissen', exact: true }).click()
    for (const name of [song, effect]) {
      await expect(next.getByRole('button', { name: `${name} verwijderen`, exact: true })).toBeEnabled()
      await next.getByRole('button', { name: `${name} verwijderen`, exact: true }).click()
      await next.getByRole('button', { name: `${name} definitief verwijderen`, exact: true }).click()
      await expect(next.getByRole('button', { name: `${name} verwijderen`, exact: true })).toHaveCount(0)
    }
    await next.getByRole('button', { name: 'Alle tablets ontkoppelen', exact: true }).click()
    await expect(tablet.getByLabel('Koppelcode', { exact: true })).toBeVisible()
    await next.getByRole('button', { name: 'Afmelden', exact: true }).click()
    await expect(next.getByRole('heading', { name: 'Meld je aan op de pc.' })).toBeVisible()
  } finally {
    await firstContext.setOffline(false)
    for (const context of [tabletContext, nextContext, firstContext]) await context.close()
  }
})

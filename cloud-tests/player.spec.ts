import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'

declare global {
  interface Window { __cloudTestAudio: HTMLAudioElement[] }
}

const baseURL = (process.env.CLOUD_TEST_BASE_URL || 'http://localhost:4173/play-audio/').replace(/\/?$/, '/')
const password = process.env.CLOUD_TEST_PASSWORD
const username = process.env.CLOUD_TEST_USERNAME || 'jelle'

function audioFixture(seconds: number) {
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
  for (let index = 0; index < seconds * rate; index++) {
    buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / rate) * 16), 44 + index * 2)
  }
  return buffer
}

async function observeAudio(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__cloudTestAudio = []
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement
        window.__cloudTestAudio.push(audio)
        return audio
      },
    })
  })
}

async function media(page: Page) {
  return page.evaluate(() => window.__cloudTestAudio.slice(-2).map(audio => ({
    paused: audio.paused, time: audio.currentTime, duration: audio.duration, ready: audio.readyState,
  })))
}

async function login(page: Page) {
  await page.goto('player')
  await expect(page.getByRole('heading', { name: 'Meld je aan op de pc.' })).toBeVisible()
  await expect(page.locator('.password-login')).toBeVisible()
  if (!await page.getByLabel('Gebruikersnaam', { exact: true }).isVisible()) await page.getByText('Aanmelden met wachtwoord', { exact: true }).click()
  await page.getByLabel('Gebruikersnaam', { exact: true }).fill(username)
  // Avoid including the sensitive fill argument in an assertion failure.
  try { await page.getByLabel('Wachtwoord', { exact: true }).fill(password!) }
  catch { throw new Error('Het wachtwoordveld is niet bereikbaar.') }
  await page.getByLabel('Wachtwoord', { exact: true }).press('Tab')
  await expect(page.getByRole('button', { name: 'Aanmelden', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Klaar voor jouw moment.' })).toBeVisible()
}

async function screenshot(page: Page, name: string, info: TestInfo) {
  const file = info.outputPath(name)
  await page.screenshot({ path: file, fullPage: true })
  await info.attach(name, { path: file, contentType: 'image/png' })
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('online login, stored audio, tablet queue/effects and explicit second-PC takeover', async ({ browser }, info) => {
  test.skip(!password, 'Set CLOUD_TEST_PASSWORD to test against the provisioned development backend.')
  const firstContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
  const tabletContext = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 }, hasTouch: true })
  const secondContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
  const pageErrors: string[] = []
  for (const context of [firstContext, tabletContext, secondContext]) {
    await observeAudio(context)
    context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message.replace(/[a-f0-9]{64}/g, '[redacted]').replace(/eyJ[\w.-]+/g, '[redacted]'))))
  }
  const first = await firstContext.newPage()
  const tablet = await tabletContext.newPage()
  const second = await secondContext.newPage()
  const prefix = `cloud-e2e-${Date.now()}`
  const songs = [`${prefix}-one`, `${prefix}-two`]
  const effect = `${prefix}-effect`
  try {
    await tablet.goto('player')
    await expect(tablet.getByRole('heading', { name: 'Meld je aan op de pc.' })).toBeVisible()
    await expect(tablet.getByRole('button', { name: 'Liedjes toevoegen' })).toHaveCount(0)
    await login(first)
    // Recover only this development test session if an earlier interrupted run left a lease.
    await expect(first.getByRole('button', { name: /^(Audio activeren|Afspeler overnemen)$/ })).toBeEnabled()
    const recover = first.getByRole('button', { name: 'Afspeler overnemen', exact: true })
    if (await recover.isVisible()) await recover.click()
    await expect(first.getByRole('button', { name: 'Audio activeren', exact: true })).toBeEnabled()
    await expect(first.getByLabel('Adres voor de tablet', { exact: true })).toHaveValue(/\?room=.+/)
    const controllerURL = new URL(await first.getByLabel('Adres voor de tablet', { exact: true }).inputValue())
    expect(controllerURL.origin).toBe(new URL(baseURL).origin)
    expect(controllerURL.pathname).toBe(new URL('control', baseURL).pathname)
    expect(controllerURL.searchParams.get('room')).toBeTruthy()
    await first.getByRole('button', { name: 'Audio activeren', exact: true }).click()
    await expect(first.getByText('Afspeler verbonden en audio geactiveerd', { exact: true })).toBeVisible()
    await first.getByLabel('Audiobestanden toevoegen', { exact: true }).setInputFiles(songs.map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: audioFixture(30) })))
    for (const song of songs) await expect(first.getByRole('button', { name: `${song} klaarzetten`, exact: true })).toBeVisible()
    await first.getByLabel('Geluidseffecten toevoegen', { exact: true }).setInputFiles({ name: `${effect}.wav`, mimeType: 'audio/wav', buffer: audioFixture(10) })
    await expect(first.getByRole('button', { name: `${effect} afspelen`, exact: true })).toBeVisible()
    const initialPin = (await first.locator('.pairing-code').getAttribute('aria-label'))!.replace(/\D/g, '')
    await first.getByRole('button', { name: 'Vernieuw code', exact: true }).click()
    await expect(first.locator('.pairing-code')).not.toHaveAttribute('aria-label', `Koppelcode ${initialPin}`)
    const pin = (await first.locator('.pairing-code').getAttribute('aria-label'))!.replace(/\D/g, '')
    await tablet.goto(controllerURL.href)
    await tablet.getByLabel('Koppelcode', { exact: true }).fill(initialPin)
    await tablet.getByRole('button', { name: 'Verbind met de afspeler', exact: true }).click()
    await expect(tablet.getByRole('alert')).toContainText('onjuist of verlopen')
    await tablet.getByLabel('Koppelcode', { exact: true }).fill(pin)
    await tablet.getByLabel('Koppelcode', { exact: true }).press('Tab')
    await expect(tablet.getByRole('button', { name: 'Verbind met de afspeler', exact: true })).toBeFocused()
    await tablet.keyboard.press('Enter')
    await expect(tablet.getByRole('heading', { name: 'Bediening', exact: true })).toBeVisible()
    for (const song of songs) await first.getByRole('button', { name: `${song} aan afspeellijst toevoegen`, exact: true }).click()
    await expect(first.getByRole('button', { name: 'Afspeellijst (2)', exact: true })).toBeVisible()
    await expect(tablet.getByRole('button', { name: 'Afspelen', exact: true })).toBeEnabled()
    await tablet.getByRole('button', { name: 'Afspelen', exact: true }).tap()
    await expect.poll(async () => (await media(first))[0]?.paused).toBe(false)
    await expect.poll(async () => (await media(first))[0]?.time).toBeGreaterThan(0.1)
    await tablet.getByRole('tab', { name: 'Geluidseffecten', exact: true }).tap()
    await tablet.getByRole('button', { name: `${effect} effect afspelen`, exact: true }).tap()
    await expect.poll(async () => (await media(first)).map(audio => audio.paused)).toEqual([false, false])
    await expect.poll(async () => (await media(first))[1]?.time).toBeGreaterThan(0.1)
    await screenshot(first, 'cloud-player-music-and-effect.png', info)
    await screenshot(tablet, 'cloud-tablet-music-and-effect.png', info)
    await assertNoHorizontalOverflow(first)
    await assertNoHorizontalOverflow(tablet)
    await tablet.getByRole('button', { name: 'Effect stoppen', exact: true }).tap()
    await expect.poll(async () => (await media(first)).map(audio => audio.paused)).toEqual([false, true])
    // Seek near the real decoded track end and verify automatic queue advancement.
    const seek = tablet.getByRole('slider', { name: 'Afspeelpositie', exact: true })
    await seek.focus()
    await tablet.keyboard.press('End')
    await expect(first.getByRole('heading', { name: songs[1], exact: true })).toBeVisible()
    await expect.poll(async () => (await media(first))[0]?.paused).toBe(false)
    const volume = tablet.getByRole('slider', { name: 'Muziekvolume', exact: true })
    await volume.focus()
    await tablet.keyboard.press('Home')
    await tablet.keyboard.press('ArrowRight')
    await expect(first.getByRole('slider', { name: 'Muziekvolume', exact: true })).toHaveAttribute('aria-valuenow', '1')
    await login(second)
    await expect(second.getByRole('button', { name: 'Afspeler overnemen', exact: true })).toBeEnabled()
    await expect(second.getByRole('button', { name: 'Audio activeren', exact: true })).toHaveCount(0)
    expect((await media(first))[0]?.paused).toBe(false)
    await second.getByRole('button', { name: 'Afspeler overnemen', exact: true }).click()
    await expect(first.getByText('Een andere pc heeft de afspeler overgenomen.', { exact: true })).toBeVisible()
    await expect.poll(async () => (await media(first)).every(audio => audio.paused)).toBe(true)
    await expect(second.getByRole('button', { name: 'Audio activeren', exact: true })).toBeEnabled()
    await expect(second.getByRole('button', { name: 'Afspeellijst (2)', exact: true })).toBeVisible()
    await expect(second.getByRole('slider', { name: 'Muziekvolume', exact: true })).toHaveAttribute('aria-valuenow', '1')
    await second.getByRole('button', { name: 'Audio activeren', exact: true }).click()
    await expect(tablet.getByRole('button', { name: /^(Afspelen|Hervatten)$/, exact: true })).toBeEnabled()
    await tablet.getByRole('button', { name: /^(Afspelen|Hervatten)$/, exact: true }).tap()
    await expect.poll(async () => (await media(second))[0]?.paused).toBe(false)
    await expect.poll(async () => (await media(tablet)).length).toBe(0)
    await second.getByRole('button', { name: 'Alle tablets ontkoppelen', exact: true }).click()
    await expect(tablet.getByLabel('Koppelcode', { exact: true })).toBeVisible()
    await screenshot(second, 'cloud-player-after-takeover.png', info)
    await second.getByRole('button', { name: 'Stoppen', exact: true }).click()
    await expect.poll(async () => (await media(second)).every(audio => audio.paused)).toBe(true)
    await second.getByRole('button', { name: 'Afspeellijst (2)', exact: true }).click()
    await second.getByRole('button', { name: 'Lijst leegmaken', exact: true }).click()
    await expect(second.getByRole('button', { name: 'Afspeellijst (0)', exact: true })).toBeVisible()
    await second.getByRole('button', { name: 'Selectie wissen', exact: true }).click()
    await second.getByRole('button', { name: 'Alle liedjes', exact: true }).click()
    for (const name of [...songs, effect]) {
      await expect(second.getByRole('button', { name: `${name} verwijderen`, exact: true })).toBeEnabled()
      await second.getByRole('button', { name: `${name} verwijderen`, exact: true }).click()
      await second.getByRole('button', { name: `${name} definitief verwijderen`, exact: true }).click()
      await expect(second.getByRole('button', { name: `${name} verwijderen`, exact: true })).toHaveCount(0)
    }
    await second.getByRole('button', { name: 'Afmelden', exact: true }).click()
    await expect(second.getByRole('heading', { name: 'Meld je aan op de pc.' })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    for (const context of [tabletContext, secondContext, firstContext]) await context.close()
  }
})

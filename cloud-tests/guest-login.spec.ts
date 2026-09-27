import { test, expect, type BrowserContext, type Page } from '@playwright/test'

declare global {
  interface Window { __guestTestAudio: HTMLAudioElement[] }
}

const baseURL = (process.env.CLOUD_TEST_BASE_URL || 'http://localhost:4173/play-audio/').replace(/\/?$/, '/')

function quietWav(seconds: number) {
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
  return buffer
}

async function observeAudio(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__guestTestAudio = []
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement
        window.__guestTestAudio.push(audio)
        return audio
      },
    })
  })
}

async function media(page: Page) {
  return page.evaluate(() => window.__guestTestAudio.slice(-2).map(audio => ({
    paused: audio.paused, time: audio.currentTime,
  })))
}

async function guestLogin(page: Page) {
  await page.goto('player')
  await expect(page.getByRole('heading', { name: 'Aanmelden', exact: true })).toBeVisible()
  const guest = page.getByRole('button', { name: 'Doorgaan als gast', exact: true })
  await expect(guest).toBeEnabled()
  await guest.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Afspeler', exact: true })).toBeVisible()
  await expect(page.getByText('Aangemeld als gast', { exact: true })).toBeVisible()
  await expect(page.getByText('Wachtwoord wijzigen', { exact: true })).toHaveCount(0)
  return controllerURL(page)
}

async function controllerURL(page: Page) {
  const address = page.getByLabel('Adres voor de tablet', { exact: true })
  await expect(address).toHaveValue(/\?room=.+/)
  const url = new URL(await address.inputValue())
  expect(url.origin).toBe(new URL(baseURL).origin)
  expect(url.pathname).toBe(new URL('control', baseURL).pathname)
  expect(url.searchParams.get('room')).toBeTruthy()
  return url
}

async function expectEmptyLibrary(page: Page) {
  await expect(page.getByRole('heading', { name: 'Geen liedjes', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Geen geluidseffecten', exact: true })).toBeVisible()
  await expect(page.locator('.track-row')).toHaveCount(0)
}

// Every context owns a fresh guest. Delete only the exact fixture names created
// by this test, and do so before signing out and losing its private session.
async function removeFixtures(page: Page, names: string[]) {
  if (page.isClosed() || !await page.getByText('Aangemeld als gast', { exact: true }).isVisible()) return
  const dialog = page.getByRole('alertdialog')
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Annuleren', exact: true }).click()
  for (const label of ['Effect stoppen', 'Stoppen', 'Selectie wissen']) {
    const button = page.getByRole('button', { name: label, exact: true })
    if (await button.isVisible() && await button.isEnabled()) await button.click()
  }
  const allSongs = page.getByRole('button', { name: 'Alle liedjes', exact: true })
  if (await allSongs.isVisible()) await allSongs.click()
  for (const name of names) {
    const confirm = page.getByRole('button', { name: `${name} definitief verwijderen`, exact: true })
    const remove = page.getByRole('button', { name: `${name} verwijderen`, exact: true })
    if (await remove.isVisible()) {
      await expect(remove).toBeEnabled()
      await remove.click()
    }
    if (await confirm.isVisible()) {
      await confirm.click()
      await expect(confirm).toHaveCount(0)
      await expect(remove).toHaveCount(0)
    }
  }
}

test('guests have private persistent audio and tablet control, and confirm losing access on sign-out', async ({ browser }, info) => {
  const playerContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
  const otherContext = await browser.newContext({ baseURL })
  const tabletContext = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 }, hasTouch: true })
  const contexts = [playerContext, otherContext, tabletContext]
  let pageErrorCount = 0
  for (const context of contexts) {
    await observeAudio(context)
    context.on('page', page => page.on('pageerror', () => { pageErrorCount++ }))
  }
  const player = await playerContext.newPage()
  const other = await otherContext.newPage()
  const tablet = await tabletContext.newPage()
  const prefix = `guest-e2e-${Date.now()}`
  const song = `${prefix}-music`
  const effect = `${prefix}-effect`
  const otherSong = `${prefix}-other`
  try {
    const firstRoom = await guestLogin(player)
    await expectEmptyLibrary(player)
    await player.getByLabel('Audiobestanden toevoegen', { exact: true }).setInputFiles({ name: `${song}.wav`, mimeType: 'audio/wav', buffer: quietWav(30) })
    await expect(player.getByRole('button', { name: `${song} klaarzetten`, exact: true })).toBeVisible()
    await player.getByLabel('Geluidseffecten toevoegen', { exact: true }).setInputFiles({ name: `${effect}.wav`, mimeType: 'audio/wav', buffer: quietWav(15) })
    await expect(player.getByRole('button', { name: `${effect} afspelen`, exact: true })).toBeVisible()

    await player.reload()
    await expect(player.getByText('Aangemeld als gast', { exact: true })).toBeVisible()
    expect((await controllerURL(player)).href).toBe(firstRoom.href)
    await expect(player.getByRole('button', { name: `${song} klaarzetten`, exact: true })).toBeVisible()
    await expect(player.getByRole('button', { name: `${effect} afspelen`, exact: true })).toBeVisible()

    const otherRoom = await guestLogin(other)
    expect(otherRoom.searchParams.get('room')).not.toBe(firstRoom.searchParams.get('room'))
    await expectEmptyLibrary(other)
    await other.getByLabel('Audiobestanden toevoegen', { exact: true }).setInputFiles({ name: `${otherSong}.wav`, mimeType: 'audio/wav', buffer: quietWav(1) })
    await expect(other.getByRole('button', { name: `${otherSong} klaarzetten`, exact: true })).toBeVisible()
    await expect(player.getByRole('button', { name: `${otherSong} klaarzetten`, exact: true })).toHaveCount(0)
    await expect(other.getByRole('button', { name: `${song} klaarzetten`, exact: true })).toHaveCount(0)
    await expect(other.getByRole('button', { name: `${effect} afspelen`, exact: true })).toHaveCount(0)

    // A full reload can leave the previous page's short player lease alive.
    // Take over only this fresh guest's own previous lease when requested.
    await expect(player.getByRole('button', { name: /^(Audio activeren|Afspeler overnemen)$/ })).toBeEnabled()
    const takeOver = player.getByRole('button', { name: 'Afspeler overnemen', exact: true })
    if (await takeOver.isVisible()) await takeOver.click()
    await player.getByRole('button', { name: 'Audio activeren', exact: true }).click()
    await expect(player.getByRole('slider', { name: 'Muziekvolume', exact: true })).toBeEnabled()
    const pin = (await player.locator('.pairing-code').getAttribute('aria-label'))!.replace(/\D/g, '')
    await tablet.goto(firstRoom.href)
    await tablet.getByLabel('Koppelcode', { exact: true }).fill(pin)
    await tablet.getByRole('button', { name: 'Verbind met de afspeler', exact: true }).tap()
    await expect(tablet.getByRole('heading', { name: 'Bediening', exact: true })).toBeVisible()
    await player.getByRole('button', { name: `${song} klaarzetten`, exact: true }).click()
    await tablet.getByRole('button', { name: 'Afspelen', exact: true }).tap()
    await expect.poll(async () => (await media(player))[0]?.time).toBeGreaterThan(0.1)
    await tablet.getByRole('tab', { name: 'Geluidseffecten', exact: true }).tap()
    await tablet.getByRole('button', { name: `${effect} effect afspelen`, exact: true }).tap()
    await expect.poll(async () => (await media(player)).map(audio => audio.paused)).toEqual([false, false])
    await expect.poll(async () => (await media(player))[1]?.time).toBeGreaterThan(0.1)
    const volume = tablet.getByRole('slider', { name: 'Muziekvolume', exact: true })
    await volume.focus()
    await tablet.keyboard.press('Home')
    await tablet.keyboard.press('ArrowRight')
    await expect(player.getByRole('slider', { name: 'Muziekvolume', exact: true })).toHaveAttribute('aria-valuenow', '1')
    expect((await media(tablet)).length).toBe(0)
    expect((await media(other)).every(audio => audio.paused)).toBe(true)
    await tablet.getByRole('button', { name: 'Effect stoppen', exact: true }).tap()
    await tablet.getByRole('button', { name: 'Stoppen', exact: true }).tap()
    await expect.poll(async () => (await media(player)).every(audio => audio.paused)).toBe(true)

    await player.setViewportSize({ width: 390, height: 844 })
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const screenshot = info.outputPath('guest-player-mobile.png')
    await player.screenshot({ path: screenshot, fullPage: true })
    await info.attach('Guest player on mobile', { path: screenshot, contentType: 'image/png' })
    await player.getByRole('button', { name: 'Afmelden', exact: true }).click()
    const dialog = player.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Annuleren', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Annuleren', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(player.getByText('Aangemeld als gast', { exact: true })).toBeVisible()
    expect((await controllerURL(player)).href).toBe(firstRoom.href)
    await expect(player.getByRole('button', { name: `${song} klaarzetten`, exact: true })).toBeVisible()

    await player.getByRole('button', { name: 'Selectie wissen', exact: true }).click()
    // Deletion validates the server state. The tablet confirms that the
    // player's cleared selection has reached it, beyond local audio state.
    await expect(tablet.getByRole('heading', { name: 'Kies een liedje', exact: true })).toBeVisible()
    await removeFixtures(player, [song, effect])
    await removeFixtures(other, [otherSong])
    await expectEmptyLibrary(player)
    await expectEmptyLibrary(other)
    await player.getByRole('button', { name: 'Afmelden', exact: true }).click()
    await player.getByRole('alertdialog').getByRole('button', { name: 'Afmelden als gast', exact: true }).click()
    await expect(player.getByRole('heading', { name: 'Aanmelden', exact: true })).toBeVisible()
    const replacementRoom = await guestLogin(player)
    expect(replacementRoom.searchParams.get('room')).not.toBe(firstRoom.searchParams.get('room'))
    await expectEmptyLibrary(player)
    expect(pageErrorCount).toBe(0)
  } finally {
    for (const [page, names] of [[player, [song, effect]], [other, [otherSong]]] as const) {
      try { await removeFixtures(page, [...names]) }
      catch { info.annotations.push({ type: 'cleanup', description: 'Test fixtures could not all be removed through the guest UI.' }) }
    }
    for (const context of contexts) await context.close()
  }
})

import { test, expect, type BrowserContext } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAppServer } from '../server/app'
import { normalizeBasePath, withBasePath } from '../shared/paths'

// Run against a production build with the same APP_BASE_PATH. The service worker
// deliberately does not register during development.
const basePath = normalizeBasePath(process.env.PWA_BASE_PATH)
const at = (route: string) => withBasePath(basePath, route)
const launchKey = at('zaalgeluid-launch')
let server: Awaited<ReturnType<typeof createAppServer>> | undefined
let dataDir: string | undefined
let origin: string

test.beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'zaalgeluid-pwa-e2e-'))
  server = await createAppServer({ dataDir, port: 0, host: '127.0.0.1', basePath })
  const { port } = await server.listen()
  origin = `http://127.0.0.1:${port}`
})

test.afterAll(async () => {
  await server?.close()
  if (!dataDir) return
  const resolved = path.resolve(dataDir)
  expect(path.dirname(resolved)).toBe(path.resolve(tmpdir()))
  expect(path.basename(resolved).startsWith('zaalgeluid-pwa-e2e-')).toBe(true)
  await rm(resolved, { recursive: true, force: true })
})

test('Chrome accepts the manifest, install icons and scoped production worker', async ({ playwright }, testInfo) => {
  // Regular Playwright contexts are incognito, where Chrome intentionally
  // prohibits installation. An isolated persistent profile tests real eligibility.
  const profileDir = await mkdtemp(path.join(tmpdir(), 'zaalgeluid-pwa-profile-'))
  let context: BrowserContext | undefined
  try {
    context = await playwright.chromium.launchPersistentContext(profileDir, {
      ...testInfo.project.use.launchOptions,
      channel: testInfo.project.use.channel,
      headless: true,
      viewport: { width: 1280, height: 900 },
    })
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(origin + at('/'))
    const cdp = await context.newCDPSession(page)
    await cdp.send('Page.enable')
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', at('/manifest.webmanifest'))
    const manifestResult = await cdp.send('Page.getAppManifest')
    expect(manifestResult.url).toBe(origin + at('/manifest.webmanifest'))
    expect(manifestResult.errors).toEqual([])
    const manifest = JSON.parse(manifestResult.data!) as {
      name: string
      display: string
      id: string
      start_url: string
      scope: string
      icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>
    }
    expect(manifest.name).toBe('Zaalgeluid')
    expect(manifest.display).toBe('standalone')
    expect(new URL(manifest.id, manifestResult.url).href).toBe(origin + at('/'))
    expect(new URL(manifest.scope, manifestResult.url).href).toBe(origin + at('/'))
    expect(new URL(manifest.start_url, manifestResult.url).href).toBe(origin + at('/launch?launch=app'))
    for (const size of [192, 512]) {
      const icon = manifest.icons.find(item => item.sizes === `${size}x${size}` && (!item.purpose || item.purpose.split(' ').includes('any')))
      expect(icon).toBeDefined()
      expect(icon!.type).toBe('image/png')
      const iconUrl = new URL(icon!.src, manifestResult.url).href
      expect(new URL(iconUrl).pathname).toBe(at(`/icons/icon-${size}.png`))
      const dimensions = await page.evaluate(async (url) => {
        const image = new Image()
        image.src = url
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, iconUrl)
      expect(dimensions).toEqual({ width: size, height: size })
    }
    expect(manifest.icons.some(icon => icon.purpose?.split(' ').includes('maskable'))).toBe(true)
    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
    expect(appleIcon).toBeTruthy()
    expect(new URL(appleIcon!, page.url()).pathname.startsWith(at('/icons/'))).toBe(true)
    const registration = await page.evaluate(async () => {
      const worker = await navigator.serviceWorker.ready
      return { scope: worker.scope, scriptURL: worker.active?.scriptURL }
    })
    expect(registration).toEqual({ scope: origin + at('/'), scriptURL: origin + at('/sw.js') })
    await expect.poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([])
    await cdp.detach()
  } finally {
    try {
      await context?.close()
    } finally {
      const resolved = path.resolve(profileDir)
      expect(path.dirname(resolved)).toBe(path.resolve(tmpdir()))
      expect(path.basename(resolved).startsWith('zaalgeluid-pwa-profile-')).toBe(true)
      await rm(resolved, { recursive: true, force: true })
    }
  }
})

test('installed launches restore only the chosen role and room while Home and direct links remain usable', async ({ page, context }) => {
  await context.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      const result = matchMedia(query)
      if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true })
      return result
    }
  })
  const control = at('/control') + '?room=pwa-test-room'
  await page.goto(origin + control + '&token=discard-this&code=discard-this')
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), launchKey)).toBe(control)
  await page.goto(origin + at('/launch?launch=app'))
  await expect(page).toHaveURL(origin + control)
  await expect(page.getByRole('heading', { name: 'Tablet koppelen', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Zaalgeluid startpagina', exact: true }).click()
  await expect(page).toHaveURL(origin + at('/launch'))
  await expect(page.getByRole('heading', { name: 'Afspeler en bediening', exact: true })).toBeVisible()

  await page.goto(origin + at('/player?code=discard-this'))
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), launchKey)).toBe(at('/player'))
  await page.goto(origin + at('/launch?launch=app'))
  await expect(page).toHaveURL(origin + at('/player'))
  await expect(page.getByRole('button', { name: 'Audio activeren', exact: true })).toBeVisible()
})

test('browser launches stay on Home and invalid saved locations cannot redirect an installed launch', async ({ page, context }) => {
  await page.goto(origin + at('/control?room=pwa-test-room'))
  await page.goto(origin + at('/launch?launch=app'))
  await expect(page).toHaveURL(origin + at('/launch?launch=app'))
  await expect(page.getByRole('heading', { name: 'Afspeler en bediening', exact: true })).toBeVisible()

  await context.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      const result = matchMedia(query)
      if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true })
      return result
    }
  })
  for (const destination of ['https://example.com/control', '//example.com/control', at('/privacy'), '/outside-app/control']) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: launchKey, value: destination })
    await page.goto(origin + at('/launch?launch=app'))
    await expect(page).toHaveURL(origin + at('/launch?launch=app'))
    await expect(page.getByRole('heading', { name: 'Afspeler en bediening', exact: true })).toBeVisible()
  }
})

test('offline navigation shows connection guidance without caching app or audio data', async ({ page, context }) => {
  await page.goto(origin + at('/'))
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  try {
    await page.goto(origin + at('/control'))
    await expect(page.getByRole('heading', { name: 'Geen verbinding', exact: true })).toBeVisible()
    expect(await page.evaluate(() => caches.keys())).toEqual([])
  } finally {
    await context.setOffline(false)
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tablet koppelen', exact: true })).toBeVisible()
})

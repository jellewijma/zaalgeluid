import { test, expect } from '@playwright/test'

test('login exposes only configured methods and keeps the password fallback keyboard accessible', async ({ page }, info) => {
  await page.goto('player')
  await expect(page.getByRole('heading', { name: 'Meld je aan op de pc.' })).toBeVisible()
  await expect(page.getByText('Aanmeldopties laden…', { exact: true })).toHaveCount(0)
  const google = page.getByRole('button', { name: 'Doorgaan met Google', exact: true })
  if (await google.isVisible()) {
    await expect(google).toBeEnabled()
    await expect.poll(() => google.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(page.getByLabel('Gebruikersnaam', { exact: true })).toBeHidden()
    await page.getByRole('link', { name: 'Terug', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(google).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.locator('.password-login summary')).toBeFocused()
    await page.keyboard.press('Enter')
  } else {
    await expect(page.getByText('Google-aanmelding wordt nog ingesteld.', { exact: true })).toBeVisible()
  }
  await expect(page.getByLabel('Gebruikersnaam', { exact: true })).toBeVisible()
  await page.getByLabel('Wachtwoord', { exact: true }).fill('incorrect-test-password')
  await page.getByRole('button', { name: 'Aanmelden', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Controleer je gebruikersnaam en wachtwoord')
  await expect(page.getByRole('button', { name: 'Aanmelden', exact: true })).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('google-login-mobile.png'), fullPage: true })
})

test('cancelled Google sign-in shows a safe message and can be retried', async ({ page }) => {
  await page.goto('player?error=access_denied&error_description=%3Cscript%3Euntrusted-provider-message%3C%2Fscript%3E')
  await expect(page.getByRole('alert')).toHaveText('De Google-aanmelding is geannuleerd. Je kunt het opnieuw proberen.')
  await expect(page.getByText('untrusted-provider-message', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Aanmeldopties laden…', { exact: true })).toHaveCount(0)
  const google = page.getByRole('button', { name: 'Doorgaan met Google', exact: true })
  test.skip(!await google.isVisible(), 'Google OAuth is not configured on this backend yet.')
  // Verify the real OAuth initiation without entering an account or granting consent.
  await page.route('https://accounts.google.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Google OAuth reached</title><p>Google OAuth reached</p>',
  }))
  await google.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(url => url.hostname === 'accounts.google.com')
  await expect(page.getByText('Google OAuth reached', { exact: true })).toBeVisible()
})

test('a new room pairing link does not reuse another room or legacy controller token', async ({ page }) => {
  await page.goto('control?room=room-new')
  const storagePrefix = await page.evaluate(() => location.pathname.replace(/\/control$/, '/zaalgeluid-cloud-controller'))
  await page.evaluate(prefix => {
    sessionStorage.setItem(prefix, 'legacy-controller-session')
    sessionStorage.setItem(`${prefix}:room-other`, 'other-controller-session')
  }, storagePrefix)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Neem de bediening over.' })).toBeVisible()
  await expect(page.getByLabel('Koppelcode', { exact: true })).toBeFocused()
  expect(await page.evaluate(prefix => ({
    legacy: sessionStorage.getItem(prefix),
    other: sessionStorage.getItem(`${prefix}:room-other`),
    current: sessionStorage.getItem(`${prefix}:room-new`),
  }), storagePrefix)).toEqual({ legacy: 'legacy-controller-session', other: 'other-controller-session', current: null })
})

test('an invalid OAuth callback code shows recovery instead of hanging on authentication', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('player?code=invalid-oauth-test-code')
  await expect(page.getByRole('heading', { name: 'Aanmelden is niet gelukt.', exact: true })).toBeVisible()
  await expect(page).toHaveURL(url => !url.searchParams.has('code'))
  await expect(page.getByText('De aanmeldlink is verlopen of al gebruikt. Probeer opnieuw met je Google-account.')).toBeVisible()
  await page.getByRole('button', { name: 'Opnieuw aanmelden', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Meld je aan op de pc.', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
